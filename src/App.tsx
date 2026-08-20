import { useEffect, useState } from 'react'
import { api, subscribeAiEvents, subscribeVaultEvents } from '@/api/client'
import { useStore } from '@/state/store'
import { useAiStore } from '@/state/ai'
import { FileTree } from '@/panels/FileTree'
import { Tabs } from '@/shell/Tabs'
import { Editor, ReadView } from '@/editor/Editor'
import { GraphView } from '@/graph/GraphView'
import { ChatView } from '@/chat/ChatView'
import { CommandPalette } from '@/shell/CommandPalette'
import { SettingsDialog } from '@/shell/Settings'
import { Button } from '@/components/ui/button'
import { getPanels } from '@/panels/registry'
import { registerBuiltinPanels } from '@/panels/Backlinks'
import { registerAiPanels } from '@/panels/Ai'

registerBuiltinPanels()
registerAiPanels()

function Welcome() {
  const refreshTree = useStore(s => s.refreshTree)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  return (
    <div className="mg-fade-in flex flex-1 flex-col items-center justify-center gap-3 px-8">
      <h1 className="text-[22px] font-semibold tracking-tight">欢迎使用 MarkGraph</h1>
      <p className="max-w-sm text-center text-[13.5px] leading-6 text-[var(--muted-foreground)]">
        这个库还是空的。导入一份约 25 篇互链笔记，或在左侧新建第一篇。
      </p>
      <Button
        size="lg"
        disabled={importing}
        onClick={async () => {
          setImporting(true)
          setError('')
          try {
            await api.importSample()
            await refreshTree()
          } catch (err) {
            setError(`导入失败：${(err as Error).message}`)
          } finally {
            setImporting(false)
          }
        }}
      >
        {importing ? '导入中…' : '导入示例库'}
      </Button>
      {error && <p className="text-[12.5px] text-[var(--mg-broken)]">{error}</p>}
    </div>
  )
}

function NoteView({ path }: { path: string }) {
  const editMode = useStore(s => s.editMode)
  const note = useStore(s => s.notes[path])
  if (!note) {
    return <div className="flex flex-1 items-center justify-center text-sm text-[var(--muted-foreground)]">加载中…</div>
  }
  return editMode === 'edit' ? <Editor path={path} /> : <ReadView path={path} />
}

function RightPanel() {
  const panels = getPanels()
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {panels.map((p, i) => (
        <section
          key={p.id}
          className={i === 0 ? 'border-b border-[var(--mg-panel-border)] p-3.5' : 'p-3.5'}
        >
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            {p.title}
          </h3>
          {p.render()}
        </section>
      ))}
    </div>
  )
}

function Statusbar() {
  const tabs = useStore(s => s.tabs)
  const activeIndex = useStore(s => s.activeIndex)
  const note = useStore(s => (activeIndex >= 0 && tabs[activeIndex].kind === 'note' ? s.notes[tabs[activeIndex].path] : undefined))
  const active = activeIndex >= 0 ? tabs[activeIndex] : null
  return (
    <div className="flex h-7 flex-none items-center gap-2 border-t border-[var(--mg-panel-border)] px-3.5 text-[11px] text-[var(--muted-foreground)]">
      <i
        className={
          note?.saving
            ? 'h-[7px] w-[7px] rounded-full bg-[var(--muted-foreground)] animate-pulse'
            : 'h-[7px] w-[7px] rounded-full bg-[var(--mg-save-dot)]'
        }
      />
      {active?.kind === 'note'
        ? note?.saving
          ? '保存中…'
          : note?.dirty
            ? '未保存'
            : '已保存'
        : '就绪'}
      {active?.kind === 'note' && <span className="ml-1 opacity-70">{active.path}</span>}
    </div>
  )
}

export default function App() {
  const theme = useStore(s => s.theme)
  const init = useStore(s => s.init)
  const tree = useStore(s => s.tree)
  const tabs = useStore(s => s.tabs)
  const activeIndex = useStore(s => s.activeIndex)
  const active = activeIndex >= 0 ? tabs[activeIndex] : null

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // Cmd/Ctrl+E 切换编辑/阅读（F2.6）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault()
        const s = useStore.getState()
        s.setSettingsOpen(!s.settingsOpen)
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        const s = useStore.getState()
        s.setEditMode(s.editMode === 'edit' ? 'read' : 'edit')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    let cancelled = false
    void init().then(() => {
      if (cancelled) return
      const q = new URLSearchParams(location.search)
      const note = q.get('note')
      const view = q.get('view')
      const mode = q.get('mode')
      const s = useStore.getState()
      if (mode === 'read' || mode === 'edit') s.setEditMode(mode)
      if (q.get('palette') === '1') s.setPaletteOpen(true)
      if (note) void s.openNote(note)
      else if (view === 'graph') s.openGraph()
      else if (view === 'chat') s.openChat()
    })
    const off = subscribeVaultEvents(e => {
      useStore.getState().onExternalChange(e.path, e.kind)
    })
    // AI 富集事件（Phase 2）：面板刷新、进度与设置同步
    void useAiStore.getState().initAi()
    const offAi = subscribeAiEvents(e => {
      useAiStore.getState().onEvent(e)
    })
    return () => {
      cancelled = true
      off()
      offAi()
    }
  }, [init])

  const vaultEmpty = !tree || !tree.children || tree.children.length === 0

  return (
    <div className="app-root flex h-full gap-2.5 p-2.5">
      <aside className="mg-glass flex w-64 flex-none flex-col overflow-hidden">
        <FileTree />
      </aside>

      <main className="mg-glass flex min-w-0 flex-1 flex-col overflow-hidden">
        <Tabs />
        <div className="mg-content flex min-h-0 flex-1 flex-col">
          {vaultEmpty ? (
            <Welcome />
          ) : active?.kind === 'note' ? (
            <NoteView path={active.path} />
          ) : active?.kind === 'graph' ? (
            <GraphView />
          ) : active?.kind === 'chat' ? (
            <ChatView />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-[var(--muted-foreground)]">
              在左侧选择一篇笔记开始
            </div>
          )}
        </div>
        <Statusbar />
      </main>

      <aside className="mg-glass flex w-72 flex-none flex-col overflow-hidden">
        <RightPanel />
      </aside>
      <CommandPalette />
      <SettingsDialog />
    </div>
  )
}
