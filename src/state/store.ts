import { create } from 'zustand'
import { api } from '@/api/client'
import type { ThemeId, VaultNode, WritingSettings } from '@/api/types'
import type { VaultIndex } from '@/graph/indexer'
import { collectPaths } from '@/editor/wikilink'
import { bus } from '@/shell/bus'

export type Tab =
  | { kind: 'note'; path: string }
  | { kind: 'graph' }
  | { kind: 'chat' }
  | { kind: 'folder'; path: string }
  | { kind: 'tagview'; tag: string }

export const DEFAULT_WRITING: WritingSettings = {
  templatesDir: '模板',
  diaryDir: '日记',
  diaryTemplate: '模板/日记.md',
}

/** 打开笔记时的定位指令（F28.1：全文命中 → 打开即到达命中行） */
export interface OpenNav {
  /** 0 基命中行号 */
  line?: number
  /** 命中词（用于行内选中/高亮） */
  query?: string
}

const MRU_KEY = 'mg-mru'
const MRU_MAX = 20

function loadMru(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(MRU_KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}

function saveMru(paths: string[]): void {
  try {
    localStorage.setItem(MRU_KEY, JSON.stringify(paths.slice(0, MRU_MAX)))
  } catch {
    /* 忽略 */
  }
}

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
  /** 写作设置（F27）：模板/日记目录 */
  writing: WritingSettings
  /** 最近打开（F28.3）：持久化 MRU，命令面板空查询置顶 */
  mru: string[]
  /** 待消费的定位指令（openNote(path, nav) 设置，编辑/阅读视图取走） */
  pendingNav: (OpenNav & { path: string }) | null
  init: () => Promise<void>
  refreshTree: () => Promise<void>
  refreshWriting: () => Promise<void>
  createQuickNote: () => Promise<void>
  createTodayDiary: () => Promise<void>
  insertTemplate: (tplPath: string) => Promise<void>
  /** 取走针对该笔记的定位指令（一次性） */
  consumeNav: (path: string) => OpenNav | null
  syncIndex: () => Promise<void>
  rebuildIndex: () => void
  openNote: (path: string, nav?: OpenNav) => Promise<void>
  openGraph: () => void
  openChat: () => void
  openFolder: (path: string) => void
  openTag: (tag: string) => void
  closeTab: (index: number) => void
  closeActiveTab: () => void
  /** 关闭除 index 外的全部标签（F29.2） */
  closeOthers: (index: number) => void
  closeAll: () => void
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

/** 索引拉取防抖：连续保存/SSE 事件合并为一次 /api/index 请求 */
let indexFetchTimer: ReturnType<typeof setTimeout> | null = null

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
  writing: { ...DEFAULT_WRITING },
  mru: loadMru(),
  pendingNav: null,

  init: async () => {
    await get().refreshTree()
    void get().refreshWriting()
  },

  refreshWriting: async () => {
    try {
      const { writing } = await api.writingGet()
      set({ writing })
    } catch {
      /* 保持默认 */
    }
  },

  /** 免弹窗直建（F26.1）：未命名笔记.md 起名防冲突，创建后打开进入编辑 */
  createQuickNote: async () => {
    const paths = new Set(collectPaths(get().tree?.children ?? []))
    let name = '未命名笔记.md'
    for (let i = 2; paths.has(name); i++) name = `未命名笔记 ${i}.md`
    await api.create(name, false)
    await get().refreshTree()
    await get().openNote(name)
  },

  /** 新建今日日记（F27.2）：已存在直接打开；模板存在则套用 */
  createTodayDiary: async () => {
    const { writing } = get()
    const d = new Date()
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const p = writing.diaryDir ? `${writing.diaryDir}/${today}.md` : `${today}.md`
    try {
      await api.note(p)
      await get().openNote(p)
      return
    } catch {
      /* 不存在，走创建 */
    }
    let content = ''
    if (writing.diaryTemplate) {
      try {
        content = (await api.note(writing.diaryTemplate)).content
      } catch {
        /* 模板不存在：空日记 */
      }
    }
    try {
      await api.create(p, false)
    } catch {
      /* 409 竞态：已存在则直接打开 */
    }
    if (content) await api.save(p, content)
    await get().refreshTree()
    await get().openNote(p)
  },

  /** 插入模板（F27.3）：仅当当前笔记为空时写入模板内容 */
  insertTemplate: async tplPath => {
    const { tabs, activeIndex, notes } = get()
    const tab = activeIndex >= 0 ? tabs[activeIndex] : null
    if (!tab || tab.kind !== 'note') return
    const cur = notes[tab.path]
    if (!cur || cur.content.trim()) return
    const tpl = await api.note(tplPath)
    await api.save(tab.path, tpl.content)
    set({
      notes: {
        ...get().notes,
        [tab.path]: { ...cur, content: tpl.content, mtime: Date.now(), dirty: false },
      },
      contents: { ...get().contents, [tab.path]: tpl.content },
    })
    get().rebuildIndex()
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

  /** 从服务端拉取链接索引（F23.1 同源取数：与 MCP/反链/图谱共用服务端构建结果） */
  rebuildIndex: () => {
    if (indexFetchTimer) clearTimeout(indexFetchTimer)
    indexFetchTimer = setTimeout(() => {
      indexFetchTimer = null
      void api
        .index()
        .then(s => {
          const index: VaultIndex = {
            nodes: s.nodes,
            edges: s.edges,
            backlinks: new Map(Object.entries(s.backlinks)),
            tags: new Map(Object.entries(s.tags)),
            ghostTargets: new Map(Object.entries(s.ghostTargets)),
          }
          set({ index })
        })
        .catch(() => undefined)
    }, 250)
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
    const dirs = new Set<string>()
    const walkDirs = (n: VaultNode) => {
      n.children?.forEach(c => {
        if (c.type === 'dir') {
          dirs.add(c.path)
          walkDirs(c)
        }
      })
    }
    if (tree) walkDirs(tree)
    const valid = tabs.filter(
      t =>
        (t.kind === 'note' && paths.has(t.path)) ||
        (t.kind === 'folder' && dirs.has(t.path)) ||
        t.kind === 'graph' ||
        t.kind === 'chat' ||
        t.kind === 'tagview',
    )
    let nextIndex = activeIndex
    if (valid.length === 0) nextIndex = -1
    else if (tabs[activeIndex] && valid.includes(tabs[activeIndex])) nextIndex = valid.indexOf(tabs[activeIndex])
    else nextIndex = Math.min(activeIndex, valid.length - 1)
    set({ tree, tabs: valid, activeIndex: nextIndex })
    bus.emit('tree:change', tree)
    void get().syncIndex()
  },

  openNote: async (path, nav) => {
    const { tabs, notes } = get()
    if (nav) set({ pendingNav: { ...nav, path } })
    // MRU（F28.3）：去重置顶，持久化
    const mru = [path, ...get().mru.filter(p => p !== path)].slice(0, MRU_MAX)
    set({ mru })
    saveMru(mru)
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

  openFolder: path => {
    const { tabs } = get()
    const existing = tabs.findIndex(t => t.kind === 'folder' && t.path === path)
    if (existing >= 0) {
      set({ activeIndex: existing })
      return
    }
    set({ tabs: [...get().tabs, { kind: 'folder', path }], activeIndex: tabs.length })
  },

  openTag: tag => {
    const { tabs } = get()
    const existing = tabs.findIndex(t => t.kind === 'tagview' && t.tag === tag)
    if (existing >= 0) {
      set({ activeIndex: existing })
      return
    }
    set({ tabs: [...tabs, { kind: 'tagview', tag }], activeIndex: tabs.length })
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

  closeOthers: index => {
    const { tabs } = get()
    const keep = tabs[index]
    if (!keep) return
    set({ tabs: [keep], activeIndex: 0 })
  },

  closeAll: () => set({ tabs: [], activeIndex: -1 }),

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
      tabs: tabs.map(t =>
        t.kind === 'note' || t.kind === 'folder' ? { kind: t.kind, path: map(t.path) } : t,
      ),
      notes: nextNotes,
      contents: nextContents,
      lastNotePath: lastNotePath ? map(lastNotePath) : null,
    })
  },

  /** 取走针对该笔记的定位指令（一次性；不匹配返回 null） */
  consumeNav: path => {
    const nav = get().pendingNav
    if (!nav || nav.path !== path) return null
    set({ pendingNav: null })
    return { line: nav.line, query: nav.query }
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
    if (!path.toLowerCase().endsWith('.md')) return
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
