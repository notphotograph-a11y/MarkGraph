/**
 * 命令面板（F5）：Cmd/Ctrl+P 打开，文件 fuzzy + 命令 registry。
 * 顶部下拉玻璃面板；Esc / 点遮罩关闭。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Folder, Search, Sparkles, Terminal } from 'lucide-react'
import type { VaultNode } from '@/api/types'
import { useStore } from '@/state/store'
import { useAiStore } from '@/state/ai'
import { fuzzyScore } from '@/editor/completions'
import { listCommands } from './commands'
import { cn } from '@/lib/utils'

interface FileItem {
  kind: 'file'
  id: string
  title: string
  hint: string
  path: string
  score: number
  /** 文件夹项：回车打开文件夹页而非笔记（F15.1） */
  folder?: boolean
}

interface CmdItem {
  kind: 'command'
  id: string
  title: string
  hint: string
  score: number
  run: () => void | Promise<void>
}

type Item = FileItem | CmdItem

function fileHint(path: string): string {
  const parts = path.split('/')
  if (parts.length <= 1) return ''
  return parts.slice(0, -1).join(' / ')
}

export function CommandPalette() {
  const open = useStore(s => s.paletteOpen)
  const setOpen = useStore(s => s.setPaletteOpen)
  const openNote = useStore(s => s.openNote)
  const index = useStore(s => s.index)
  const theme = useStore(s => s.theme)
  const tree = useStore(s => s.tree)
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const [sem, setSem] = useState<{ path: string; score: number }[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const aiConfigured = !!useAiStore(s => s.status?.configured)

  // 语义搜索（F12.1）：≥4 字防抖 300ms；失败静默降级为文件名 fuzzy
  useEffect(() => {
    const q = query.trim()
    if (!open || !aiConfigured || q.length < 4) {
      setSem([])
      return
    }
    const t = window.setTimeout(() => {
      useAiStore
        .getState()
        .search(q)
        .then(results => setSem(results.filter(r => r.score > 0.1)))
        .catch(() => setSem([]))
    }, 300)
    return () => window.clearTimeout(t)
  }, [query, open, aiConfigured])

  const contents = useStore(s => s.contents)

  const items = useMemo<Item[]>(() => {
    const q = query.trim()
    // 文件夹候选（F15.1）：树里的目录进入 fuzzy 列表
    const folders: VaultNode[] = []
    const walkFolders = (nodes: VaultNode[]) => {
      for (const n of nodes) {
        if (n.type === 'dir') {
          folders.push(n)
          walkFolders(n.children ?? [])
        }
      }
    }
    walkFolders(tree?.children ?? [])
    const folderItems: FileItem[] = folders
      .map(f => {
        const name = f.name
        const score = q ? fuzzyScore(q, name) + (name.toLowerCase().startsWith(q.toLowerCase()) ? 5 : 0) : 1
        return {
          kind: 'file' as const,
          id: `folder:${f.path}`,
          title: name,
          hint: '文件夹',
          path: f.path,
          score,
          folder: true,
        }
      })
      .filter(f => f.score >= 0)

    // 全文搜索（F16）：不依赖 AI，标题命中权重高于正文
    const ql = q.toLowerCase()
    const textHits: FileItem[] = []
    if (ql.length >= 2) {
      for (const [p, content] of Object.entries(contents)) {
        if (p.toLowerCase().endsWith('.md') === false) continue
        const name = p.split('/').pop()!.replace(/\.md$/i, '')
        const titleHit = name.toLowerCase().includes(ql)
        let bodyLine = ''
        let count = 0
        if (!titleHit) {
          const lines = content.split('\n')
          for (let i = 0; i < lines.length; i++) {
            const idx = lines[i].toLowerCase().indexOf(ql)
            if (idx >= 0) {
              count++
              if (!bodyLine) {
                const around = lines[i].trim().slice(Math.max(0, idx - 12), idx + ql.length + 18)
                bodyLine = (idx > 12 ? '…' : '') + around + '…'
              }
            }
            if (count > 5) break
          }
        }
        if (titleHit || count > 0) {
          textHits.push({
            kind: 'file',
            id: `text:${p}`,
            title: name,
            hint: titleHit ? '标题命中' : bodyLine,
            path: p,
            score: (titleHit ? 100 : 0) + count * 2,
          })
        }
      }
      textHits.sort((a, b) => b.score - a.score)
    }

    const files: FileItem[] = (index?.nodes ?? [])
      .filter(n => !n.ghost)
      .map(n => {
        const score = q ? Math.max(fuzzyScore(q, n.name), fuzzyScore(q, n.id)) : 1
        return {
          kind: 'file' as const,
          id: `file:${n.id}`,
          title: n.name,
          hint: fileHint(n.id),
          path: n.id,
          score,
        }
      })
      .filter(f => f.score >= 0)
      .sort((a, b) =>
        q
          ? b.score - a.score || a.title.localeCompare(b.title, 'zh')
          : a.path.localeCompare(b.path, 'zh'),
      )

    const fuzzyPaths = new Set(files.filter(f => f.score > 0 && q).map(f => f.path))
    const semPaths = new Set(sem.map(r => r.path))
    const textItems = textHits.filter(t => !fuzzyPaths.has(t.path) && !semPaths.has(t.path)).slice(0, 6)
    const semItems: FileItem[] = sem
      .filter(r => index?.nodes.some(n => n.id === r.path))
      .map(r => ({
        kind: 'file' as const,
        id: `sem:${r.path}`,
        title: r.path.split('/').pop()!.replace(/\.md$/i, ''),
        hint: fileHint(r.path),
        path: r.path,
        score: 1,
      }))

    const cmds: CmdItem[] = listCommands()
      .map(c => {
        const score = q ? Math.max(fuzzyScore(q, c.title), fuzzyScore(q, c.keywords)) : 1
        return {
          kind: 'command' as const,
          id: c.id,
          title: c.title,
          hint: '命令',
          score,
          run: c.run,
        }
      })
      .filter(c => c.score >= 0)
      .sort((a, b) => b.score - a.score)

    const fileLimit = q ? 12 : 8
    const fuzzyList = q
      ? [...folderItems, ...files].filter(f => !semPaths.has(f.path)).slice(0, fileLimit)
      : files.slice(0, fileLimit)
    return [...semItems, ...textItems, ...fuzzyList, ...cmds]
  }, [query, index, open, theme, tree, sem, contents])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setSel(0)
    const t = window.setTimeout(() => inputRef.current?.focus(), 20)
    return () => window.clearTimeout(t)
  }, [open])

  useEffect(() => {
    setSel(0)
  }, [query])

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-sel="1"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [sel, items])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        const s = useStore.getState()
        s.setPaletteOpen(!s.paletteOpen)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const openFolder = useStore(s => s.openFolder)

  const run = (item: Item | undefined) => {
    if (!item) return
    setOpen(false)
    if (item.kind === 'file') {
      if (item.folder) openFolder(item.path)
      else void openNote(item.path)
    } else void item.run()
  }

  if (!open) return null

  const files = items.filter((i): i is FileItem => i.kind === 'file')
  const semFiles = files.filter(f => f.id.startsWith('sem:'))
  const textFiles = files.filter(f => f.id.startsWith('text:'))
  const fuzzyFiles = files.filter(f => !f.id.startsWith('sem:') && !f.id.startsWith('text:'))
  const cmds = items.filter((i): i is CmdItem => i.kind === 'command')

  return (
    <div
      className="mg-palette-mask"
      onMouseDown={e => {
        if (e.target === e.currentTarget) setOpen(false)
      }}
    >
      <div
        role="dialog"
        aria-label="命令面板"
        className="mg-palette"
      >
        <div className="flex items-center gap-2.5 border-b border-[var(--border)] px-3.5 py-3">
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索文件，或输入命令…"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[var(--muted-foreground)]"
            onKeyDown={e => {
              if (e.key === 'Escape') {
                e.preventDefault()
                setOpen(false)
              } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSel(i => (items.length ? (i + 1) % items.length : 0))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSel(i => (items.length ? (i - 1 + items.length) % items.length : 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                run(items[sel])
              }
            }}
          />
          <kbd className="rounded border border-[var(--border)] px-1.5 font-mono text-[10px] text-[var(--muted-foreground)]">
            esc
          </kbd>
        </div>
        <div ref={listRef} className="max-h-80 overflow-y-auto px-1.5 py-1.5">
          {items.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-[var(--muted-foreground)]">没有匹配项</p>
          )}
          {semFiles.length > 0 && (
            <>
              <div className="px-2.5 pt-1.5 pb-1 text-[11px] tracking-wide text-[var(--muted-foreground)]">语义相关</div>
              {semFiles.map(item => {
                const i = items.indexOf(item)
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-sel={i === sel ? '1' : '0'}
                    onMouseEnter={() => setSel(i)}
                    onClick={() => run(item)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13.5px]',
                      i === sel ? 'bg-[var(--accent)] text-[var(--foreground)]' : 'hover:bg-[var(--secondary)]',
                    )}
                  >
                    <Sparkles className="h-3.5 w-3.5 flex-none text-[var(--mg-link)]" />
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    {item.hint && <em className="truncate text-[12px] not-italic text-[var(--muted-foreground)]">{item.hint}</em>}
                  </button>
                )
              })}
            </>
          )}
          {textFiles.length > 0 && (
            <>
              <div className="px-2.5 pt-1.5 pb-1 text-[11px] tracking-wide text-[var(--muted-foreground)]">全文匹配</div>
              {textFiles.map(item => {
                const i = items.indexOf(item)
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-sel={i === sel ? '1' : '0'}
                    onMouseEnter={() => setSel(i)}
                    onClick={() => run(item)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13.5px]',
                      i === sel ? 'bg-[var(--accent)] text-[var(--foreground)]' : 'hover:bg-[var(--secondary)]',
                    )}
                  >
                    <Search className="h-3.5 w-3.5 flex-none text-[var(--muted-foreground)]" />
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    {item.hint && <em className="max-w-45 truncate text-[12px] not-italic text-[var(--muted-foreground)]">{item.hint}</em>}
                  </button>
                )
              })}
            </>
          )}
          {fuzzyFiles.length > 0 && (
            <>
              <div className="px-2.5 pt-1.5 pb-1 text-[11px] tracking-wide text-[var(--muted-foreground)]">文件</div>
              {files.map(item => {
                const i = items.indexOf(item)
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-sel={i === sel ? '1' : '0'}
                    onMouseEnter={() => setSel(i)}
                    onClick={() => run(item)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13.5px]',
                      i === sel ? 'bg-[var(--accent)] text-[var(--foreground)]' : 'hover:bg-[var(--secondary)]',
                    )}
                  >
                    {item.folder ? (
                      <Folder className="h-3.5 w-3.5 flex-none text-[var(--muted-foreground)]" />
                    ) : (
                      <FileText className="h-3.5 w-3.5 flex-none text-[var(--muted-foreground)]" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    {item.hint && <em className="truncate text-[12px] not-italic text-[var(--muted-foreground)]">{item.hint}</em>}
                  </button>
                )
              })}
            </>
          )}
          {cmds.length > 0 && (
            <>
              <div className="px-2.5 pt-2 pb-1 text-[11px] tracking-wide text-[var(--muted-foreground)]">命令</div>
              {cmds.map(item => {
                const i = items.indexOf(item)
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-sel={i === sel ? '1' : '0'}
                    onMouseEnter={() => setSel(i)}
                    onClick={() => run(item)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13.5px]',
                      i === sel ? 'bg-[var(--accent)] text-[var(--foreground)]' : 'hover:bg-[var(--secondary)]',
                    )}
                  >
                    <Terminal className="h-3.5 w-3.5 flex-none text-[var(--muted-foreground)]" />
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  </button>
                )
              })}
            </>
          )}
        </div>
        <div className="border-t border-[var(--border)] px-3.5 py-2 text-[11.5px] text-[var(--muted-foreground)]">
          ↑↓ 选择 · ↵ 执行 · esc 关闭
        </div>
      </div>
    </div>
  )
}
