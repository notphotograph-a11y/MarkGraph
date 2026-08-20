/**
 * frontmatter 轻量读取（前端侧）。
 * 写回逻辑在 server/ai/frontmatter.ts（AI 只在服务端写）；此处只做展示与索引所需的解析，
 * 边界正则两端保持一致：`---` 围栏块，位于文件开头。
 */

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

export function splitFrontmatter(content: string): { fm: string | null; body: string } {
  const m = FM_RE.exec(content)
  if (!m) return { fm: null, body: content }
  return { fm: m[1], body: content.slice(m[0].length) }
}

/** frontmatter tags（行内 `[a, b]` 或 `- a` 列表），与 server 侧解析规则一致 */
export function fmTags(fm: string | null): string[] {
  if (!fm) return []
  const lines = fm.split('\n')
  const idx = lines.findIndex(l => /^tags:\s*/.test(l))
  if (idx < 0) return []
  const inline = /\[(.*)\]/.exec(lines[idx])
  if (inline) return splitList(inline[1])
  const out: string[] = []
  for (const l of lines.slice(idx + 1)) {
    const m = /^\s*-\s+(.+?)\s*$/.exec(l)
    if (!m) break
    out.push(...splitList(m[1]))
  }
  return out
}

function splitList(s: string): string[] {
  return s
    .split(',')
    .map(t => t.replace(/^['"]|['"]$/g, '').trim())
    .filter(Boolean)
}
