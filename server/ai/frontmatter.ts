/**
 * frontmatter 解析与写回（F10.1）：AI 只管理 tags / summary 两个键，
 * 其余 frontmatter 行原样保留；正文一字不动。
 */

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

export function splitFrontmatter(content: string): { fm: string | null; body: string } {
  const m = FM_RE.exec(content)
  if (!m) return { fm: null, body: content }
  return { fm: m[1], body: content.slice(m[0].length) }
}

/** 读 frontmatter 里的 tags（支持 `[a, b]` 行内与 `- a` 列表两种写法） */
export function fmTags(fm: string | null): string[] {
  if (!fm) return []
  const lines = fm.split('\n')
  const idx = lines.findIndex(l => /^tags:\s*/.test(l))
  if (idx < 0) return []
  const inline = /\[(.*)\]/.exec(lines[idx])
  if (inline) return splitTagList(inline[1])
  const out: string[] = []
  for (const l of lines.slice(idx + 1)) {
    const m = /^\s*-\s+(.+?)\s*$/.exec(l)
    if (!m) break
    out.push(...splitTagList(m[1]))
  }
  return out
}

function splitTagList(s: string): string[] {
  return s
    .split(',')
    .map(t => t.replace(/^['"]|['"]$/g, '').trim())
    .filter(Boolean)
}

export function fmSummary(fm: string | null): string {
  if (!fm) return ''
  const m = /^summary:\s*(.+)$/m.exec(fm)
  if (!m) return ''
  return m[1].replace(/^['"]|['"]$/g, '').trim()
}

/** 清洗 AI 产出的标签：去 # 与 YAML 特殊字符，限长限量 */
export function sanitizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  const out: string[] = []
  for (const t of tags) {
    if (typeof t !== 'string') continue
    const clean = t.replace(/[#\[\]:"',]/g, '').trim().slice(0, 20)
    if (clean && !out.includes(clean)) out.push(clean)
    if (out.length >= 5) break
  }
  return out
}

/** 清洗 AI 产出的摘要：压成单行，去引号，限 120 字 */
export function sanitizeSummary(s: unknown): string {
  if (typeof s !== 'string') return ''
  return s.replace(/["\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
}

/** 把 tags/summary 写进 frontmatter：无则创建，有则原位替换，其他键不动 */
export function writeFrontmatter(content: string, tags: string[], summary: string): string {
  const { fm, body } = splitFrontmatter(content)
  const tagLine = `tags: [${tags.join(', ')}]`
  const summaryLine = summary ? `summary: ${summary}` : ''
  if (!fm) {
    const lines = ['---', tagLine, ...(summaryLine ? [summaryLine] : []), '---', '']
    return lines.join('\n') + body
  }
  const lines = fm.split('\n')
  const out: string[] = []
  let wroteTags = false
  let wroteSummary = false
  for (const l of lines) {
    if (/^tags:\s*/.test(l)) {
      out.push(tagLine)
      wroteTags = true
    } else if (/^summary:\s*/.test(l)) {
      // 原来有 summary 键才原位替换；没生成就保留原值
      if (summaryLine) {
        out.push(summaryLine)
        wroteSummary = true
      } else {
        out.push(l)
        wroteSummary = true
      }
    } else if (/^\s*-\s+/.test(l) && out.length > 0 && /^tags:/.test(out[out.length - 1] ?? '')) {
      // 旧 tags 列表项：丢弃（已由行内写法替代）
      continue
    } else {
      out.push(l)
    }
  }
  if (!wroteTags) out.push(tagLine)
  if (summaryLine && !wroteSummary) out.push(summaryLine)
  return `---\n${out.join('\n')}\n---\n${body}`
}
