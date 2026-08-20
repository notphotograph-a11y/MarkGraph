/**
 * 建议链接的定位与插入（F11.3 / F11.4）：
 * 目标名 → 路径解析（与前端 wikilink.ts 同语义），anchor → 行匹配，行末追加 wikilink。
 * AI 不改写句子，只在定位行末追加（Phase 2 明确不做正文改写）。
 */
import { readTree, type VaultNode } from '../fs-vault.js'

/** 名称（小写）→ 路径列表，数据源与文件树一致 */
export async function buildNameIndex(): Promise<Map<string, string[]>> {
  const tree = await readTree()
  const m = new Map<string, string[]>()
  const walk = (n: VaultNode | null) => {
    if (!n) return
    if (n.type === 'file') {
      const key = n.name.replace(/\.md$/i, '').toLowerCase()
      const arr = m.get(key)
      if (arr) arr.push(n.path)
      else m.set(key, [n.path])
    }
    n.children?.forEach(walk)
  }
  walk(tree)
  return m
}

/** 目标解析：与前端 makeResolver 同语义（同名优先同文件夹，否则序第一个） */
export function resolveTarget(
  nameIndex: Map<string, string[]>,
  target: string,
  currentPath: string,
): string | null {
  const t = target.replace(/\.md$/i, '')
  if (t.includes('/')) {
    const exact = (nameIndex.get(t.split('/').pop()!.toLowerCase()) ?? []).find(
      p => p.toLowerCase() === `${t.toLowerCase()}.md`,
    )
    if (exact) return exact
  }
  const candidates = nameIndex.get(t.toLowerCase())
  if (!candidates?.length) return null
  if (candidates.length === 1) return candidates[0]
  const dir = currentPath.split('/').slice(0, -1).join('/')
  return candidates.find(p => p.split('/').slice(0, -1).join('/') === dir) ?? [...candidates].sort()[0]
}

/** 正文里已链接的目标名集合（用于过滤重复建议） */
export function linkedTargets(body: string): Set<string> {
  const out = new Set<string>()
  for (const m of body.matchAll(/\[\[([^\[\]]+?)\]\]/g)) {
    const inner = m[1]
    const bar = inner.indexOf('|')
    const hash = inner.indexOf('#')
    let t = bar >= 0 ? inner.slice(0, bar) : inner
    if (hash >= 0) t = t.slice(0, hash)
    t = t.trim().replace(/\.md$/i, '')
    if (t) out.add(t.toLowerCase())
  }
  return out
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
