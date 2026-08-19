import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import { RangeSet, type Range } from '@codemirror/state'
import { parseLink, type ResolveFn } from './wikilink'

const INLINE_RE =
  /(\[\[[^\[\]]+?\]\])|((^|\s)#[\p{L}\p{N}_-]+)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)/gu

/**
 * wikilink/标签着色 + 基础 live preview：
 * 光标所在行保持原始标记可编辑，其余行的标题井号前缀与加粗、斜体标记折叠渲染。
 */
export function markgraphDecorations(resolve: ResolveFn) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none

      constructor(view: EditorView) {
        this.build(view)
      }

      update(u: ViewUpdate) {
        if (u.docChanged || u.selectionSet || u.viewportChanged) this.build(u.view)
      }

      build(view: EditorView) {
        const rs: Range<Decoration>[] = []
        const push = (from: number, to: number, deco: Decoration) => {
          rs.push(deco.range(from, to))
        }

        const activeLines = new Set<number>()
        for (const r of view.state.selection.ranges) {
          activeLines.add(view.state.doc.lineAt(r.head).number)
        }

        for (const { from, to } of view.visibleRanges) {
          for (let pos = from; pos <= to; ) {
            const line = view.state.doc.lineAt(pos)
            const text = line.text
            const active = activeLines.has(line.number)

            // 标题：折叠 # 前缀（非光标行），正文按层级放大
            const h = /^(#{1,6})\s+/.exec(text)
            if (h) {
              const prefixEnd = line.from + h[0].length
              if (!active) {
                push(line.from, prefixEnd, Decoration.replace({}))
              } else {
                push(line.from, prefixEnd, Decoration.mark({ class: 'cm-mg-markdim' }))
              }
              push(prefixEnd, line.to, Decoration.mark({ class: `cm-mg-h${h[1].length}` }))
            }

            // 行内：wikilink / 标签 / 加粗 / 斜体
            INLINE_RE.lastIndex = 0
            let m: RegExpExecArray | null
            while ((m = INLINE_RE.exec(text))) {
              const s = line.from + m.index
              if (m[1]) {
                // wikilink
                const parsed = parseLink(m[1].slice(2, -2))
                const resolved = resolve(parsed.target)
                push(
                  s,
                  s + m[1].length,
                  Decoration.mark({
                    class: resolved ? 'cm-mg-link' : 'cm-mg-broken',
                    attributes: {
                      'data-wk': parsed.target,
                      'data-wkp': resolved ?? '',
                      title: resolved ?? '断链：点击创建',
                    },
                  }),
                )
              } else if (m[2]) {
                // 标签（m[2] 含前导空白）
                const lead = m[2].length - m[2].replace(/^\s+/, '').length
                push(s + lead, s + m[2].length, Decoration.mark({ class: 'cm-mg-tag' }))
              } else if (m[4]) {
                // **加粗**
                if (!active) {
                  push(s, s + 2, Decoration.replace({}))
                  push(s + m[4].length - 2, s + m[4].length, Decoration.replace({}))
                }
                push(s + 2, s + m[4].length - 2, Decoration.mark({ class: 'cm-mg-strong' }))
              } else if (m[5]) {
                // *斜体*
                if (!active) {
                  push(s, s + 1, Decoration.replace({}))
                  push(s + m[5].length - 1, s + m[5].length, Decoration.replace({}))
                }
                push(s + 1, s + m[5].length - 1, Decoration.mark({ class: 'cm-mg-em' }))
              }
            }
            pos = line.to + 1
          }
        }
        this.decorations = RangeSet.of(rs, true)
      }
    },
    { decorations: v => v.decorations },
  )
}
