/**
 * 服务端索引服务（F23.1）：维护全库链接索引的内存缓存，
 * vault 任何变更（含 AI 富集写入、agent 写入）后标脏、防抖重建。
 * /api/index 与 MCP 查询工具（反链/断链/孤立/图谱/体检）共用这一份数据。
 */
import { readAllNotes } from '../fs-vault.js'
import { onVaultEvent } from '../watch.js'
import { buildIndex, type Backlink, type VaultIndex } from './indexer.js'

/** JSON 可序列化形态（Map → 普通对象）；前端 hydrate 回 Map 后图谱/面板代码零改动 */
export interface SerializedIndex {
  nodes: VaultIndex['nodes']
  edges: VaultIndex['edges']
  backlinks: Record<string, Backlink[]>
  tags: Record<string, string[]>
  ghostTargets: Record<string, string>
}

export function serializeIndex(ix: VaultIndex): SerializedIndex {
  const backlinks: Record<string, Backlink[]> = {}
  for (const [k, v] of ix.backlinks) backlinks[k] = v
  const tags: Record<string, string[]> = {}
  for (const [k, v] of ix.tags) tags[k] = v
  const ghostTargets: Record<string, string> = {}
  for (const [k, v] of ix.ghostTargets) ghostTargets[k] = v
  return { nodes: ix.nodes, edges: ix.edges, backlinks, tags, ghostTargets }
}

let cached: SerializedIndex | null = null
let dirty = true
let building: Promise<SerializedIndex> | null = null
let debounceTimer: NodeJS.Timeout | null = null

async function rebuild(): Promise<SerializedIndex> {
  const { notes } = await readAllNotes()
  const ix = buildIndex(new Map(notes.map(n => [n.path, n.content])))
  cached = serializeIndex(ix)
  dirty = false
  return cached
}

/** 取当前索引；有脏标记则先重建（并发调用共享同一次重建） */
export function getIndex(): Promise<SerializedIndex> {
  if (!dirty && cached) return Promise.resolve(cached)
  building ??= rebuild().finally(() => {
    building = null
  })
  return building
}

/** 供写路径主动标脏（如 MCP rename 改写全库链接后立刻可见） */
export function markIndexDirty(): void {
  dirty = true
}

/** 订阅 vault 变更：防抖合并短时间内的多次写（外部批量操作/agent 循环写入） */
export function initIndexService(): void {
  onVaultEvent(() => {
    dirty = true
    if (debounceTimer) return
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      void getIndex().catch(() => undefined)
    }, 400)
  })
}
