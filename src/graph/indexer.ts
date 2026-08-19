/**
 * 链接索引器（docs/02 §5.3）：输入「全部笔记路径+内容」的 Map，
 * 输出 nodes / edges / backlinks(含上下文摘录) / tags。
 * 解析规则复用 editor/wikilink.ts，保证与 CM6 高亮、[[ 补全、断链检测一致。
 */
import {
  TAG_RE,
  WIKILINK_RE,
  buildNameIndex,
  linkText,
  makeResolver,
  parseLink,
} from '@/editor/wikilink'

/** 幽灵节点（断链目标）id 前缀 */
export const GHOST_PREFIX = 'ghost:'

export interface GraphNode {
  /** 真实笔记为 vault 相对路径；幽灵节点为 ghost: 前缀 + 断链目标 */
  id: string
  name: string
  folder: string
  ghost: boolean
}

export interface GraphEdge {
  source: string
  target: string
  resolved: boolean
}

export interface Backlink {
  from: string
  /** 引用行去 markdown 语法后的摘录（链接文本前后各约 40 字） */
  context: string
}

export interface VaultIndex {
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** 笔记路径 → 链接到它的来源列表 */
  backlinks: Map<string, Backlink[]>
  /** 标签 → 笔记路径列表 */
  tags: Map<string, string[]>
  /** 幽灵节点 id → 断链目标原文（用于「创建此笔记」的落盘路径推导） */
  ghostTargets: Map<string, string>
}

/** 去掉一行文本中的 markdown 语法痕迹（wikilink/链接/标记符），用于摘录展示 */
function stripMarkdown(line: string): string {
  return line
    .replace(/\[\[([^\[\]]+?)\]\]/g, (_, inner: string) => linkText(parseLink(inner)))
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 引用行摘录：以链接显示文本为中心，前后各约 40 字 */
function excerpt(line: string, label: string): string {
  const stripped = stripMarkdown(line)
  if (!stripped) return ''
  const idx = stripped.indexOf(label)
  const HALF = 40
  if (idx < 0 || stripped.length <= HALF * 2 + label.length) return stripped
  const start = Math.max(0, idx - HALF)
  const end = Math.min(stripped.length, idx + label.length + HALF)
  return `${start > 0 ? '…' : ''}${stripped.slice(start, end)}${end < stripped.length ? '…' : ''}`
}

export function buildIndex(contents: Map<string, string>): VaultIndex {
  const paths = [...contents.keys()]
  const nameIndex = buildNameIndex(paths)
  const nodes = new Map<string, GraphNode>()
  for (const p of paths) {
    nodes.set(p, {
      id: p,
      name: p.split('/').pop()!.replace(/\.md$/i, ''),
      folder: p.split('/').slice(0, -1).join('/'),
      ghost: false,
    })
  }

  const edges: GraphEdge[] = []
  const edgeKeys = new Set<string>()
  const backlinks = new Map<string, Backlink[]>()
  const tags = new Map<string, string[]>()
  const ghostTargets = new Map<string, string>()

  for (const [sourcePath, content] of contents) {
        const resolve = makeResolver(nameIndex, sourcePath)
    for (const line of content.split('\n')) {
      WIKILINK_RE.lastIndex = 0
      for (const m of line.matchAll(WIKILINK_RE)) {
        const parsed = parseLink(m[1])
        if (!parsed.target) continue
        const label = linkText(parsed)
        const resolved = resolve(parsed.target)
        let targetId: string
        if (resolved) {
          targetId = resolved
        } else {
          const t = parsed.target.replace(/\.md$/i, '')
          // 同名断链合并为一个幽灵节点
          targetId = GHOST_PREFIX + t.toLowerCase()
          if (!nodes.has(targetId)) {
            nodes.set(targetId, {
              id: targetId,
              name: t.split('/').pop() || t,
              folder: t.includes('/') ? t.slice(0, t.lastIndexOf('/')) : '',
              ghost: true,
            })
            ghostTargets.set(targetId, t)
          }
        }
        const key = `${sourcePath}\u0000${targetId}`
        if (!edgeKeys.has(key)) {
          edgeKeys.add(key)
          edges.push({ source: sourcePath, target: targetId, resolved: !!resolved })
        }
        if (resolved) {
          const arr = backlinks.get(resolved) ?? []
          if (!arr.some(b => b.from === sourcePath)) {
            arr.push({ from: sourcePath, context: excerpt(line, label) })
            backlinks.set(resolved, arr)
          }
        }
      }
      TAG_RE.lastIndex = 0
      for (const m of line.matchAll(TAG_RE)) {
        const arr = tags.get(m[2]) ?? []
        if (!arr.includes(sourcePath)) arr.push(sourcePath)
        tags.set(m[2], arr)
      }
    }
  }

  return { nodes: [...nodes.values()], edges, backlinks, tags, ghostTargets }
}

/* ============ 大纲（单篇解析） ============ */

export interface OutlineItem {
  level: number
  text: string
  /** 0 基行号 */
  line: number
}

/** outline:goto 事件载荷（右栏大纲点击 → 编辑/阅读视图定位） */
export interface OutlineTarget {
  path: string
  level: number
  text: string
  line: number
  /** 在大纲中的序号（阅读视图按顺序兜底定位） */
  index: number
}

/** 解析一篇笔记的 h1-h4 标题结构 */
export function parseOutline(content: string): OutlineItem[] {
  const out: OutlineItem[] = []
  let inCode = false
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trimStart()
    if (l.startsWith('```')) {
      inCode = !inCode
      continue
    }
    if (inCode) continue
    const m = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(l)
    if (m) out.push({ level: m[1].length, text: m[2], line: i })
  }
  return out
}
