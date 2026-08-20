import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { EditorView } from '@codemirror/view'
import { marked } from 'marked'
import { api } from '@/api/client'
import { useStore } from '@/state/store'
import { bus } from '@/shell/bus'
import type { OutlineTarget } from '@/graph/indexer'
import { buildNameIndex, collectPaths, linkText, makeResolver, parseLink } from './wikilink'
import { splitFrontmatter } from '@/lib/frontmatter'
import { markgraphDecorations } from './decorations'
import { wikilinkCompletions } from './completions'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/** wikilink 点击导航（编辑态 chip 与阅读态 span 共用） */
function useLinkNav() {
  const openNote = useStore(s => s.openNote)
  const refreshTree = useStore(s => s.refreshTree)
  const [broken, setBroken] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const navigate = useCallback(
    (el: HTMLElement) => {
      const chip = el.closest<HTMLElement>('[data-wk]')
      if (!chip) return
      const target = chip.dataset.wk ?? ''
      const resolved = chip.dataset.wkp ?? ''
      if (resolved) {
        void openNote(resolved)
      } else {
        setBroken(target)
      }
    },
    [openNote],
  )

  const createBroken = useCallback(
    async (target: string, currentPath: string) => {
      setCreating(true)
      try {
        const name = target.replace(/\.md$/i, '')
        const dir = currentPath.split('/').slice(0, -1).join('/')
        const p = dir ? `${dir}/${name}.md` : `${name}.md`
        await api.create(p, false)
        await refreshTree()
        setBroken(null)
        await openNote(p)
      } finally {
        setCreating(false)
      }
    },
    [openNote, refreshTree],
  )

  return { navigate, broken, setBroken, creating, createBroken }
}

function BrokenDialog({
  target,
  creating,
  onCancel,
  onConfirm,
}: {
  target: string | null
  creating: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={!!target} onOpenChange={o => !o && onCancel()}>
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>创建此笔记？</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-[var(--muted-foreground)]">
          这是一个断链——目标笔记不存在。创建后将在当前笔记所在文件夹生成并打开。
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            取消
          </Button>
          <Button onClick={onConfirm} disabled={creating}>
            {creating ? '创建中…' : '创建'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const cmTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '15.5px' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.75' },
  '.cm-content': { padding: '20px 24px 40vh 24px', caretColor: 'var(--foreground)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-gutters': { display: 'none' },
  '.cm-activeLine': { background: 'transparent' },
  '.cm-activeLineGutter': { background: 'transparent' },
  '.cm-selectionBackground': { background: 'color-mix(in srgb, var(--primary) 22%, transparent)' },
})

export function Editor({ path }: { path: string }) {
  const note = useStore(s => s.notes[path])
  const tree = useStore(s => s.tree)
  const setNoteContent = useStore(s => s.setNoteContent)
  const markSaving = useStore(s => s.markSaving)
  const markSaved = useStore(s => s.markSaved)
  const { navigate, broken, setBroken, creating, createBroken } = useLinkNav()
  const timer = useRef<number | null>(null)
  const pendingPath = useRef<string | null>(null)
  const contentRef = useRef<string>('')
  const viewRef = useRef<EditorView | null>(null)

  const paths = useMemo(
    () => (tree ? collectPaths(tree.children ?? []) : []),
    [tree],
  )
  const resolve = useMemo(() => makeResolver(buildNameIndex(paths), path), [paths, path])
  const noteNames = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of paths) {
      const base = p.split('/').pop()!.replace(/\.md$/i, '')
      counts.set(base, (counts.get(base) ?? 0) + 1)
    }
    return paths.map(p => {
      const noExt = p.replace(/\.md$/i, '')
      const base = noExt.split('/').pop()!
      return (counts.get(base) ?? 0) > 1 ? noExt : base
    })
  }, [paths])

  const extensions = useMemo(
    () => [
      markdown(),
      EditorView.lineWrapping,
      markgraphDecorations(resolve),
      wikilinkCompletions(() => noteNames),
      cmTheme,
      EditorView.domEventHandlers({
        click(ev) {
          const el = ev.target
          if (el instanceof HTMLElement) navigate(el)
          return false
        },
      }),
    ],
    [resolve, noteNames, navigate],
  )

  const flush = useCallback(async () => {
    const p = pendingPath.current
    if (!p) return
    pendingPath.current = null
    const content = contentRef.current
    markSaving(p, true)
    try {
      const { mtime } = await api.save(p, content)
      markSaved(p, mtime)
    } catch {
      markSaving(p, false)
      // 保存失败保留 dirty，下次再试
      pendingPath.current = p
    }
  }, [markSaving, markSaved])

  const onChange = useCallback(
    (value: string) => {
      contentRef.current = value
      pendingPath.current = path
      setNoteContent(path, value)
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => void flush(), 1500)
    },
    [path, setNoteContent, flush],
  )

  // 卸载 / 切换笔记时保存未落盘内容
  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
      void flush()
    }
  }, [path, flush])

  // 大纲定位（编辑模式）：滚动到标题行并把光标移过去
  useEffect(() => {
    return bus.on('outline:goto', payload => {
      const t = payload as OutlineTarget
      if (t.path !== path) return
      const view = viewRef.current
      if (!view) return
      const lineNo = Math.min(t.line + 1, view.state.doc.lines)
      const pos = view.state.doc.line(lineNo).from
      view.dispatch({
        selection: { anchor: pos },
        effects: EditorView.scrollIntoView(pos, { y: 'center' }),
      })
      view.focus()
    })
  }, [path])

  if (!note) {
    return <div className="flex flex-1 items-center justify-center text-sm text-[var(--muted-foreground)]">加载中…</div>
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {note.externalUpdated && (
        <div className="border-b border-[var(--border)] bg-[var(--secondary)] px-6 py-1.5 text-xs text-[var(--muted-foreground)]">
          文件在服务器端被外部修改，当前编辑未受影响；保存将覆盖外部改动。
        </div>
      )}
      <CodeMirror
        value={note.content}
        height="100%"
        className="mg-cm flex-1 overflow-hidden"
        extensions={extensions}
        onChange={onChange}
        onCreateEditor={v => {
          viewRef.current = v
        }}
        basicSetup={{ foldGutter: false, highlightActiveLine: false, autocompletion: false }}
      />
      <BrokenDialog
        target={broken}
        creating={creating}
        onCancel={() => setBroken(null)}
        onConfirm={() => broken && void createBroken(broken, path)}
      />
    </div>
  )
}

function escapeHtml(s: string): string {
  // 不转义 `>`，否则 marked 无法识别引用块（XSS 关键是 `<` / `&`）
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
}

/** 阅读模式：marked 渲染 + wikilink/标签转可点 span */
export function ReadView({ path }: { path: string }) {
  const note = useStore(s => s.notes[path])
  const tree = useStore(s => s.tree)
  const openNote = useStore(s => s.openNote)
  const refreshTree = useStore(s => s.refreshTree)
  const [broken, setBroken] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const paths = useMemo(
    () => (tree ? collectPaths(tree.children ?? []) : []),
    [tree],
  )
  const resolve = useMemo(() => makeResolver(buildNameIndex(paths), path), [paths, path])

  const html = useMemo(() => {
    if (!note) return ''
    // 阅读模式隐藏 frontmatter 块（F10.3），编辑模式原样可见
    let src = escapeHtml(splitFrontmatter(note.content).body)
    src = src.replace(/\[\[([^\[\]]+?)\]\]/g, (_, inner: string) => {
      const parsed = parseLink(inner)
      const targetPath = resolve(parsed.target)
      return `<span class="rd-link${targetPath ? '' : ' rd-broken'}" data-wk="${escapeHtml(parsed.target)}" data-wkp="${escapeHtml(targetPath ?? '')}">${escapeHtml(linkText(parsed))}</span>`
    })
    src = src.replace(/(^|\s)(#[\p{L}\p{N}_-]+)/gu, '$1<span class="rd-tag">$2</span>')
    return marked.parse(src, { async: false })
  }, [note, resolve])

  // 大纲定位（阅读模式）：按序号/标题匹配滚动到对应 heading
  useEffect(() => {
    return bus.on('outline:goto', payload => {
      const t = payload as OutlineTarget
      if (t.path !== path) return
      const heads = rootRef.current?.querySelectorAll('h1, h2, h3, h4')
      if (!heads || heads.length === 0) return
      let el = heads[Math.min(t.index, heads.length - 1)]
      if (el.tagName.toLowerCase() !== `h${t.level}` || el.textContent !== t.text) {
        el =
          [...heads].find(
            h => h.tagName.toLowerCase() === `h${t.level}` && h.textContent === t.text,
          ) ?? el
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [path])

  const createBroken = async (target: string) => {
    setCreating(true)
    try {
      const name = target.replace(/\.md$/i, '')
      const dir = path.split('/').slice(0, -1).join('/')
      const p = dir ? `${dir}/${name}.md` : `${name}.md`
      await api.create(p, false)
      await refreshTree()
      setBroken(null)
      await openNote(p)
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      <div
        ref={rootRef}
        className="mg-read flex-1 overflow-auto px-10 py-8 text-[15.5px] leading-7"
        onClick={e => {
          const el = e.target
          if (!(el instanceof HTMLElement)) return
          const chip = el.closest<HTMLElement>('[data-wk]')
          if (!chip) return
          const targetPath = chip.dataset.wkp ?? ''
          if (targetPath) void openNote(targetPath)
          else setBroken(chip.dataset.wk ?? '')
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      >
        {/* 阅读内容渲染容器 */}
      </div>
      <BrokenDialog
        target={broken}
        creating={creating}
        onCancel={() => setBroken(null)}
        onConfirm={() => broken && void createBroken(broken)}
      />
    </>
  )
}

export { BrokenDialog }
