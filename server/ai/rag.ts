/**
 * RAG 问答（F13 / docs/02 §10）：切块在富集时由 enrich 生成，
 * 这里负责「检索（块向量余弦，每篇取最佳块，top 6）→ 流式生成（带来源引用）」。
 */
import { readAiEnv, isConfigured } from './config.js'
import { chatStream, embed, type ChatMessage } from './openai.js'
import * as store from './store.js'

const noteName = (p: string) => p.split('/').pop()!.replace(/\.md$/i, '')

/** 目标块大小（字符） */
const CHUNK_TARGET = 600
/** 单块硬上限 */
const CHUNK_MAX = 800

/**
 * 按「当前标题 + 空行分段」切块（F13.2）：块文本自带标题前缀一起向量化，
 * 检索命中即知道所属章节。返回 { t: 块文本, h: 所属标题 }。
 */
export function chunkNote(body: string): { t: string; h: string }[] {
  const chunks: { t: string; h: string }[] = []
  let heading = ''
  let buf = ''

  const flush = () => {
    const text = buf.trim()
    buf = ''
    if (!text) return
    chunks.push({ t: heading ? `${heading}\n${text}` : text, h: heading })
  }

  for (const block of body.split(/\n\s*\n/)) {
    const hm = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(block.trim())
    if (hm) {
      flush()
      heading = hm[0].trim()
      continue
    }
    // 单段超长：硬切
    if (block.length > CHUNK_MAX) {
      flush()
      for (let i = 0; i < block.length; i += CHUNK_TARGET) {
        const piece = block.slice(i, i + CHUNK_TARGET).trim()
        if (piece) chunks.push({ t: heading ? `${heading}\n${piece}` : piece, h: heading })
      }
      continue
    }
    buf += (buf ? '\n' : '') + block.trim()
    if (buf.length >= CHUNK_TARGET) flush()
  }
  flush()
  // 超长笔记保护性截断（向量批大小与上下文体积可控）
  return chunks.slice(0, 20)
}

export interface RetrievedSource {
  path: string
  name: string
  heading: string
  text: string
  score: number
}

/** 检索：每篇笔记取最佳块，全库 top 6（F13.2） */
export async function retrieve(queryVec: number[]): Promise<RetrievedSource[]> {
  const states = await store.allNoteStates()
  const scored: RetrievedSource[] = []
  for (const [p, s] of Object.entries(states)) {
    const chunks = await store.getChunks(s.hash)
    if (!chunks) continue
    let best: { i: number; score: number } | null = null
    for (let i = 0; i < chunks.length; i++) {
      const v = await store.getVector(`${s.hash}#${i}`)
      if (!v) continue
      const score = store.cosine(queryVec, v)
      if (!best || score > best.score) best = { i, score }
    }
    if (best && best.score > 0.05) {
      scored.push({
        path: p,
        name: noteName(p),
        heading: chunks[best.i].h.replace(/^#+\s*/, ''),
        text: chunks[best.i].t,
        score: best.score,
      })
    }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 6)
}

const ASK_SYSTEM =
  '你是中文双链笔记库的问答助手。只依据给出的笔记片段回答问题；片段不足以回答时，明确说明笔记库中没有足够信息，不要编造。' +
  '引用来源笔记时使用 [[笔记名]] 维基链接语法。回答使用简体中文，适度使用列表与标题组织结构。'

/** 库内是否有可用索引（前端空态判断用） */
export async function hasIndex(): Promise<boolean> {
  return (await store.allVectors()).size > 0
}

/**
 * 问答编排：embed 问题 → 检索 → 流式生成。
 * onMeta 在生成开始前回调来源列表；错误向上抛（路由层转 SSE error 事件）。
 */
export async function askVault(
  q: string,
  history: ChatMessage[],
  onMeta: (sources: RetrievedSource[]) => void,
  onDelta: (text: string) => void,
): Promise<void> {
  const env = readAiEnv()
  if (!isConfigured(env)) throw Object.assign(new Error('AI 未配置'), { statusCode: 503 })

  const [qv] = await embed(env, [q])
  const sources = await retrieve(qv)
  onMeta(sources)

  const context = sources.length
    ? sources.map(s => `【笔记 ${s.name}】(${s.path})\n${s.text}`).join('\n\n')
    : '（本次检索没有找到相关笔记片段）'

  const messages: ChatMessage[] = [
    { role: 'system', content: ASK_SYSTEM },
    ...history.slice(-12),
    { role: 'user', content: `笔记片段：\n${context}\n\n问题：${q}` },
  ]
  await chatStream(env, messages, onDelta)
}
