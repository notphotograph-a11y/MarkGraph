import { useCallback, useEffect, useMemo, useRef } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { EditorView } from '@codemirror/view'
import { api } from '@/api/client'
import { useStore } from '@/state/store'
import { bus } from '@/shell/bus'
import type { OutlineTarget } from '@/graph/indexer'
import { buildNameIndex, collectPaths, makeResolver } from './wikilink'
import { splitFrontmatter } from '@/lib/frontmatter'
import { markgraphDecorations } from './decorations'
import { wikilinkCompletions } from './completions'
import { renderMarkdown } from './markdown'

/** wikilink/标签点击导航（编辑态 chip 与阅读态 span 共用） */
function useLinkNav(currentPath: string) {
  const openNote = useStore(s => s.openNote)
  const openTag = useStore(s => s.openTag)
  const refreshTree = useStore(s => s.refreshTree)
  const creatingRef = useRef(false)

  const navigate = useCallback(
    (el: HTMLElement) => {
      // 标签 chip → 标签视图（F29.1）
      const tagChip = el.closest<HTMLElement>('[data-tag]')
      if (tagChip) {
        openTag(tagChip.dataset.tag ?? '')
        return
      }
      const chip = el.closest<HTMLElement>('[data-wk]')
      if (!chip) return
      const target = chip.dataset.wk ?? ''
      const resolved = chip.dataset.wkp ?? ''
      if (resolved) {
        void openNote(resolved)
        return
      }
      if (!target || creatingRef.current) return
      creatingRef.current = true
      const name = target.replace(/\.md$/i, '')
      const dir = currentPath.split('/').slice(0, -1).join('/')
      const p = dir ? `${dir}/${name}.md` : `${name}.md`
      void (async () => {
        try {
          await api.create(p, false)
          await refreshTree()
        } catch {
          // 已存在（连点/竞态）：直接打开
        }
        await openNote(p)
      })().finally(() => {
        creatingRef.current = false
      })
    },
    [openNote, openTag, refreshTree, currentPath],
  )

  return { navigate }
}

const IMAGE_FILE = /^image\/(png|jpeg|gif|webp)$/i

function insertUploaded(view: EditorView, files: File[]) {
  const images = files.filter(f => IMAGE_FILE.test(f.type) || /\.(png|jpe?g|gif|webp)$/i.test(f.name))
  if (images.length === 0) return false
  void (async () => {
    const chunks: string[] = []
    for (const f of images) {
      try {
        const { path: rel } = await api.upload(f)
        const alt = f.name.replace(/\.[^.]+$/, '')
        chunks.push(`![${alt}](${rel})`)
      } catch (err) {
        chunks.push(`<!-- 图片上传失败：${(err as Error).message} -->`)
      }
    }
    if (chunks.length === 0) return
    const text = chunks.join('\n')
    const { from, to } = view.state.selection.main
    const pad = from === to && from > 0 && view.state.doc.sliceString(from - 1, from) !== '\n' ? '\n' : ''
    view.dispatch({
      changes: { from, to, insert: pad + text },
      selection: { anchor: from + pad.length + text.length },
    })
  })()
  return true
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
  const { navigate } = useLinkNav(path)
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
        paste(ev, view) {
          const files = [...(ev.clipboardData?.files ?? [])]
          if (files.length && insertUploaded(view, files)) {
            ev.preventDefault()
            return true
          }
          return false
        },
        drop(ev, view) {
          const files = [...(ev.dataTransfer?.files ?? [])]
          if (files.length && insertUploaded(view, files)) {
            ev.preventDefault()
            return true
          }
          return false
        },
        dragover(ev) {
          if (ev.dataTransfer?.types.includes('Files')) {
            ev.preventDefault()
            return true
          }
          return false
        },
      }),
    ],
    [resolve, noteNames, navigate, path],
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

  // ⌘S 立即落盘（F26.2）
  useEffect(() => {
    return bus.on('editor:flush', () => {
      if (timer.current) window.clearTimeout(timer.current)
      void flush()
    })
  }, [flush])

  // 搜索命中定位（F28.1）：打开后滚动到命中行并选中命中词
  // 依赖 activeIndex：tab 已存在时再次导航也要重新定位
  const activeIndex = useStore(s => s.activeIndex)
  useEffect(() => {
    if (!note) return
    if (useStore.getState().activeIndex !== activeIndex) return
    const nav = useStore.getState().consumeNav(path)
    if (!nav) return
    const t = window.setTimeout(() => {
      const view = viewRef.current
      if (!view) return
      const lineNo = Math.min((nav.line ?? 0) + 1, view.state.doc.lines)
      const line = view.state.doc.line(lineNo)
      let from = line.from
      let to = line.from
      const q = nav.query?.toLowerCase()
      if (q) {
        const idx = line.text.toLowerCase().indexOf(q)
        if (idx >= 0) {
          from = line.from + idx
          to = from + nav.query!.length
        }
      }
      view.dispatch({
        selection: { anchor: from, head: to },
        effects: EditorView.scrollIntoView(from, { y: 'center' }),
      })
      view.focus()
    }, 60)
    return () => window.clearTimeout(t)
  }, [path, note, activeIndex])

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
    </div>
  )
}

/** 阅读模式：marked 渲染 + wikilink/标签转可点 span */
export function ReadView({ path }: { path: string }) {
  const note = useStore(s => s.notes[path])
  const tree = useStore(s => s.tree)
  const activeIndex = useStore(s => s.activeIndex)
  const { navigate } = useLinkNav(path)
  const rootRef = useRef<HTMLDivElement>(null)

  const paths = useMemo(
    () => (tree ? collectPaths(tree.children ?? []) : []),
    [tree],
  )
  const resolve = useMemo(() => makeResolver(buildNameIndex(paths), path), [paths, path])

  const html = useMemo(() => {
    if (!note) return ''
    // 阅读模式隐藏 frontmatter 块（F10.3），编辑模式原样可见
    return renderMarkdown(splitFrontmatter(note.content).body, resolve)
  }, [note, resolve, path])

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

  // 搜索命中定位（F28.1 · 阅读态）：找到首个命中词 → 选中并滚动居中
  useEffect(() => {
    if (!note) return
    const nav = useStore.getState().consumeNav(path)
    if (!nav?.query) return
    const t = window.setTimeout(() => {
      const root = rootRef.current
      if (!root) return
      const q = nav.query!.toLowerCase()
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let node: Node | null
      while ((node = walker.nextNode())) {
        const text = node.nodeValue ?? ''
        const idx = text.toLowerCase().indexOf(q)
        if (idx < 0) continue
        const range = document.createRange()
        range.setStart(node, idx)
        range.setEnd(node, idx + nav.query!.length)
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
        range.startContainer.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        break
      }
    }, 80)
    return () => window.clearTimeout(t)
  }, [path, note, activeIndex])

  return (
    <>
      <div
        ref={rootRef}
        className="mg-read flex-1 overflow-auto px-10 py-8 text-[15.5px] leading-7"
        onClick={e => {
          const el = e.target
          if (el instanceof HTMLElement) navigate(el)
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      >
        {/* 阅读内容渲染容器 */}
      </div>
    </>
  )
}
