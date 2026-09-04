/**
 * 阅读态 markdown 渲染：转义 → wikilink → 标签 → marked → 图片 src 改写。
 * ReadView 与问答答案共用，保证 [[链接]] 与本地图同一套规则。
 */
import { marked } from 'marked'
import { linkText, parseLink, type ResolveFn } from './wikilink'

const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i

export function escapeHtml(s: string): string {
  // 不转义 `>`，否则 marked 无法识别引用块（XSS 关键是 `<` / `&`）
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
}

export function fileUrl(rel: string): string {
  return `/api/file?path=${encodeURIComponent(rel)}`
}

/** marked 会把 link destination 编码一次；先解码统一回原始字符，协议检查也更可靠 */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** 笔记内相对路径 → vault 相对 POSIX 路径（一律相对 vault 根，见 F19） */
export function resolveMediaSrc(src: string): string | null {
  const trimmed = safeDecode(src.trim())
  if (!trimmed) return null
  const lower = trimmed.toLowerCase()
  if (lower.startsWith('javascript:') || lower.startsWith('file:') || lower.startsWith('data:')) return null
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (trimmed.startsWith('/api/file?path=')) {
    try {
      const q = new URL(trimmed, 'http://local').searchParams.get('path') ?? ''
      return q && IMAGE_EXT.test(q) ? fileUrl(q) : null
    } catch {
      return null
    }
  }
  if (trimmed.startsWith('/')) return null
  // F19：附件统一存 vault 根 attachments/，正文里写的相对路径一律相对 vault 根
  // （上传插入的路径即此形态；若按笔记所在目录 join，子文件夹里的笔记插图会 404）
  const joined = pathJoin('', trimmed)
  if (!joined || joined.split('/').some(p => p.startsWith('.'))) return null
  if (!IMAGE_EXT.test(joined)) return null
  return fileUrl(joined)
}

function pathJoin(dir: string, rel: string): string {
  const parts = (dir ? `${dir}/${rel}` : rel).split('/')
  const out: string[] = []
  for (const p of parts) {
    if (!p || p === '.') continue
    if (p === '..') {
      if (out.length === 0) return ''
      out.pop()
      continue
    }
    out.push(p)
  }
  return out.join('/')
}

function rewriteImgs(html: string): string {
  return html.replace(/<img\b([^>]*?)>/gi, (full, attrs: string) => {
    const m = /\bsrc=(["'])(.*?)\1/i.exec(attrs)
    if (!m) return full
    const next = resolveMediaSrc(m[2])
    if (!next) return ''
    const rest = attrs.replace(/\bsrc=(["']).*?\1/i, `src="${escapeHtml(next)}"`)
    return `<img${rest}>`
  })
}

export function renderMarkdown(src: string, resolve: ResolveFn): string {
  let body = escapeHtml(src)
  body = body.replace(/\[\[([^\[\]]+?)\]\]/g, (_, inner: string) => {
    const parsed = parseLink(inner)
    const targetPath = resolve(parsed.target)
    return `<span class="rd-link${targetPath ? '' : ' rd-broken'}" data-wk="${escapeHtml(parsed.target)}" data-wkp="${escapeHtml(targetPath ?? '')}">${escapeHtml(linkText(parsed))}</span>`
  })
  body = body.replace(/(^|\s)(#[\p{L}\p{N}_-]+)/gu, (_, lead: string, tag: string) => `${lead}<span class="rd-tag" data-tag="${escapeHtml(tag.slice(1))}" title="标签：点击筛选">${escapeHtml(tag)}</span>`)
  const html = marked.parse(body, { async: false }) as string
  return rewriteImgs(html)
}
