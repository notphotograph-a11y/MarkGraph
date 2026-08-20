/**
 * 富集流水线（F9.3 / F10 / F11）：防抖 + 串行队列 + 编排。
 * 单次富集 = 1 次 embeddings + 1 次 chat（摘要/标签/建议链接一并产出）。
 * 触发源只有「用户保存」与「手动命令」，不监听文件变更，天然无回环。
 */
import { readNote, writeNote, readTree, type VaultNode } from '../fs-vault.js'
import { readAiEnv, isConfigured, DEBOUNCE_MS, type AiEnv } from './config.js'
import { loadSettings } from './settings.js'
import { AiError, chatJson, embed, extractJson } from './openai.js'
import {
  fmSummary,
  fmTags,
  sanitizeSummary,
  sanitizeTags,
  splitFrontmatter,
  writeFrontmatter,
} from './frontmatter.js'
import * as store from './store.js'
import { buildNameIndex, insertLink, linkedTargets, resolveTarget } from './links.js'
import { chunkNote } from './rag.js'

export type AiEvent =
  | { type: 'note'; path: string }
  | { type: 'progress'; done: number; total: number }
  | { type: 'settings'; settings: Awaited<ReturnType<typeof loadSettings>> }

const aiHandlers = new Set<(e: AiEvent) => void>()

export function onAiEvent(h: (e: AiEvent) => void): () => void {
  aiHandlers.add(h)
  return () => {
    aiHandlers.delete(h)
  }
}

export function emitAi(e: AiEvent): void {
  aiHandlers.forEach(h => h(e))
}

/* ============ 串行队列 + 每篇防抖 ============ */

let chain: Promise<void> = Promise.resolve()
let running = false

function enqueue(job: () => Promise<void>): void {
  chain = chain
    .then(async () => {
      running = true
      await job()
    })
    .catch(err => console.error('[MarkGraph/AI]', (err as Error).message))
    .finally(() => {
      running = false
    })
}

const pending = new Map<string, NodeJS.Timeout>()

export function scheduleEnrich(path: string, delayMs: number = DEBOUNCE_MS): void {
  const cur = pending.get(path)
  if (cur) clearTimeout(cur)
  pending.set(
    path,
    setTimeout(() => {
      pending.delete(path)
      enqueue(() => enrichNote(path))
    }, delayMs),
  )
}

export function aiStatusSnapshot(): { running: boolean; queued: number } {
  return { running, queued: pending.size + (running ? 1 : 0) }
}

/* ============ 单篇富集 ============ */

const SYSTEM_PROMPT =
  '你是中文 Markdown 双链笔记库的整理助手。只输出一个 JSON 对象，不要输出 JSON 以外的任何内容。'

const noteName = (p: string) => p.split('/').pop()!.replace(/\.md$/i, '')

/**
 * 切块向量化（F13.2）：块向量存 `${hash}#${i}`（RAG 检索用），
 * 笔记级向量 = 块均值（相关笔记 / 语义搜索用），一次调用两用。
 */
async function embedNote(env: AiEnv, hash: string, body: string): Promise<number[]> {
  const chunks = chunkNote(body)
  const vecs = await embed(env, chunks.map(c => c.t.slice(0, 4000)))
  if (!vecs.length) throw new Error('切块结果为空')
  await store.setChunks(hash, chunks)
  for (let i = 0; i < vecs.length; i++) await store.setVector(`${hash}#${i}`, vecs[i])
  const mean = vecs[0].map((_, j) => vecs.reduce((a, v) => a + (v[j] ?? 0), 0) / vecs.length)
  await store.setVector(hash, mean)
  return mean
}

export async function enrichNote(path: string): Promise<void> {
  const env = readAiEnv()
  if (!isConfigured(env)) return
  const settings = await loadSettings()
  if (!settings.autoTags && !settings.autoSummary && settings.autoLinks === 'off') return

  let content: string
  try {
    ;({ content } = await readNote(path))
  } catch {
    return // 笔记已被删除
  }
  const { fm, body } = splitFrontmatter(content)
  if (body.trim().length < 20) return // 空笔记不烧 token（F9.3）

  const bodyHash = store.contentHash(body)
  const state = await store.getNoteState(path)
  if (state?.hash === bodyHash) return // 正文未变，幂等跳过

  // 向量（优先缓存；失败降级：跳过候选但保留摘要/标签）
  let vector = await store.getVector(bodyHash)
  if (!vector) {
    try {
      vector = await embedNote(env, bodyHash, body)
    } catch (err) {
      console.error('[MarkGraph/AI] 向量化失败，本次仅生成摘要/标签', (err as Error).message)
    }
  }

  // 候选笔记（已排除自身与已链接目标在 prompt 后过滤）
  const nameIndex = await buildNameIndex()
  const candidates =
    settings.autoLinks === 'off' ? [] : await rankCandidates(path, vector, await knownSummaries(), 20)

  let parsed: Record<string, unknown> = {}
  try {
    parsed = extractJson(await chatJson(env, SYSTEM_PROMPT, buildUserPrompt(path, body, candidates))) ?? {}
  } catch (err) {
    if (err instanceof AiError) {
      console.error('[MarkGraph/AI] chat 失败，跳过本篇', (err as Error).message)
      return
    }
    throw err
  }

  const tags = settings.autoTags ? mergeTags(fmTags(fm), sanitizeTags(parsed.tags)) : null
  const summary = settings.autoSummary ? sanitizeSummary(parsed.summary) : null
  const suggestions = parseSuggestions(parsed.links, nameIndex, linkedTargets(body), path)

  // 自动应用链接（F11.4）
  let newBody = body
  if (settings.autoLinks === 'auto') {
    let applied = 0
    for (const s of suggestions) {
      if (applied >= settings.maxAutoLinks) break
      const inserted = insertLink(newBody, s.anchor, s.target)
      if (inserted === null) continue
      newBody = inserted
      s.applied = true
      applied++
    }
  }

  const contentFromBody = (f: string | null, b: string) => (f === null ? b : `---\n${f}\n---\n${b}`)
  let nextContent = contentFromBody(fm, newBody)
  if (tags || summary) {
    nextContent = writeFrontmatter(nextContent, tags ?? fmTags(fm), summary ?? fmSummary(fm))
  }

  if (nextContent !== content) {
    // 乐观并发：落盘前文件若已被人改动，放弃并择机重试（F9.5）
    const cur = await readNote(path).catch(() => null)
    if (!cur || cur.content !== content) {
      scheduleEnrich(path, 15_000)
      return
    }
    await store.recordWrite(path, content, nextContent)
    await writeNote(path, nextContent)
  }

  const newHash = store.contentHash(newBody)
  if (newBody !== body) await store.reuseVector(bodyHash, newHash)
  await store.setNoteState(path, {
    hash: newHash,
    summary: summary ?? state?.summary ?? fmSummary(fm),
    tags: tags ?? state?.tags ?? fmTags(fm),
    suggestions,
    enrichedAt: Date.now(),
  })
  emitAi({ type: 'note', path })
}

function mergeTags(existing: string[], aiTags: string[]): string[] {
  const out = [...existing]
  for (const t of aiTags) {
    if (!out.some(x => x.toLowerCase() === t.toLowerCase())) out.push(t)
    if (out.length >= 8) break
  }
  return out
}

function parseSuggestions(
  raw: unknown,
  nameIndex: Map<string, string[]>,
  already: Set<string>,
  currentPath: string,
): store.StoredSuggestion[] {
  if (!Array.isArray(raw)) return []
  const out: store.StoredSuggestion[] = []
  for (const l of raw) {
    if (typeof l !== 'object' || l === null) continue
    const { target, reason, anchor } = l as Record<string, unknown>
    if (typeof target !== 'string' || typeof anchor !== 'string' || !anchor.trim()) continue
    const resolved = resolveTarget(nameIndex, target, currentPath)
    if (!resolved || resolved === currentPath) continue
    // 同名笔记用路径形式写链接，避免歧义解析
    const name = noteName(resolved)
    const linkText =
      (nameIndex.get(name.toLowerCase())?.length ?? 0) > 1 ? resolved.replace(/\.md$/i, '') : name
    if (already.has(linkText.toLowerCase())) continue
    if (out.some(s => s.target === linkText)) continue
    out.push({
      target: linkText,
      reason: typeof reason === 'string' ? reason.slice(0, 40) : '',
      anchor: anchor.trim().slice(0, 60),
      applied: false,
    })
    if (out.length >= 5) break
  }
  return out
}

async function knownSummaries(): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const [p, s] of Object.entries(await store.allNoteStates())) {
    if (s.summary) out.set(p, s.summary)
  }
  return out
}

async function rankCandidates(
  path: string,
  vector: number[] | undefined,
  summaries: Map<string, string>,
  k: number,
): Promise<{ path: string; summary: string }[]> {
  const all = await store.allVectors()
  if (vector) {
    return [...all]
      .filter(([p]) => p !== path)
      .map(([p, v]) => ({ path: p, summary: summaries.get(p) ?? '', score: store.cosine(vector, v) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map(({ path: p, summary }) => ({ path: p, summary }))
  }
  // 无向量降级：取任意已富集笔记
  return [...all.keys()]
    .filter(p => p !== path)
    .slice(0, k)
    .map(p => ({ path: p, summary: summaries.get(p) ?? '' }))
}

function buildUserPrompt(
  path: string,
  body: string,
  candidates: { path: string; summary: string }[],
): string {
  const candBlock = candidates.length
    ? candidates.map(c => `- ${c.path} | ${c.summary || '（未索引）'}`).join('\n')
    : '（无。links 输出空数组）'
  return `请阅读这篇笔记，输出一个 JSON 对象：
{
  "summary": "一句话摘要，不超过 80 字",
  "tags": ["3-5 个标签，每个不超过 12 字，不带 #"],
  "links": [{"target": "候选笔记的路径", "reason": "为何相关，15 字内", "anchor": "正文中出现的原句片段（10-40 字，必须与正文一字不差）"}]
}
要求：links 只能从候选笔记里选，挑内容强相关的，宁缺毋滥；anchor 用于定位插入链接的位置。

笔记（${path}）正文：
${body.slice(0, 6000)}

候选笔记（路径 | 摘要）：
${candBlock}`
}

/* ============ 全库富集 / 应用 / 撤销 / 查询 ============ */

export async function scheduleEnrichAll(): Promise<number> {
  const tree = await readTree()
  const paths: string[] = []
  const walk = (n: VaultNode | null) => {
    if (!n) return
    if (n.type === 'file') paths.push(n.path)
    n.children?.forEach(walk)
  }
  walk(tree)
  emitAi({ type: 'progress', done: 0, total: paths.length })
  paths.forEach((p, i) => {
    enqueue(async () => {
      await enrichNote(p)
      emitAi({ type: 'progress', done: i + 1, total: paths.length })
    })
  })
  return paths.length
}

export async function applySuggestion(path: string, target: string, anchor: string): Promise<void> {
  const { content } = await readNote(path)
  const { fm, body } = splitFrontmatter(content)
  const next = insertLink(body, anchor, target)
  if (next === null) throw Object.assign(new Error('在正文中找不到建议定位的原句'), { statusCode: 400 })
  const nextContent = fm === null ? next : `---\n${fm}\n---\n${next}`
  const cur = await readNote(path).catch(() => null)
  if (!cur || cur.content !== content) {
    throw Object.assign(new Error('笔记刚被修改，请稍后重试'), { statusCode: 409 })
  }
  await store.recordWrite(path, content, nextContent)
  await writeNote(path, nextContent)
  const state = await store.getNoteState(path)
  if (state) {
    const newHash = store.contentHash(next)
    await store.reuseVector(state.hash, newHash)
    await store.setNoteState(path, {
      ...state,
      hash: newHash,
      suggestions: state.suggestions.map(s => (s.target === target ? { ...s, applied: true } : s)),
    })
  }
  emitAi({ type: 'note', path })
}

export async function undoLast(path: string): Promise<void> {
  const last = store.getLastWrite(path)
  if (!last) throw Object.assign(new Error('没有可撤销的 AI 修改'), { statusCode: 400 })
  const { content } = await readNote(path).catch(() => {
    throw Object.assign(new Error('笔记不存在'), { statusCode: 404 })
  })
  if (content !== last.after) {
    throw Object.assign(
      new Error('笔记在 AI 修改后已被人工改动，不能自动撤销；可从 vault 的 .markgraph/backups 手动恢复'),
      { statusCode: 409 },
    )
  }
  await writeNote(path, last.before)
  store.clearLastWrite(path)
  const state = await store.getNoteState(path)
  if (state) {
    const { body } = splitFrontmatter(last.before)
    const h = store.contentHash(body)
    await store.reuseVector(state.hash, h)
    await store.setNoteState(path, {
      ...state,
      hash: h,
      // 撤销把链接从正文拿掉了，建议恢复为未应用
      suggestions: state.suggestions.map(s => ({ ...s, applied: false })),
    })
  }
  emitAi({ type: 'note', path })
}

export async function relatedNotes(path: string, k = 6): Promise<{ path: string; score: number }[]> {
  const state = await store.getNoteState(path)
  if (!state) return []
  const vec = await store.getVector(state.hash)
  if (!vec) return []
  const all = await store.allVectors()
  return [...all]
    .filter(([p]) => p !== path)
    .map(([p, v]) => ({ path: p, score: store.cosine(vec, v) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}

export async function semanticSearch(q: string): Promise<{ path: string; score: number }[]> {
  const env = readAiEnv()
  if (!isConfigured(env)) return []
  const [qv] = await embed(env, [q])
  const all = await store.allVectors()
  return [...all]
    .map(([p, v]) => ({ path: p, score: store.cosine(qv, v) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
}

/** 单篇 AI 视图（GET /api/ai/notes 数据源） */
export async function noteView(path: string) {
  const { content } = await readNote(path)
  const { fm } = splitFrontmatter(content)
  const state = await store.getNoteState(path)
  const nameIndex = await buildNameIndex()
  const suggestions = (state?.suggestions ?? [])
    .map(s => ({ ...s, targetPath: resolveTarget(nameIndex, s.target, path) ?? '' }))
    .filter(s => s.targetPath && s.targetPath !== path)
  return {
    summary: fmSummary(fm),
    tags: fmTags(fm),
    related: await relatedNotes(path),
    suggestions,
    enrichedAt: state?.enrichedAt ?? null,
    indexed: !!(state && (await store.getVector(state.hash))),
    canUndo: store.getLastWrite(path) !== undefined,
  }
}
