import { useEffect, useRef, useState } from 'react'
import {
  ChevronRight,
  FilePlus,
  FileText,
  FolderPlus,
  Pencil,
  Share2,
  Trash2,
} from 'lucide-react'
import type { VaultNode } from '@/api/types'
import { api } from '@/api/client'
import { useStore } from '@/state/store'
import { bus } from '@/shell/bus'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type NameDialogMode = { kind: 'create-note' | 'create-dir'; dir: string } | { kind: 'rename'; from: string }

function nameDialogInitial(mode: NameDialogMode): string {
  if (mode.kind === 'rename') return mode.from.split('/').pop() ?? ''
  if (mode.kind === 'create-note') return '未命名笔记.md'
  return '新文件夹'
}

function NameDialog({
  mode,
  onClose,
}: {
  mode: NameDialogMode | null
  onClose: (value?: string) => void
}) {
  return (
    <Dialog open={!!mode} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        {mode && <NameDialogBody key={`${mode.kind}:${'dir' in mode ? mode.dir : mode.from}`} mode={mode} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function NameDialogBody({
  mode,
  onClose,
}: {
  mode: NameDialogMode
  onClose: (value?: string) => void
}) {
  const [value, setValue] = useState(() => nameDialogInitial(mode))
  return (
    <form
      onSubmit={e => {
        e.preventDefault()
        onClose(value)
      }}
    >
      <DialogHeader>
        <DialogTitle>
          {mode.kind === 'create-note' && '新建笔记'}
          {mode.kind === 'create-dir' && '新建文件夹'}
          {mode.kind === 'rename' && '重命名'}
        </DialogTitle>
      </DialogHeader>
      <Input
        autoFocus
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onClose(value)
          }
        }}
        onFocus={e => {
          const dot = e.target.value.lastIndexOf('.')
          e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length)
        }}
      />
      <DialogFooter className="mt-4">
        <Button type="button" variant="ghost" onClick={() => onClose()}>
          取消
        </Button>
        <Button type="submit">确定</Button>
      </DialogFooter>
    </form>
  )
}

function useTreeActions() {
  const refreshTree = useStore(s => s.refreshTree)
  const openNote = useStore(s => s.openNote)
  const remapPath = useStore(s => s.remapPath)
  const [nameMode, setNameMode] = useState<NameDialogMode | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const wrap = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      await refreshTree()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    }
  }

  const submitName = async (value?: string) => {
    const mode = nameMode
    setNameMode(null)
    if (!mode || !value?.trim()) return
    const name = value.trim()
    if (mode.kind === 'rename') {
      const dir = mode.from.split('/').slice(0, -1).join('/')
      let to = name
      if (mode.from.toLowerCase().endsWith('.md') && !to.toLowerCase().endsWith('.md')) to += '.md'
      const dest = dir ? `${dir}/${to}` : to
      try {
        await api.rename(mode.from, dest)
        remapPath(mode.from, dest)
        await refreshTree()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    } else if (mode.kind === 'create-note') {
      let n = name
      if (!n.toLowerCase().endsWith('.md')) n += '.md'
      const p = mode.dir ? `${mode.dir}/${n}` : n
      if (await wrap(() => api.create(p, false))) await openNote(p)
    } else {
      await wrap(() => api.create(mode.dir ? `${mode.dir}/${name}` : name, true))
    }
  }

  const doDelete = async () => {
    const p = confirmDelete
    setConfirmDelete(null)
    if (!p) return
    await wrap(() => api.remove(p))
  }

  return { nameMode, setNameMode, submitName, confirmDelete, setConfirmDelete, doDelete, error, setError }
}

function TreeRow({
  node,
  open,
  onToggle,
  onOpenFolder,
  onMenu,
}: {
  node: VaultNode
  open: boolean
  onToggle: () => void
  onOpenFolder: () => void
  onMenu?: (action: 'rename' | 'delete' | 'create-note' | 'create-dir') => void
}) {
  const activePath = useStore(s => (s.activeIndex >= 0 ? s.tabs[s.activeIndex] : null))
  const openNote = useStore(s => s.openNote)
  const isActive =
    (node.type === 'file' && activePath?.kind === 'note' && activePath.path === node.path) ||
    (node.type === 'dir' && activePath?.kind === 'folder' && activePath.path === node.path)

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {node.type === 'dir' ? (
          <span
            className={cn(
              'flex w-full items-center rounded text-[13px] font-medium hover:bg-[var(--secondary)]',
              isActive && 'bg-[var(--accent)] text-[var(--foreground)]',
            )}
          >
            <button
              type="button"
              aria-label={open ? '折叠' : '展开'}
              onClick={onToggle}
              className="grid h-6 w-6 flex-none place-items-center rounded"
            >
              <ChevronRight
                className={cn('h-3.5 w-3.5 text-[var(--muted-foreground)] transition-transform', open && 'rotate-90')}
              />
            </button>
            <button type="button" onClick={onOpenFolder} className="min-w-0 flex-1 truncate py-1 pr-2 text-left">
              {node.name}
            </button>
          </span>
        ) : (
          <button
            onClick={() => void openNote(node.path)}
            className={cn(
              'flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[13px] hover:bg-[var(--secondary)]',
              isActive
                ? 'bg-[var(--accent)] text-[var(--foreground)]'
                : 'text-[var(--muted-foreground)]',
            )}
          >
            <FileText
              className={cn('h-3.5 w-3.5 flex-none', isActive && 'text-[var(--primary)]')}
            />
            <span className="truncate">{node.name.replace(/\.md$/i, '')}</span>
          </button>
        )}
      </ContextMenuTrigger>
      <ContextMenuContent>
        {node.type === 'dir' ? (
          <>
            <ContextMenuItem onClick={() => onMenu?.('create-note')}>
              <FilePlus /> 新建笔记
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onMenu?.('create-dir')}>
              <FolderPlus /> 新建文件夹
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        ) : (
          <>
            <ContextMenuItem onClick={() => onMenu?.('create-note')}>
              <FilePlus /> 新建笔记
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem onClick={() => onMenu?.('rename')}>
          <Pencil /> 重命名
        </ContextMenuItem>
        <ContextMenuItem className="text-[var(--destructive)]" onClick={() => onMenu?.('delete')}>
          <Trash2 /> 删除
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function FileTree() {
  const tree = useStore(s => s.tree)
  const openGraph = useStore(s => s.openGraph)
  const openFolder = useStore(s => s.openFolder)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const seededExpand = useRef(false)
  const actions = useTreeActions()
  const { setNameMode } = actions

  useEffect(() => {
    if (seededExpand.current || !tree?.children?.length) return
    seededExpand.current = true
    setExpanded(new Set(tree.children.filter(c => c.type === 'dir').map(c => c.path)))
  }, [tree])

  useEffect(() => {
    const offNote = bus.on('ui:new-note', payload => {
      const dir = typeof payload === 'string' ? payload : ''
      setNameMode({ kind: 'create-note', dir })
    })
    const offDir = bus.on('ui:new-folder', () => {
      setNameMode({ kind: 'create-dir', dir: '' })
    })
    return () => {
      offNote()
      offDir()
    }
  }, [setNameMode])

  const toggle = (path: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const renderNode = (node: VaultNode, depth: number) => (
    <li key={node.path}>
      <div style={{ paddingLeft: depth * 12 }}>
        <TreeRow
          node={node}
          open={expanded.has(node.path)}
          onToggle={() => toggle(node.path)}
          onOpenFolder={() => {
            if (node.type !== 'dir') return
            openFolder(node.path)
            setExpanded(prev => new Set(prev).add(node.path))
          }}
          onMenu={action => {
            if (action === 'rename') actions.setNameMode({ kind: 'rename', from: node.path })
            else if (action === 'delete') actions.setConfirmDelete(node.path)
            else if (action === 'create-note') {
              const dir = node.type === 'dir' ? node.path : node.path.split('/').slice(0, -1).join('/')
              actions.setNameMode({ kind: 'create-note', dir })
            } else {
              const dir = node.type === 'dir' ? node.path : node.path.split('/').slice(0, -1).join('/')
              actions.setNameMode({ kind: 'create-dir', dir })
            }
          }}
        />
      </div>
      {node.type === 'dir' &&
        expanded.has(node.path) &&
        node.children?.map(c => renderNode(c, depth + 1))}
    </li>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 pb-1.5 pt-2.5 text-[11px] uppercase tracking-wider text-[var(--muted-foreground)]">
        <span>文件</span>
        <div className="flex items-center gap-0.5 normal-case tracking-normal">
          <button
            type="button"
            title="新建笔记"
            onClick={() => actions.setNameMode({ kind: 'create-note', dir: '' })}
            className="grid h-[22px] w-[22px] place-items-center rounded text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
          >
            <FilePlus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="新建文件夹"
            onClick={() => actions.setNameMode({ kind: 'create-dir', dir: '' })}
            className="grid h-[22px] w-[22px] place-items-center rounded text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="打开图谱"
            onClick={() => openGraph()}
            className="grid h-[22px] w-[22px] place-items-center rounded text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
          >
            <Share2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-8">
            {tree?.children?.length ? (
              <ul>{tree.children.map(c => renderNode(c, 0))}</ul>
            ) : (
              <p className="px-2 py-6 text-center text-xs text-[var(--muted-foreground)]">
                还没有笔记
              </p>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => actions.setNameMode({ kind: 'create-note', dir: '' })}>
            <FilePlus /> 新建笔记
          </ContextMenuItem>
          <ContextMenuItem onClick={() => actions.setNameMode({ kind: 'create-dir', dir: '' })}>
            <FolderPlus /> 新建文件夹
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <NameDialog mode={actions.nameMode} onClose={v => void actions.submitName(v)} />
      <Dialog open={!!actions.confirmDelete} onOpenChange={o => !o && actions.setConfirmDelete(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>删除「{actions.confirmDelete?.split('/').pop() ?? ''}」？</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[var(--muted-foreground)]">
            {actions.confirmDelete && !actions.confirmDelete.toLowerCase().endsWith('.md')
              ? '文件夹将被递归删除，此操作不可撤销。'
              : '此操作不可撤销。'}
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => actions.setConfirmDelete(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={() => void actions.doDelete()}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!actions.error} onOpenChange={o => !o && actions.setError(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>没做成</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[var(--destructive)]">{actions.error}</p>
          <DialogFooter>
            <Button onClick={() => actions.setError(null)}>好</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
