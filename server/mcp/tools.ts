/**
 * MCP 工具注册表（F22.3）：全部功能域的原子工具。
 * 薄封装：复用 fs-vault / ai/* / shared 索引服务，不重复实现业务。
 * 错误信息面向 agent 自纠（N12.6）：路径不存在时附相近候选。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  ATTACHMENTS_DIR,
  createNode,
  isImageRel,
  isMarkdownRel,
  readAllNotes,
  readNote,
  readTree,
  rejectHiddenSegments,
  renameNode,
  safeJoin,
  writeNote,
  type VaultNode,
} from '../fs-vault.js'
import { MAX_IMAGE_BYTES, writeAttachment } from '../files.js'
import { getIndex } from '../shared/index-service.js'
import {
  buildNameIndex,
  collectPaths,
  makeResolver,
  rewriteLinks,
} from '../shared/wikilink.js'
import { splitFrontmatter } from '../shared/frontmatter.js'
import {
  applySuggestion,
  noteView,
  scheduleEnrich,
  scheduleEnrichAll,
  semanticSearch,
  undoLast,
} from '../ai/enrich.js'
import { getAiConfig, isComplete } from '../ai/config.js'
import { askVault } from '../ai/rag.js'
import { allNoteStates } from '../ai/store.js'
import { listTrash, deleteToTrash, restoreFromTrash } from './trash.js'
import { readAudit } from './audit.js'

export class McpToolError extends Error {
  statusCode: number
  /** 附加数据（如 409 冲突时的当前内容），随错误一并返回给 agent */
  data?: unknown
  constructor(message: string, statusCode = 400, data?: unknown) {
    super(message)
    this.statusCode = statusCode
    this.data = data
  }
}

export interface ToolDef {
  name: string
  description: string
  scope: 'read' | 'write'
  inputSchema: Record<string, unknown>
  handler: (args: Record<string, unknown>) => Promise<unknown>
}

/* ============ 参数与路径校验（N12.2） ============ */

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key]
  if (typeof v !== 'string' || !v.trim()) throw new McpToolError(`缺少参数 ${key}`)
  return v
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key]
  return typeof v === 'string' && v.trim() ? v : undefined
}

/** MCP 笔记路径：vault 相对、.md、不得触碰 .markgraph / attachments / 隐藏段 */
function assertNotePath(p: string): string {
  if (p.startsWith('.markgraph/') || p.startsWith(`${ATTACHMENTS_DIR}/`)) {
    throw new McpToolError('MCP 工具不能直接访问 .markgraph/ 或 attachments/（回收站/审计/附件走专用工具）')
  }
  if (!isMarkdownRel(p)) {
    throw new McpToolError(`路径必须是 .md 笔记（收到 ${p}）`)
  }
  rejectHiddenSegments(p)
  return p
}

function assertFolderPath(p: string): string {
  rejectHiddenSegments(p)
  if (p.startsWith('.markgraph/') || p.startsWith(`${ATTACHMENTS_DIR}/`)) {
    throw new McpToolError('不能在 .markgraph/ 或 attachments/ 下创建内容')
  }
  return p
}

/** 相近路径候选（N12.6）：双向包含匹配给 agent 自纠线索（如「渐进总结不存在」→「渐进总结」） */
async function suggestPaths(missing: string): Promise<string[]> {
  const { notes } = await readAllNotes()
  const want = missing.split('/').pop()!.replace(/\.md$/i, '').toLowerCase()
  if (!want) return []
  return notes
    .map(n => {
      const name = n.path.split('/').pop()!.replace(/\.md$/i, '').toLowerCase()
      if (name.length >= 2 && (name.includes(want) || want.includes(name))) return n.path
      return null
    })
    .filter((p): p is string => !!p)
    .slice(0, 5)
}

async function readNoteOr404(p: string) {
  try {
    return await readNote(p)
  } catch {
    const cands = await suggestPaths(p)
    throw new McpToolError(
      `笔记不存在：${p}${cands.length ? `。相近候选：${cands.join('、')}` : '（可用 list_tree 查看全库路径）'}`,
      404,
    )
  }
}

/* ============ 工具实现 ============ */

async function fulltextSearch(q: string): Promise<{ results: Array<{ path: string; score: number; snippet: string }> }> {
  const { notes } = await readAllNotes()
  const needle = q.toLowerCase()
  const results: Array<{ path: string; score: number; snippet: string }> = []
  for (const n of notes) {
    const name = n.path.split('/').pop()!.replace(/\.md$/i, '').toLowerCase()
    const { body } = splitFrontmatter(n.content)
    const lower = body.toLowerCase()
    let score = 0
    if (name.includes(needle)) score += 10
    let idx = lower.indexOf(needle)
    let snippet = ''
    while (idx >= 0) {
      score += 1
      if (!snippet) {
        const start = Math.max(0, idx - 30)
        snippet = `…${body.slice(start, idx + needle.length + 50).replace(/\n/g, ' ')}…`
      }
      idx = lower.indexOf(needle, idx + needle.length)
    }
    if (score > 0) results.push({ path: n.path, score, snippet })
  }
  results.sort((a, b) => b.score - a.score)
  return { results: results.slice(0, 20) }
}

/** 体检报告（F23.3）：断链 / 孤立 / 重名 / 空笔记 / 未富集 */
async function healthCheck() {
  const ix = await getIndex()
  const { notes } = await readAllNotes()
  const byPath = new Map(notes.map(n => [n.path, n.content]))

  const brokenLinks = ix.edges
    .filter(e => !e.resolved)
    .map(e => {
      const ghost = ix.nodes.find(n => n.id === e.target)
      return { source: e.source, target: ghost?.name ?? e.target }
    })

  const linked = new Set<string>()
  for (const e of ix.edges) {
    linked.add(e.source)
    if (!e.target.startsWith('ghost:')) linked.add(e.target)
  }
  const orphans = ix.nodes.filter(n => !n.ghost && !linked.has(n.id)).map(n => n.id)

  const nameCount = new Map<string, string[]>()
  for (const n of ix.nodes.filter(x => !x.ghost)) {
    const key = n.name.toLowerCase()
    nameCount.set(key, [...(nameCount.get(key) ?? []), n.id])
  }
  const duplicateNames = [...nameCount.values()].filter(v => v.length > 1)

  const emptyNotes: string[] = []
  for (const [p, c] of byPath) {
    if (splitFrontmatter(c).body.trim().length < 20) emptyNotes.push(p)
  }

  let notEnriched: string[] = []
  try {
    const states = await allNoteStates()
    notEnriched = [...byPath.keys()].filter(p => !states[p])
  } catch {
    /* AI 状态不可用时跳过该项 */
  }

  return {
    summary: {
      notes: byPath.size,
      brokenLinks: brokenLinks.length,
      orphans: orphans.length,
      duplicateNames: duplicateNames.length,
      emptyNotes: emptyNotes.length,
      notEnriched: notEnriched.length,
    },
    brokenLinks,
    orphans,
    duplicateNames,
    emptyNotes,
    notEnriched,
  }
}

/** rename + 全库链接改写（F23.2） */
async function renameWithLinks(from: string, to: string, updateLinks: boolean) {
  if (updateLinks) {
    // 先在旧名称索引上判断谁引用了 from，再执行改名，最后逐个改写
    const tree = await readTree()
    const oldPaths = collectPaths((tree?.children ?? []) as VaultNode[])
    const oldIndex = buildNameIndex(oldPaths)
    const { notes } = await readAllNotes()
    await renameNode(from, to)
    const updated: string[] = []
    const skipped: string[] = []
    const newTarget = to.replace(/\.md$/i, '')
    for (const n of notes) {
      if (n.path === from) continue
      const resolver = makeResolver(oldIndex, n.path)
      const [next, changed] = rewriteLinks(n.content, target => (resolver(target) === from ? newTarget : null))
      if (!changed) continue
      try {
        const cur = await readNote(n.path) // 乐观：改写前文件被人工改过则跳过该文件
        if (cur.content !== n.content) {
          skipped.push(n.path)
          continue
        }
        await writeNote(n.path, next)
        updated.push(n.path)
      } catch {
        skipped.push(n.path)
      }
    }
    return { path: to, updatedLinksIn: updated, skippedByConflict: skipped }
  }
  await renameNode(from, to)
  return { path: to, updatedLinksIn: [], skippedByConflict: [] }
}

/** 批量替换（D 组）：scope = 路径数组 / 文件夹 / 标签 */
async function replaceText(
  scope: string[] | { folder?: string; tag?: string },
  from: string,
  to: string,
  dryRun: boolean,
) {
  const { notes } = await readAllNotes()
  let targets: string[]
  if (Array.isArray(scope)) {
    targets = notes.map(n => n.path).filter(p => (scope as string[]).includes(p))
  } else if (typeof scope.folder === 'string') {
    const prefix = scope.folder.replace(/\/+$/, '') + '/'
    targets = notes.map(n => n.path).filter(p => p === scope.folder || p.startsWith(prefix))
  } else if (typeof scope.tag === 'string') {
    const ix = await getIndex()
    targets = ix.tags[scope.tag] ?? []
  } else {
    throw new McpToolError('scope 必须是路径数组，或 {folder: "..."} / {tag: "..."}')
  }
  const changed: Array<{ path: string; matches: number; preview: string[] }> = []
  for (const p of targets) {
    const n = notes.find(x => x.path === p)
    if (!n) continue
    const count = n.content.split(from).length - 1
    if (!count) continue
    const preview: string[] = []
    const lines = n.content.split('\n')
    for (let i = 0; i < lines.length && preview.length < 3; i++) {
      if (lines[i]!.includes(from)) preview.push(`L${i + 1}: ${lines[i]!.trim().slice(0, 120)}`)
    }
    if (!dryRun) {
      const cur = await readNote(p)
      if (cur.content !== n.content) continue // 期间被人工改动：跳过（agent 可重跑）
      await writeNote(p, n.content.split(from).join(to))
    }
    changed.push({ path: p, matches: count, preview })
  }
  return { dryRun, changedFiles: changed.length, totalMatches: changed.reduce((a, c) => a + c.matches, 0), details: changed }
}

/** 附件清单（含孤儿附件：未被任何笔记引用） */
async function listAttachments() {
  const root = safeJoin(ATTACHMENTS_DIR)
  const files: string[] = []
  const walk = async (rel: string) => {
    const entries = await fs.readdir(safeJoin(rel), { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      const child = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) await walk(child)
      else files.push(`${ATTACHMENTS_DIR}/${child}`)
    }
  }
  await walk('')
  const { notes } = await readAllNotes()
  const all = notes.map(n => n.content).join('\n')
  return {
    attachments: files.map(f => ({ path: f, referenced: all.includes(path.basename(f)) })),
  }
}

/* ============ 注册表 ============ */

function def(
  name: string,
  description: string,
  scope: 'read' | 'write',
  inputSchema: Record<string, unknown>,
  handler: ToolDef['handler'],
): ToolDef {
  return { name, description, scope, inputSchema, handler }
}

const str = (description: string) => ({ type: 'string', description })

export const TOOLS: ToolDef[] = [
  /* ---- B 笔记 CRUD ---- */
  def('list_tree', '列出全库文件树（文件夹+笔记，隐藏项已滤除）。所有 path 参数以此返回的相对路径为准。', 'read',
    { type: 'object', properties: {} },
    async () => ({ tree: await readTree() })),
  def('read_note', '读取一篇笔记：返回 { content, mtime }。mtime 可作为 write_note 的 expected_mtime 做乐观并发。', 'read',
    { type: 'object', properties: { path: str('vault 相对路径，如 方法论/渐进总结.md') }, required: ['path'] },
    async args => {
      const p = assertNotePath(requireString(args, 'path'))
      return readNoteOr404(p)
    }),
  def('read_notes', '批量读取笔记。paths 省略 = 全库（供建立全库认知；大库慎用）。', 'read',
    { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' }, description: '路径数组，省略则全库' } } },
    async args => {
      const paths = Array.isArray(args.paths) ? (args.paths as string[]) : null
      const { notes } = await readAllNotes()
      return { notes: paths ? notes.filter(n => paths.includes(n.path)) : notes }
    }),
  def('write_note', '保存笔记全文。带 expected_mtime 时若文件已被他人改动返回 409（附当前内容），防止覆盖人工编辑。', 'write',
    {
      type: 'object',
      properties: {
        path: str('vault 相对路径'), content: { type: 'string', description: '完整正文（覆盖式保存）' },
        expected_mtime: { type: 'number', description: '乐观并发基线（read_note 返回的 mtime）；省略则跳过冲突检查' },
      },
      required: ['path', 'content'],
    },
    async args => {
      const p = assertNotePath(requireString(args, 'path'))
      const content = requireString(args, 'content')
      if (typeof args.expected_mtime === 'number') {
        const cur = await readNoteOr404(p)
        if (Math.abs(cur.mtime - args.expected_mtime) > 2) {
          throw new McpToolError(
            `冲突：${p} 在读取之后已被修改（expected_mtime=${args.expected_mtime}，当前 mtime=${cur.mtime}）。当前内容在 current 字段，请基于它重试。`,
            409,
            { currentContent: cur.content, currentMtime: cur.mtime },
          )
        }
      }
      const r = await writeNote(p, content)
      scheduleEnrich(p)
      return r
    }),
  def('create_note', '新建笔记（可选初始内容）。重名返回 409。', 'write',
    { type: 'object', properties: { path: str('新笔记路径'), content: { type: 'string', description: '初始内容（可省略）' } }, required: ['path'] },
    async args => {
      const p = assertNotePath(requireString(args, 'path'))
      await createNode(p, false)
      const init = optionalString(args, 'content')
      if (init) await writeNote(p, init)
      return { path: p }
    }),
  def('create_folder', '新建文件夹。', 'write',
    { type: 'object', properties: { path: str('文件夹相对路径') }, required: ['path'] },
    async args => ({ path: await createNode(assertFolderPath(requireString(args, 'path')), true) })),
  def('rename_note', '移动/重命名笔记。update_links=true（默认）时同步改写全库指向它的 [[wikilink]]。', 'write',
    {
      type: 'object',
      properties: {
        from: str('原路径'), to: str('新路径'),
        update_links: { type: 'boolean', description: '同步改写全库 wikilink（默认 true）' },
      },
      required: ['from', 'to'],
    },
    async args => renameWithLinks(
      assertNotePath(requireString(args, 'from')),
      assertNotePath(requireString(args, 'to')),
      args.update_links !== false,
    )),
  def('delete_note', '删除笔记——一律进回收站（可 restore_trash 恢复），永不物理删除。返回回收站条目 id。', 'write',
    { type: 'object', properties: { path: str('要删除的笔记'), reason: str('删除原因（进审计日志）') }, required: ['path'] },
    async args => deleteToTrash(assertNotePath(requireString(args, 'path')), optionalString(args, 'reason'))),

  /* ---- C 查询（索引同源） ---- */
  def('search_fulltext', '全库纯文本搜索（标题命中权重高于正文），返回 top20 带摘录。', 'read',
    { type: 'object', properties: { q: str('搜索词') }, required: ['q'] },
    async args => fulltextSearch(requireString(args, 'q').toLowerCase())),
  def('get_backlinks', '谁链接了这篇笔记：来源列表 + 引用上下文摘录。', 'read',
    { type: 'object', properties: { path: str('笔记路径') }, required: ['path'] },
    async args => {
      const p = assertNotePath(requireString(args, 'path'))
      const ix = await getIndex()
      return { backlinks: ix.backlinks[p] ?? [] }
    }),
  def('get_outlinks', '这篇笔记链接了谁（含断链标记：目标不存在时 resolved=false）。', 'read',
    { type: 'object', properties: { path: str('笔记路径') }, required: ['path'] },
    async args => {
      const p = assertNotePath(requireString(args, 'path'))
      const ix = await getIndex()
      return {
        outlinks: ix.edges
          .filter(e => e.source === p)
          .map(e => ({ target: e.target.startsWith('ghost:') ? ix.ghostTargets[e.target] ?? e.target : e.target, resolved: e.resolved })),
      }
    }),
  def('list_broken_links', '全库断链清单：哪个笔记的哪个链接指向不存在的目标。', 'read', { type: 'object', properties: {} },
    async () => {
      const ix = await getIndex()
      return {
        broken: ix.edges
          .filter(e => !e.resolved)
          .map(e => ({ source: e.source, target: ix.ghostTargets[e.target] ?? e.target })),
      }
    }),
  def('list_tags', '标签 → 笔记列表（frontmatter 与正文 #标签 同源）。', 'read', { type: 'object', properties: {} },
    async () => (await getIndex()).tags),
  def('get_graph', '图谱数据（节点/边），供结构分析；不做可视化。folder 参数只取该文件夹子图。', 'read',
    { type: 'object', properties: { folder: str('限定文件夹（可省略）') } },
    async args => {
      const ix = await getIndex()
      const folder = optionalString(args, 'folder')
      if (!folder) return { nodes: ix.nodes, edges: ix.edges }
      const keep = new Set(ix.nodes.filter(n => !n.ghost && (n.folder === folder || n.folder.startsWith(`${folder}/`))).map(n => n.id))
      return {
        nodes: ix.nodes.filter(n => keep.has(n.id) || n.ghost),
        edges: ix.edges.filter(e => keep.has(e.source)),
      }
    }),
  def('find_orphans', '孤立笔记：既无入链也无出链。', 'read', { type: 'object', properties: {} },
    async () => ({ orphans: (await healthCheck()).orphans })),
  def('health_check', '一次调用返回全库体检：断链、孤立、重名、空笔记、未富集清单——整理工作的统一入口。', 'read',
    { type: 'object', properties: {} }, healthCheck),

  /* ---- D 整理 ---- */
  def('replace_text', '批量文本替换。scope 为路径数组 / {folder} / {tag}。dry_run=true（默认）只返回逐文件预览，确认后同参数传 false 落盘。', 'write',
    {
      type: 'object',
      properties: {
        scope: { description: '路径数组，或 {folder: "..."} / {tag: "..."}' },
        from: str('要替换的文本'), to: str('替换为'),
        dry_run: { type: 'boolean', description: '默认 true 只预览' },
      },
      required: ['scope', 'from', 'to'],
    },
    async args => replaceText(
      (args.scope ?? []) as string[] | { folder?: string; tag?: string },
      requireString(args, 'from'),
      requireString(args, 'to'),
      args.dry_run !== false,
    )),

  /* ---- E AI（透传） ---- */
  def('ai_status', 'AI 配置状态与富集队列进度。', 'read', { type: 'object', properties: {} },
    async () => ({ configured: isComplete(await getAiConfig()) })),
  def('enrich_note', '对单篇笔记做 AI 富集（摘要/标签/建议链接写 frontmatter）。', 'write',
    { type: 'object', properties: { path: str('笔记路径') }, required: ['path'] },
    async args => {
      const p = assertNotePath(requireString(args, 'path'))
      await readNoteOr404(p)
      scheduleEnrich(p, 100)
      return { ok: true, note: '已入队，进度用 ai_status 查询' }
    }),
  def('enrich_all', '全库建立语义索引（串行队列；期间 ai_status 可查进度）。完成后 semantic_search 可用。', 'write',
    { type: 'object', properties: {} },
    async () => ({ ok: true, total: await scheduleEnrichAll() })),
  def('get_note_ai', '单篇 AI 视图：摘要、标签、相关笔记、建议链接。', 'read',
    { type: 'object', properties: { path: str('笔记路径') }, required: ['path'] },
    async args => {
      const p = assertNotePath(requireString(args, 'path'))
      await readNoteOr404(p)
      return noteView(p)
    }),
  def('apply_link_suggestion', '应用一条建议链接（get_note_ai 返回的 suggestions 之一）：在 anchor 行末插入 [[target]]。', 'write',
    { type: 'object', properties: { path: str('笔记路径'), target: str('建议目标'), anchor: str('建议锚点句') }, required: ['path', 'target', 'anchor'] },
    async args => {
      const p = assertNotePath(requireString(args, 'path'))
      await applySuggestion(p, requireString(args, 'target'), requireString(args, 'anchor'))
      return { ok: true }
    }),
  def('undo_ai_write', '撤销该笔记最近一次 AI 写入；人工已改过则 409。', 'write',
    { type: 'object', properties: { path: str('笔记路径') }, required: ['path'] },
    async args => {
      const p = assertNotePath(requireString(args, 'path'))
      await undoLast(p)
      return { ok: true }
    }),
  def('semantic_search', '语义搜索。AI 未配置时明确报错（不静默降级）。', 'read',
    { type: 'object', properties: { q: str('查询') }, required: ['q'] },
    async args => {
      if (!isComplete(await getAiConfig())) {
        throw new McpToolError('AI 未配置：semantic_search 不可用。请在应用「设置」配置网关与模型。', 503)
      }
      return { results: await semanticSearch(requireString(args, 'q')) }
    }),
  def('ask_vault', 'RAG 问答：基于笔记库回答，返回完整答案与来源列表（请求-响应，不流式）。', 'read',
    { type: 'object', properties: { q: str('问题') }, required: ['q'] },
    async args => {
      if (!isComplete(await getAiConfig())) {
        throw new McpToolError('AI 未配置：ask_vault 不可用。请在应用「设置」配置网关与模型。', 503)
      }
      let answer = ''
      let sources: Array<{ path: string; name: string; heading?: string }> = []
      await askVault(
        requireString(args, 'q'),
        [],
        s => {
          sources = s.map(x => ({ path: x.path, name: x.name, heading: x.heading }))
        },
        t => {
          answer += t
        },
      )
      return { answer, sources }
    }),

  /* ---- F 附件 / 回收站 / 审计 ---- */
  def('upload_attachment', '上传图片（base64；同一白名单与 8MB 上限），返回 attachments/ 相对路径供正文 ![](路径) 引用。', 'write',
    {
      type: 'object',
      properties: { filename: str('原始文件名（决定扩展名）'), content_base64: str('图片内容的 base64') },
      required: ['filename', 'content_base64'],
    },
    async args => {
      const filename = requireString(args, 'filename')
      if (!isImageRel(filename)) throw new McpToolError('只支持 png/jpg/jpeg/gif/webp 图片')
      const buf = Buffer.from(requireString(args, 'content_base64'), 'base64')
      if (buf.length === 0) throw new McpToolError('content_base64 解码为空')
      if (buf.length > MAX_IMAGE_BYTES) throw new McpToolError('图片不能超过 8MB')
      return writeAttachment(filename, buf)
    }),
  def('list_attachments', '附件清单，含「未被任何笔记引用」的孤儿附件标记（整理素材）。', 'read', { type: 'object', properties: {} },
    listAttachments),
  def('list_trash', '回收站清单（agent 删除都可在这里找到）。', 'read', { type: 'object', properties: {} },
    async () => ({ entries: await listTrash() })),
  def('restore_trash', '从回收站恢复一篇笔记到原路径（原路径已被占用则 409）。', 'write',
    { type: 'object', properties: { id: str('list_trash 返回的条目 id') }, required: ['id'] },
    async args => restoreFromTrash(requireString(args, 'id'))),
  def('read_audit_log', '读取 agent 操作审计日志（最近 N 条，默认 50）。', 'read',
    { type: 'object', properties: { last: { type: 'number', description: '最近条数（默认 50，上限 500）' } } },
    async args => ({ entries: await readAudit(typeof args.last === 'number' ? args.last : 50) })),
]

export function toolByName(name: string): ToolDef | undefined {
  return TOOLS.find(t => t.name === name)
}
