/**
 * AI 数据存储（F9.4 / §9 存储）：全部落在 VAULT_DIR/.markgraph/。
 * - cache.json：正文 hash → 向量
 * - notes.json：路径 → 富集状态（hash、摘要、建议、时间）
 * - backups/：AI 写入前的完整快照（保留最近 50 份）
 * 内存态 + 防抖落盘，进程退出最多丢 2s 内的缓存（可重算）。
 */
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { MARKGRAPH_DIR } from './config.js'

export interface StoredSuggestion {
  target: string
  reason: string
  anchor: string
  applied: boolean
}

interface NoteState {
  /** 去掉 frontmatter 的正文 hash（幂等键） */
  hash: string
  summary: string
  tags: string[]
  suggestions: StoredSuggestion[]
  enrichedAt: number
}

interface CacheShape {
  vectors: Record<string, number[]>
  notes: Record<string, NoteState>
  /** 正文 hash → 块文本列表（块向量在 vectors 里，键 `${hash}#${i}`） */
  chunks: Record<string, { t: string; h: string }[]>
}

/** 每篇笔记最近一次 AI 写入（撤销用；进程内即够） */
const lastWrites = new Map<string, { before: string; after: string }>()

const cache: CacheShape = { vectors: {}, notes: {}, chunks: {} }
let loaded = false
let saveTimer: NodeJS.Timeout | null = null

export function contentHash(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 24)
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return
  loaded = true
  for (const name of ['cache.json', 'notes.json', 'chunks.json'] as const) {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(MARKGRAPH_DIR, name), 'utf8'))
      const map =
        raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
      if (name === 'cache.json') cache.vectors = map as Record<string, number[]>
      else if (name === 'notes.json') cache.notes = map as typeof cache.notes
      else cache.chunks = map as typeof cache.chunks
    } catch {
      /* 首次启动无文件 */
    }
  }
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void (async () => {
      await fs.mkdir(MARKGRAPH_DIR, { recursive: true })
      await fs.writeFile(path.join(MARKGRAPH_DIR, 'cache.json'), JSON.stringify(cache.vectors), 'utf8')
      await fs.writeFile(path.join(MARKGRAPH_DIR, 'notes.json'), JSON.stringify(cache.notes), 'utf8')
      await fs.writeFile(path.join(MARKGRAPH_DIR, 'chunks.json'), JSON.stringify(cache.chunks), 'utf8')
    })().catch(err => console.error('[MarkGraph/AI] 缓存落盘失败', (err as Error).message))
  }, 2000)
}

/* ============ 富集状态 ============ */

export async function getNoteState(p: string): Promise<NoteState | undefined> {
  await ensureLoaded()
  return cache.notes[p]
}

export async function setNoteState(p: string, s: NoteState): Promise<void> {
  await ensureLoaded()
  cache.notes[p] = s
  scheduleSave()
}

export async function dropNoteState(p: string): Promise<void> {
  await ensureLoaded()
  delete cache.notes[p]
  scheduleSave()
}

/** 全部富集状态（候选摘要、进度统计用） */
export async function allNoteStates(): Promise<Record<string, NoteState>> {
  await ensureLoaded()
  return cache.notes
}

/* ============ 向量 ============ */

export async function getVector(hash: string): Promise<number[] | undefined> {
  await ensureLoaded()
  return cache.vectors[hash]
}

export async function setVector(hash: string, vec: number[]): Promise<void> {
  await ensureLoaded()
  cache.vectors[hash] = vec
  scheduleSave()
}

/** 正文小改（如插入一条链接）后把旧缓存挂到新 hash 上，省一次 embedding 调用 */
export async function reuseVector(oldHash: string, newHash: string): Promise<void> {
  if (oldHash === newHash) return
  const v = await getVector(oldHash)
  if (v) await setVector(newHash, v)
  // 块与块向量一并前移，保证 RAG 检索不缺块
  const chunks = await getChunks(oldHash)
  if (chunks) {
    for (let i = 0; i < chunks.length; i++) {
      const cv = await getVector(`${oldHash}#${i}`)
      if (cv) await setVector(`${newHash}#${i}`, cv)
    }
    await setChunks(newHash, chunks)
  }
}

/* ============ 块（RAG 检索单元） ============ */

export async function getChunks(hash: string): Promise<{ t: string; h: string }[] | undefined> {
  await ensureLoaded()
  return cache.chunks[hash]
}

export async function setChunks(hash: string, chunks: { t: string; h: string }[]): Promise<void> {
  await ensureLoaded()
  cache.chunks[hash] = chunks
  scheduleSave()
}

/** 全部 (路径, 向量) 对，相关笔记与语义搜索的数据源 */
export async function allVectors(): Promise<Map<string, number[]>> {
  await ensureLoaded()
  const out = new Map<string, number[]>()
  for (const [p, s] of Object.entries(cache.notes)) {
    const v = cache.vectors[s.hash]
    if (v) out.set(p, v)
  }
  return out
}

/** 余弦相似度（向量来自同一 embedding 模型，可不做模长缓存） */
export function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (!na || !nb) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/* ============ 备份与撤销（F9.4 / F11.5） ============ */

export function getLastWrite(p: string): { before: string; after: string } | undefined {
  return lastWrites.get(p)
}

export async function recordWrite(p: string, before: string, after: string): Promise<void> {
  lastWrites.set(p, { before, after })
  await fs.mkdir(path.join(MARKGRAPH_DIR, 'backups'), { recursive: true })
  const file = path.join(MARKGRAPH_DIR, 'backups', `${Date.now()}-${contentHash(p)}.md`)
  await fs.writeFile(file, before, 'utf8')
  // 只保留最近 50 份
  const entries = (await fs.readdir(path.join(MARKGRAPH_DIR, 'backups'))).filter(f => f.endsWith('.md'))
  if (entries.length > 50) {
    entries.sort()
    for (const f of entries.slice(0, entries.length - 50)) {
      await fs.rm(path.join(MARKGRAPH_DIR, 'backups', f), { force: true }).catch(() => undefined)
    }
  }
}

export function clearLastWrite(p: string): void {
  lastWrites.delete(p)
}
