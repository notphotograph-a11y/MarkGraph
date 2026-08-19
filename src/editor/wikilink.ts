/** wikilink / 标签解析与路径解析（编辑器装饰、补全、索引器共用同一套规则） */

export interface ParsedLink {
  /** [[目标]] 里的目标（可能带路径，不带 .md 后缀也可带） */
  target: string
  /** #后的标题引用 */
  heading?: string
  /** |后的别名 */
  alias?: string
}

/** 解析 [[inner]] 的 inner 部分：target#heading|alias */
export function parseLink(inner: string): ParsedLink {
  let rest = inner
  let alias: string | undefined
  const bar = rest.indexOf('|')
  if (bar >= 0) {
    alias = rest.slice(bar + 1).trim()
    rest = rest.slice(0, bar)
  }
  let heading: string | undefined
  const hash = rest.indexOf('#')
  if (hash >= 0) {
    heading = rest.slice(hash + 1).trim() || undefined
    rest = rest.slice(0, hash)
  }
  return { target: rest.trim(), heading, alias }
}

/** 链接显示文本 */
export function linkText(l: ParsedLink): string {
  if (l.alias) return l.alias
  if (l.heading) return `${l.target} > ${l.heading}`
  return l.target
}

/** 标签名：允许中文、字母、数字、下划线、连字符 */
export const TAG_RE = /(^|\s)#([\p{L}\p{N}_-]+)/gu
export const WIKILINK_RE = /\[\[([^\[\]]+?)\]\]/g

/** 名称索引：去 .md 的文件名（小写）→ 路径列表 */
export function buildNameIndex(paths: string[]): Map<string, string[]> {
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

export type ResolveFn = (target: string) => string | null

/** 生成目标→路径 的解析函数（同名笔记：优先当前笔记同文件夹，其次路径序第一个） */
export function makeResolver(
  nameIndex: Map<string, string[]>,
  currentPath: string,
): ResolveFn {
  return target => {
    const t = target.replace(/\.md$/i, '')
    // 带路径的写法：直接按相对路径找
    if (t.includes('/')) {
      const candidates = nameIndex.get(t.split('/').pop()!.toLowerCase()) ?? []
      const exact = candidates.find(p => p.toLowerCase() === `${t.toLowerCase()}.md`)
      if (exact) return exact
    }
    const candidates = nameIndex.get(t.toLowerCase())
    if (!candidates?.length) return null
    if (candidates.length === 1) return candidates[0]
    const dir = currentPath.split('/').slice(0, -1).join('/')
    const sameFolder = candidates.find(p => p.split('/').slice(0, -1).join('/') === dir)
    return sameFolder ?? [...candidates].sort()[0]
  }
}

/** 收集全部笔记路径 */
export function collectPaths(nodes: { type: string; path: string; children?: unknown[] }[]): string[] {
  const out: string[] = []
  const walk = (n: { type: string; path: string; children?: unknown[] }) => {
    if (n.type === 'file') out.push(n.path)
    ;(n.children as { type: string; path: string; children?: unknown[] }[] | undefined)?.forEach(walk)
  }
  nodes.forEach(walk)
  return out
}
