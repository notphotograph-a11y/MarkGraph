/**
 * 建议链接的定位与插入（F11.3 / F11.4）：
 * 目标解析与收集复用 server/shared/wikilink（F23.1 下沉后的唯一实现），
 * anchor → 行匹配、行末追加 wikilink 为 AI 专属逻辑留在此处。
 * AI 不改写句子，只在定位行末追加（Phase 2 明确不做正文改写）。
 */
import { readTree, type VaultNode } from '../fs-vault.js'
import { collectPaths, makeResolver } from '../shared/wikilink.js'

export { linkedTargets } from '../shared/wikilink.js'

/** 名称（小写）→ 路径列表，数据源与文件树一致 */
export async function buildNameIndex(): Promise<Map<string, string[]>> {
  const tree = await readTree()
  const paths = collectPaths((tree?.children ?? []) as VaultNode[])
  const m = new Map<string, string[]>()
  for (const p of paths) {
    const name = p.split('/').pop()!.replace(/\.md$/i, '')
    const key = name.toLowerCase()
    const arr = m.get(key)
    if (arr) arr.push(p)
    else m.set(key, [p])
  }
  return m
}

/** 目标解析：与索引器同一实现（同名优先同文件夹，否则序第一个） */
export function resolveTarget(
  nameIndex: Map<string, string[]>,
  target: string,
  currentPath: string,
): string | null {
  return makeResolver(nameIndex, currentPath)(target)
}

/** anchor 归一化比较：去空白（AI 抄原句偶尔丢空格） */
const norm = (s: string) => s.replace(/\s+/g, '')

/**
 * 在正文里定位 anchor 所在行，返回该行末尾插入 wikilink 后的新正文。
 * 匹配策略：整句 → 前 12 字前缀；都找不到返回 null（调用方跳过该建议）。
 */
export function insertLink(body: string, anchor: string, linkText: string): string | null {
  const target = norm(anchor).slice(0, 40)
  const prefix = target.slice(0, 12)
  const lines = body.split('\n')
  let idx = lines.findIndex(l => norm(l).includes(target))
  if (idx < 0 && prefix.length >= 6) idx = lines.findIndex(l => norm(l).includes(prefix))
  if (idx < 0) return null
  lines[idx] = `${lines[idx].replace(/\s+$/, '')} [[${linkText}]]`
  return lines.join('\n')
}
