import { X } from 'lucide-react'
import { useStore } from '@/state/store'
import { cn } from '@/lib/utils'
import { collectPaths } from '@/editor/wikilink'

function tabTitle(tab: { kind: string; path?: string }, treePaths: string[]): string {
  if (tab.kind === 'graph') return '图谱'
  const name = tab.path!.split('/').pop() ?? ''
  const base = name.replace(/\.md$/i, '')
  // F2.8：同名笔记以相对路径区分显示
  const dup = treePaths.filter(p => p.split('/').pop()?.replace(/\.md$/i, '') === base)
  if (dup.length > 1) return tab.path!
  return base
}

export function Tabs() {
  const tabs = useStore(s => s.tabs)
  const activeIndex = useStore(s => s.activeIndex)
  const setActive = useStore(s => s.setActive)
  const closeTab = useStore(s => s.closeTab)
  const tree = useStore(s => s.tree)
  const editMode = useStore(s => s.editMode)
  const setEditMode = useStore(s => s.setEditMode)
  const setPaletteOpen = useStore(s => s.setPaletteOpen)

  const treePaths = tree ? collectPaths(tree.children ?? []) : []

  return (
    <div className="flex h-10 flex-none items-center gap-2 border-b border-[var(--mg-panel-border)] px-3">
      {/* 装饰性交通灯（不参与交互） */}
      <div className="flex items-center gap-[7px] pr-1" aria-hidden>
        <i className="h-3 w-3 rounded-full bg-[#ff5f57]" />
        <i className="h-3 w-3 rounded-full bg-[#febc2e]" />
        <i className="h-3 w-3 rounded-full bg-[#28c840]" />
      </div>

      <div className="flex min-w-0 flex-1 items-stretch self-stretch">
        {tabs.length === 0 && (
          <span className="self-center px-3 text-[13px] text-[var(--muted-foreground)]">MarkGraph</span>
        )}
        {tabs.map((tab, i) => (
          <button
            key={tab.kind === 'graph' ? 'graph' : tab.path}
            onClick={() => setActive(i)}
            className={cn(
              'group relative flex min-w-0 items-center gap-1.5 self-end mb-[1px] rounded-t-lg px-3 py-1.5 text-[13px]',
              'text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--secondary)]',
              i === activeIndex && 'text-[var(--foreground)] font-medium',
            )}
          >
            <span className="max-w-40 truncate">{tabTitle(tab, treePaths)}</span>
            <span
              role="button"
              aria-label="关闭标签"
              onClick={e => {
                e.stopPropagation()
                closeTab(i)
              }}
              className="flex h-4 w-4 items-center justify-center rounded opacity-0 hover:bg-[var(--accent)] group-hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </span>
            {i === activeIndex && (
              <i className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-[var(--primary)]" />
            )}
          </button>
        ))}
      </div>

      <div className="flex flex-none items-center gap-2">
        <div className="flex rounded-lg bg-[var(--secondary)] p-0.5 text-xs text-[var(--muted-foreground)]">
          <button
            className={cn(
              'rounded-md px-3 py-1',
              editMode === 'edit' && 'bg-[var(--mg-elevated)] text-[var(--foreground)] shadow-sm',
            )}
            onClick={() => setEditMode('edit')}
          >
            编辑
          </button>
          <button
            className={cn(
              'rounded-md px-3 py-1',
              editMode === 'read' && 'bg-[var(--mg-elevated)] text-[var(--foreground)] shadow-sm',
            )}
            onClick={() => setEditMode('read')}
          >
            阅读
          </button>
        </div>
        <button
          className="flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
          title="打开命令面板"
          onClick={() => setPaletteOpen(true)}
        >
          命令
          <kbd className="rounded border border-[var(--border)] px-1 font-mono text-[10px]">⌘P</kbd>
        </button>
      </div>
    </div>
  )
}
