/**
 * AI 富集前端状态（独立于主 store，避免主 store 膨胀）。
 * 数据源：/api/ai/*；刷新时机：切换笔记、SSE ai 事件。
 */
import { create } from 'zustand'
import { api } from '@/api/client'
import type { AiEvent, AiNoteView, AiSettings, AiStatus } from '@/api/types'

interface AiState {
  status: AiStatus | null
  views: Record<string, AiNoteView>
  progress: { done: number; total: number } | null
  initAi: () => Promise<void>
  refreshStatus: () => Promise<void>
  loadView: (path: string) => Promise<void>
  saveSettings: (patch: Partial<AiSettings>) => Promise<void>
  enrichNow: (path: string) => Promise<void>
  enrichAll: () => Promise<void>
  apply: (path: string, target: string, anchor: string) => Promise<void>
  undo: (path: string) => Promise<void>
  search: (q: string) => Promise<{ path: string; score: number }[]>
  onEvent: (e: AiEvent) => void
}

export const useAiStore = create<AiState>((set, get) => ({
  status: null,
  views: {},
  progress: null,

  initAi: async () => {
    await get().refreshStatus()
  },

  refreshStatus: async () => {
    try {
      set({ status: await api.aiStatus() })
    } catch {
      /* 服务端不可达：保留旧状态 */
    }
  },

  loadView: async path => {
    try {
      const view = await api.aiNote(path)
      set({ views: { ...get().views, [path]: view } })
    } catch {
      const { [path]: _drop, ...rest } = get().views
      set({ views: rest })
    }
  },

  saveSettings: async patch => {
    const settings = await api.aiSaveSettings(patch)
    const status = get().status
    if (status) set({ status: { ...status, settings } })
  },

  enrichNow: async path => {
    await api.aiEnrich(path)
    await get().refreshStatus()
  },

  enrichAll: async () => {
    const { total } = await api.aiEnrichAll()
    set({ progress: { done: 0, total } })
    await get().refreshStatus()
  },

  apply: async (path, target, anchor) => {
    await api.aiApply(path, target, anchor)
    await get().loadView(path)
  },

  undo: async path => {
    await api.aiUndo(path)
    await get().loadView(path)
  },

  search: async q => {
    const { results } = await api.aiSearch(q)
    return results
  },

  onEvent: e => {
    if (e.type === 'settings') {
      const status = get().status
      if (status) set({ status: { ...status, settings: e.settings } })
      return
    }
    if (e.type === 'progress') {
      set({ progress: e.done >= e.total ? null : e })
      void get().refreshStatus()
      return
    }
    // note：富集完成，刷新该篇视图与队列状态（正文变更走 vault change 事件静默刷新）
    void get().loadView(e.path)
    void get().refreshStatus()
  },
}))
