/**
 * 回收站（F23.4 / N12 保留策略）：agent 通道删除一律进 .markgraph/trash/，永不物理删除。
 * 浏览器删除行为不变（仍走 fs-vault deleteNode）。
 * 保留上限：200 份或 30 天，超限最旧物理清除（每次删除时顺带清理）。
 */
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { readNote, safeJoin, writeNote, rejectHiddenSegments, isMarkdownRel } from '../fs-vault.js'

const TRASH_DIR = () => path.join(safeJoin('.markgraph'), 'trash')
const INDEX_FILE = () => path.join(TRASH_DIR(), 'index.json')

/** 上限：最多 200 份、保留 30 天 */
export const MAX_ENTRIES = 200
export const MAX_AGE_MS = 30 * 24 * 3600 * 1000

export interface TrashEntry {
  id: string
  /** 删除时的 vault 相对路径 */
  path: string
  deletedAt: string
  reason?: string
}

async function readIndex(): Promise<TrashEntry[]> {
  try {
    const raw = JSON.parse(await fs.readFile(INDEX_FILE(), 'utf8')) as { entries?: TrashEntry[] }
    return Array.isArray(raw.entries) ? raw.entries : []
  } catch {
    return []
  }
}

async function writeIndex(entries: TrashEntry[]): Promise<void> {
  await fs.mkdir(TRASH_DIR(), { recursive: true })
  await fs.writeFile(INDEX_FILE(), JSON.stringify({ entries }, null, 2) + '\n', 'utf8')
}

/** 删除笔记 → 回收站；返回条目 id */
export async function deleteToTrash(rel: string, reason?: string): Promise<TrashEntry> {
  if (!isMarkdownRel(rel)) throw Object.assign(new Error('只能删除 .md 笔记'), { statusCode: 400 })
  rejectHiddenSegments(rel)
  const { content } = await readNote(rel) // 不存在会抛 404 语义错误
  const id = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
  const entry: TrashEntry = { id, path: rel, deletedAt: new Date().toISOString(), reason }
  const dir = path.join(TRASH_DIR(), id)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'note.md'), content, 'utf8')
  const entries = await readIndex()
  entries.push(entry)
  // 保留策略：超限最旧物理清除
  const now = Date.now()
  const expired = entries.filter(e => now - Date.parse(e.deletedAt) > MAX_AGE_MS).map(e => e.id)
  let kept = entries.filter(e => !expired.includes(e.id))
  if (kept.length > MAX_ENTRIES) {
    const overflow = kept.slice(0, kept.length - MAX_ENTRIES).map(e => e.id)
    kept = kept.filter(e => !overflow.includes(e.id))
    overflow.forEach(i => expired.push(i))
  }
  await writeIndex(kept)
  await Promise.all(
    expired.map(async i => {
      await fs.rm(path.join(TRASH_DIR(), i), { recursive: true, force: true }).catch(() => undefined)
    }),
  )
  // 物理移除原文件（回收站已留副本）
  await fs.rm(safeJoin(rel), { force: true })
  // 清掉因此变空的父目录（只删空目录，向上到 vault 根为止）
  let cur = path.dirname(safeJoin(rel))
  const vaultRoot = path.dirname(safeJoin('.markgraph'))
  while (cur.startsWith(vaultRoot + path.sep)) {
    const items = await fs.readdir(cur).catch(() => null)
    if (items && items.length === 0 && cur !== vaultRoot) {
      await fs.rmdir(cur).catch(() => undefined)
      cur = path.dirname(cur)
    } else break
  }
  return entry
}

export async function listTrash(): Promise<TrashEntry[]> {
  return readIndex()
}

/** 恢复到原路径；原路径已有文件则 409（附建议），笔记内容未做合并 */
export async function restoreFromTrash(id: string): Promise<{ path: string }> {
  const entries = await readIndex()
  const entry = entries.find(e => e.id === id)
  if (!entry) throw Object.assign(new Error(`回收站没有 id=${id} 的条目`), { statusCode: 404 })
  const src = path.join(TRASH_DIR(), id, 'note.md')
  const content = await fs.readFile(src, 'utf8').catch(() => {
    throw Object.assign(new Error(`条目 ${id} 的内容文件缺失`), { statusCode: 500 })
  })
  const exists = await fs
    .stat(safeJoin(entry.path))
    .then(() => true)
    .catch(() => false)
  if (exists) {
    throw Object.assign(
      new Error(`原路径 ${entry.path} 已存在笔记，先处理冲突（改名或删除现有笔记）再恢复`),
      { statusCode: 409 },
    )
  }
  await writeNote(entry.path, content)
  await writeIndex(entries.filter(e => e.id !== id))
  await fs.rm(path.join(TRASH_DIR(), id), { recursive: true, force: true }).catch(() => undefined)
  return { path: entry.path }
}
