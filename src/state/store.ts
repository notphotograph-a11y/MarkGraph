import { create } from 'zustand'
import { api } from '@/api/client'
import type { ThemeId, VaultNode } from '@/api/types'
import { buildIndex, type VaultIndex } from '@/graph/indexer'
import { collectPaths } from '@/editor/wikilink'
import { bus } from '@/shell/bus'

export type Tab = { kind: 'note'; path: string } | { kind: 'graph' } | { kind: 'chat' }

interface NoteState {
  content: string
  mtime: number
  dirty: boolean
  saving: boolean
  externalUpdated: boolean
}

interface AppState {
  tree: VaultNode | null
  tabs: Tab[]
  activeIndex: number
  notes: Record<string, NoteState>
  /** 全库内容池（索引器输入，含未打开笔记） */
  contents: Record<string, string>
  index: VaultIndex | null
  /** 最近一次打开的笔记（图谱高亮用；切到图谱 tab 后仍保留） */
  lastNotePath: string | null
  theme: ThemeId
  editMode: 'edit' | 'read'
  paletteOpen: boolean
  settingsOpen: boolean
  init: () => Promise<void>
  refreshTree: () => Promise<void>
  syncIndex: () => Promise<void>
  rebuildIndex: () => void
  openNote: (path: string) => Promise<void>
  openGraph: () => void
  openChat: () => void
  closeTab: (index: number) => void
  closeActiveTab: () => void
  setActive: (index: number) => void
  setTheme: (t: ThemeId) => void
  setEditMode: (m: 'edit' | 'read') => void
  toggleEditMode: () => void
  setPaletteOpen: (open: boolean) => void
  setSettingsOpen: (open: boolean) => void
  remapPath: (from: string, to: string) => void
  setNoteContent: (path: string, content: string) => void
  markSaving: (path: string, saving: boolean) => void
  markSaved: (path: string, mtime: number) => void
  onExternalChange: (path: string, kind: string) => void
}

const THEME_KEY = 'mg-theme'

function loadTheme(): ThemeId {
  const t = localStorage.getItem(THEME_KEY)
  if (t === 'apple' || t === 'paper' || t === 'obsidian' || t === 'x' || t === 'meta') return t
  return 'apple'
}

export const useStore = create<AppState>((set, get) => ({
  tree: null,
  tabs: [],
  activeIndex: -1,
  notes: {},
  contents: {},
  index: null,
  lastNotePath: null,
  theme: loadTheme(),
  editMode: 'edit',
  paletteOpen: false,
  settingsOpen: false,

  init: async () => {
    await get().refreshTree()
  },

  /** 对齐内容池与当前树（缺失较多走批量接口），然后全量重建索引 */
  syncIndex: async () => {
    const { tree, contents } = get()
    if (!tree) return
    const paths = collectPaths(tree.children ?? [])
    const pathSet = new Set(paths)
    const next: Record<string, string> = {}
    for (const [p, c] of Object.entries(contents)) {
      if (pathSet.has(p)) next[p] = c
    }
    const missing = paths.filter(p => !(p in next))
    try {
      if (missing.length > 8) {
        const all = await api.notes()
        for (const n of all.notes) next[n.path] = n.content
      } else {
        await Promise.all(
          missing.map(async p => {
            const n = await api.note(p)
            next[p] = n.content
          }),
        )
      }
    } catch {
      /* 网络失败：保留已有内容，下次再同步 */
    }
    set({ contents: next })
    get().rebuildIndex()
  },

  rebuildIndex: () => {
    set({ index: buildIndex(new Map(Object.entries(get().contents))) })
  },

  refreshTree: async () => {
    const { tree } = await api.tree()
    // 清理指向已不存在文件的标签页
    const paths = new Set<string>()
    const walk = (n: VaultNode) => {
      if (n.type === 'file') paths.add(n.path)
      n.children?.forEach(walk)
    }
    if (tree) walk(tree)
    const { tabs, activeIndex } = get()
    const valid = tabs.filter(t => t.kind !== 'note' || paths.has(t.path))
    let nextIndex = activeIndex
    if (valid.length === 0) nextIndex = -1
    else if (tabs[activeIndex] && valid.includes(tabs[activeIndex])) nextIndex = valid.indexOf(tabs[activeIndex])
    else nextIndex = Math.min(activeIndex, valid.length - 1)
    set({ tree, tabs: valid, activeIndex: nextIndex })
    bus.emit('tree:change', tree)
    void get().syncIndex()
  },

  openNote: async path => {
    const { tabs, notes } = get()
    const existing = tabs.findIndex(t => t.kind === 'note' && t.path === path)
    if (existing >= 0) {
      set({ activeIndex: existing, lastNotePath: path })
      return
    }
    if (!notes[path]) {
      const n = await api.note(path)
      set({
        notes: {
          ...get().notes,
          [path]: { content: n.content, mtime: n.mtime, dirty: false, saving: false, externalUpdated: false },
        },
        contents: { ...get().contents, [path]: n.content },
      })
    }
    set({
      tabs: [...get().tabs, { kind: 'note', path }],
      activeIndex: get().tabs.length,
      lastNotePath: path,
    })
    bus.emit('note:open', path)
  },

  openGraph: () => {
    const { tabs } = get()
    const existing = tabs.findIndex(t => t.kind === 'graph')
    if (existing >= 0) {
      set({ activeIndex: existing })
      return
    }
    set({ tabs: [...get().tabs, { kind: 'graph' }], activeIndex: tabs.length })
  },

  openChat: () => {
    const { tabs } = get()
    const existing = tabs.findIndex(t => t.kind === 'chat')
    if (existing >= 0) {
      set({ activeIndex: existing })
      return
    }
    set({ tabs: [...get().tabs, { kind: 'chat' }], activeIndex: tabs.length })
  },

  closeTab: index => {
    const { tabs, activeIndex } = get()
    const next = tabs.filter((_, i) => i !== index)
    const nextIndex =
      next.length === 0 ? -1 : Math.min(activeIndex > index ? activeIndex - 1 : activeIndex, next.length - 1)
    set({ tabs: next, activeIndex: nextIndex })
  },

  closeActiveTab: () => {
    const { activeIndex } = get()
    if (activeIndex >= 0) get().closeTab(activeIndex)
  },

  setActive: index => {
    const tab = get().tabs[index]
    if (tab?.kind === 'note') set({ activeIndex: index, lastNotePath: tab.path })
    else set({ activeIndex: index })
  },

  setTheme: t => {
    localStorage.setItem(THEME_KEY, t)
    const apply = () => set({ theme: t })
    // 主题切换交叉淡化：View Transition 不支持或用户要求减少动态时瞬切
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => unknown
    }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (typeof doc.startViewTransition === 'function' && !reduce) doc.startViewTransition(apply)
    else apply()
  },

  setEditMode: m => set({ editMode: m }),

  toggleEditMode: () => set({ editMode: get().editMode === 'edit' ? 'read' : 'edit' }),

  setPaletteOpen: open => set({ paletteOpen: open }),

  setSettingsOpen: open => set({ settingsOpen: open }),

  remapPath: (from, to) => {
    if (!from || from === to) return
    const map = (p: string) => {
      if (p === from) return to
      if (p.startsWith(`${from}/`)) return `${to}${p.slice(from.length)}`
      return p
    }
    const { tabs, notes, contents, lastNotePath } = get()
    const nextNotes: Record<string, NoteState> = {}
    for (const [p, n] of Object.entries(notes)) nextNotes[map(p)] = n
    const nextContents: Record<string, string> = {}
    for (const [p, c] of Object.entries(contents)) nextContents[map(p)] = c
    set({
      tabs: tabs.map(t => (t.kind === 'note' ? { kind: 'note', path: map(t.path) } : t)),
      notes: nextNotes,
      contents: nextContents,
      lastNotePath: lastNotePath ? map(lastNotePath) : null,
    })
  },

  setNoteContent: (path, content) => {
    const cur = get().notes[path]
    if (!cur || cur.content === content) return
    set({ notes: { ...get().notes, [path]: { ...cur, content, dirty: true } } })
  },

  markSaving: (path, saving) => {
    const cur = get().notes[path]
    if (!cur) return
    set({ notes: { ...get().notes, [path]: { ...cur, saving } } })
  },

  markSaved: (path, mtime) => {
    const cur = get().notes[path]
    if (!cur) return
    set({
      notes: { ...get().notes, [path]: { ...cur, mtime, dirty: false, saving: false } },
      contents: { ...get().contents, [path]: cur.content },
    })
    get().rebuildIndex()
    bus.emit('note:save', path)
  },

  onExternalChange: (path, kind) => {
    void get().refreshTree()
    const { notes } = get()
    const cur = notes[path]
    if (!cur || kind === 'unlink') return
    if (cur.dirty) {
      // 有未保存编辑：只标记提示，不覆盖
      set({ notes: { ...notes, [path]: { ...cur, externalUpdated: true } } })
      return
    }
    // 干净状态：静默刷新内容并更新索引
    void api
      .note(path)
      .then(n =>
        set({
          notes: { ...get().notes, [path]: { ...cur, content: n.content, mtime: n.mtime, externalUpdated: false } },
          contents: { ...get().contents, [path]: n.content },
        }),
      )
      .then(() => get().rebuildIndex())
      .catch(() => undefined)
  },
}))
