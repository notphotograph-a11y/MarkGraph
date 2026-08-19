import { autocompletion, type CompletionContext } from '@codemirror/autocomplete'

/** 简单子序列 fuzzy 匹配分值（越大越靠前），不匹配返回 -1（命令面板与补全共用） */
export function fuzzyScore(query: string, label: string): number {
  const q = query.toLowerCase()
  const l = label.toLowerCase()
  let qi = 0
  let score = 0
  let lastHit = -2
  for (let i = 0; i < l.length && qi < q.length; i++) {
    if (l[i] === q[qi]) {
      score += i === lastHit + 1 ? 3 : 1
      lastHit = i
      qi++
    }
  }
  return qi === q.length ? score : -1
}

/** 输入 [[ 后弹出全部笔记名的 fuzzy 补全 */
export function wikilinkCompletions(names: () => string[]) {
  return autocompletion({
    icons: false,
    activateOnTyping: true,
    override: [
      (ctx: CompletionContext) => {
        const line = ctx.state.doc.lineAt(ctx.pos)
        const before = line.text.slice(0, ctx.pos - line.from)
        const m = /\[\[([^\[\]|#]*)$/.exec(before)
        if (!m) return null
        const query = m[1]
        const from = ctx.pos - query.length
        const options = names()
          .map(n => ({ n, s: query ? fuzzyScore(query, n) : 1 }))
          .filter(o => o.s >= 0)
          .sort((a, b) => b.s - a.s)
          .slice(0, 12)
          .map(o => ({
            label: o.n,
            type: 'text',
            apply: `${o.n}]]`,
          }))
        return { from, options, validFor: /^[^\[\]|#]*$/ }
      },
    ],
  })
}
