/**
 * 索引器冒烟：读 sample-vault，核对 nodes/edges/backlinks/tags/大纲。
 * 与前端 indexer 同规则（wikilink 正则 + 名称解析）。
 */
import fs from 'node:fs'
import path from 'node:path'

const vault = path.resolve('sample-vault')
const WIKILINK_RE = /\[\[([^\[\]]+?)\]\]/g
const TAG_RE = /(^|\s)#([\p{L}\p{N}_-]+)/gu

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, acc)
    else if (e.name.endsWith('.md')) acc.push(full)
  }
  return acc
}

function parseLink(inner) {
  let rest = inner
  let alias
  const bar = rest.indexOf('|')
  if (bar >= 0) {
    alias = rest.slice(bar + 1).trim()
    rest = rest.slice(0, bar)
  }
  let heading
  const hash = rest.indexOf('#')
  if (hash >= 0) {
    heading = rest.slice(hash + 1).trim() || undefined
    rest = rest.slice(0, hash)
  }
  return { target: rest.trim(), heading, alias }
}

const files = walk(vault)
const notes = files.map(f => ({
  path: path.relative(vault, f).split(path.sep).join('/'),
  content: fs.readFileSync(f, 'utf8'),
}))
const nameIndex = new Map()
for (const n of notes) {
  const name = n.path.split('/').pop().replace(/\.md$/i, '').toLowerCase()
  const arr = nameIndex.get(name) ?? []
  arr.push(n.path)
  nameIndex.set(name, arr)
}

function resolve(target, current) {
  const t = target.replace(/\.md$/i, '')
  if (t.includes('/')) {
    const cands = nameIndex.get(t.split('/').pop().toLowerCase()) ?? []
    const exact = cands.find(p => p.toLowerCase() === `${t.toLowerCase()}.md`)
    if (exact) return exact
  }
  const cands = nameIndex.get(t.toLowerCase())
  if (!cands?.length) return null
  if (cands.length === 1) return cands[0]
  const dir = current.split('/').slice(0, -1).join('/')
  return cands.find(p => p.split('/').slice(0, -1).join('/') === dir) ?? [...cands].sort()[0]
}

const backlinks = new Map()
const tags = new Map()
let edges = 0
let ghosts = 0
for (const n of notes) {
  for (const line of n.content.split('\n')) {
    WIKILINK_RE.lastIndex = 0
    for (const m of line.matchAll(WIKILINK_RE)) {
      const parsed = parseLink(m[1])
      if (!parsed.target) continue
      edges++
      const r = resolve(parsed.target, n.path)
      if (r) {
        const arr = backlinks.get(r) ?? []
        if (!arr.includes(n.path)) arr.push(n.path)
        backlinks.set(r, arr)
      } else ghosts++
    }
    TAG_RE.lastIndex = 0
    for (const m of line.matchAll(TAG_RE)) {
      const arr = tags.get(m[2]) ?? []
      if (!arr.includes(n.path)) arr.push(n.path)
      tags.set(m[2], arr)
    }
  }
}

const card = '方法论/卡片笔记写作法.md'
const cardBack = backlinks.get(card) ?? []
const broken = notes.find(n => n.path === '断链演示.md')
const hasGhost = /\[\[不存在的笔记\]\]/.test(broken.content)
const outline = []
for (const [i, l] of notes.find(n => n.path === card).content.split('\n').entries()) {
  const m = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(l.trimStart())
  if (m) outline.push({ level: m[1].length, text: m[2], line: i })
}

const fail = []
if (notes.length < 20) fail.push(`笔记数量过少: ${notes.length}`)
if (edges < 20) fail.push(`边过少: ${edges}`)
if (!hasGhost) fail.push('断链演示缺少幽灵链接')
if (ghosts < 1) fail.push('没有解析到幽灵节点')
if (cardBack.length < 2) fail.push(`卡片笔记写作法反链过少: ${cardBack.join(',')}`)
if (!outline.some(o => o.level === 1 && o.text.includes('卡片笔记写作法'))) fail.push('大纲未解析到 h1')
if (!tags.has('方法论')) fail.push('未解析到 #方法论')

console.log(JSON.stringify({
  notes: notes.length,
  edges,
  ghosts,
  tags: [...tags.keys()],
  cardBack,
  outline,
  ok: fail.length === 0,
  fail,
}, null, 2))
if (fail.length) process.exit(1)
