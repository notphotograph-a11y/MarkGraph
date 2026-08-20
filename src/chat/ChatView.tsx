/**
 * 问答标签页（F13 / Phase 3）：对整个 vault 提自然语言问题，RAG 流式作答。
 * 会话状态组件本地持有（F13.4：关闭标签即清空，不落盘）；
 * 答案渲染与阅读模式同管线（转义 → wikilink span → marked），引用可点击跳转。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import { FileText, Send } from 'lucide-react'
import { api } from '@/api/client'
import type { ChatSource, ChatTurn } from '@/api/types'
import { useStore } from '@/state/store'
import { useAiStore } from '@/state/ai'
import { buildNameIndex, collectPaths, linkText, makeResolver, parseLink } from '@/editor/wikilink'
import { Button } from '@/components/ui/button'

function escapeHtml(s: string): string {
  // 与 ReadView 一致：不转义 `>`（引用块需要），XSS 关键是 `<` / `&`
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
}

/** 答案 markdown：wikilink → 可点 span，点击跳转（断链不动作） */
function AnswerBody({ content }: { content: string }) {
  const tree = useStore(s => s.tree)
  const openNote = useStore(s => s.openNote)

  const paths = useMemo(() => (tree ? collectPaths(tree.children ?? []) : []), [tree])
  const resolve = useMemo(() => makeResolver(buildNameIndex(paths), ''), [paths])

  const html = useMemo(() => {
    let src = escapeHtml(content)
    src = src.replace(/\[\[([^\[\]]+?)\]\]/g, (_, inner: string) => {
      const parsed = parseLink(inner)
      const targetPath = resolve(parsed.target)
      return `<span class="rd-link${targetPath ? '' : ' rd-broken'}" data-wk="${escapeHtml(parsed.target)}" data-wkp="${escapeHtml(targetPath ?? '')}">${escapeHtml(linkText(parsed))}</span>`
    })
    return marked.parse(src, { async: false })
  }, [content, resolve])

  return (
    <div
      className="mg-read text-[14px] leading-7"
      onClick={e => {
        const el = e.target
        if (!(el instanceof HTMLElement)) return
        const chip = el.closest<HTMLElement>('[data-wk]')
        const targetPath = chip?.dataset.wkp ?? ''
        if (targetPath) void openNote(targetPath)
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function SourceChips({ sources }: { sources: ChatSource[] }) {
  const openNote = useStore(s => s.openNote)
  if (!sources.length) return null
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1">
      <span className="text-[11px] text-[var(--muted-foreground)]">来源</span>
      {sources.map(s => (
        <button
          key={s.path}
          type="button"
          onClick={() => void openNote(s.path)}
          title={s.heading ? `${s.path} · ${s.heading}` : s.path}
          className="flex items-center gap-1 rounded-full bg-[var(--secondary)] px-2 py-0.5 text-[11px] text-[var(--mg-link)] hover:bg-[var(--accent)]"
        >
          <FileText className="h-3 w-3" />
          {s.name}
        </button>
      ))}
    </div>
  )
}

function EmptyState({ configured }: { configured: boolean }) {
  const [indexed, setIndexed] = useState<boolean | null>(null)
  const enrichAll = useAiStore(s => s.enrichAll)

  useEffect(() => {
    if (!configured) return
    api
      .aiHasIndex()
      .then(r => setIndexed(r.indexed))
      .catch(() => setIndexed(null))
  }, [configured])

  return (
    <div className="mg-fade-in flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
      <h2 className="text-[18px] font-semibold tracking-tight">向你的笔记库提问</h2>
      <p className="max-w-sm text-[13px] leading-6 text-[var(--muted-foreground)]">
        {!configured
          ? 'AI 未配置：在服务端 .env 设置 AI_BASE_URL、AI_API_KEY、AI_CHAT_MODEL、AI_EMBED_MODEL 后重启。'
          : indexed === false
            ? '还没有建立索引。先为全库生成一次，之后保存笔记会自动跟进。'
            : '答案只依据库内笔记生成，引用的 [[链接]] 与来源都可以点击跳转。'}
      </p>
      {configured && indexed === false && (
        <Button onClick={() => void enrichAll()}>全库生成索引</Button>
      )}
    </div>
  )
}

export function ChatView() {
  const configured = !!useAiStore(s => s.status?.configured)
  const [msgs, setMsgs] = useState<ChatTurn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // 流式输出时保持贴底
  useEffect(() => {
    const el = scrollRef.current
    if (el && busy) el.scrollTop = el.scrollHeight
  }, [msgs, busy])

  const ask = async () => {
    const q = input.trim()
    if (!q || busy || !configured) return
    const history = msgs.map(m => ({ role: m.role, content: m.content })).slice(-12)
    setInput('')
    setMsgs(prev => [...prev, { role: 'user', content: q }, { role: 'assistant', content: '', sources: [] }])
    setBusy(true)
    const patchLast = (patch: Partial<ChatTurn>) =>
      setMsgs(prev => {
        if (!prev.length) return prev
        const next = [...prev]
        next[next.length - 1] = { ...next[next.length - 1], ...patch }
        return next
      })
    const appendDelta = (t: string) =>
      setMsgs(prev => {
        if (!prev.length) return prev
        const next = [...prev]
        const last = next[next.length - 1]
        next[next.length - 1] = { ...last, content: last.content + t }
        return next
      })
    try {
      await api.aiAsk(q, history, {
        onMeta: sources => patchLast({ sources }),
        onDelta: appendDelta,
      })
    } catch (err) {
      patchLast({ content: `出错了：${(err as Error).message}` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {msgs.length === 0 ? (
          <EmptyState configured={configured} />
        ) : (
          <div className="mx-auto max-w-2xl space-y-5 px-6 py-6">
            {msgs.map((m, i) =>
              m.role === 'user' ? (
                <div key={i} className="mg-msg flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[var(--secondary)] px-3.5 py-2 text-[14px] leading-6">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={i} className="mg-msg min-w-0">
                  <SourceChips sources={m.sources ?? []} />
                  {m.content ? (
                    <AnswerBody content={m.content} />
                  ) : busy && i === msgs.length - 1 ? (
                    <p className="animate-pulse text-[13px] text-[var(--muted-foreground)]">检索笔记中…</p>
                  ) : null}
                </div>
              ),
            )}
          </div>
        )}
      </div>

      <div className="flex-none border-t border-[var(--mg-panel-border)] px-6 py-3.5">
        <div className="mx-auto flex max-w-2xl items-end gap-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void ask()
              }
            }}
            rows={Math.min(4, Math.max(1, input.split('\n').length))}
            placeholder={configured ? '问点什么，例如：卡片盒笔记法的核心原则是什么？' : 'AI 未配置，无法提问'}
            disabled={!configured || busy}
            spellCheck={false}
            className="min-w-0 flex-1 resize-none rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-[14px] leading-6 outline-none placeholder:text-[var(--muted-foreground)] focus-visible:border-[var(--mg-link)] disabled:opacity-50"
          />
          <Button size="sm" onClick={() => void ask()} disabled={!configured || busy || !input.trim()}>
            {busy ? (
              '生成中…'
            ) : (
              <>
                <Send className="h-3.5 w-3.5" /> 提问
              </>
            )}
          </Button>
        </div>
        {msgs.length > 0 && (
          <div className="mx-auto mt-1.5 flex max-w-2xl justify-between text-[11px] text-[var(--muted-foreground)]">
            <span>答案由 AI 依据库内笔记生成，注意核对来源</span>
            <button
              type="button"
              className="rounded px-1.5 py-0.5 hover:bg-[var(--secondary)]"
              onClick={() => (busy ? undefined : setMsgs([]))}
            >
              清空会话
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
