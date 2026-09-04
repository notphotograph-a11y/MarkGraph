import 'dotenv/config'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import multipart from '@fastify/multipart'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createNode,
  ensureVault,
  readAllNotes,
  readNote,
  readTree,
  writeNote,
  VAULT_DIR,
} from './fs-vault.js'
import { deleteToTrash, listTrash, purgeTrashEntry, restoreFromTrash } from './trash.js'
import { renameWithLinks } from './shared/link-rewrite.js'
import { MAX_IMAGE_BYTES, readAttachment, writeAttachment } from './files.js'
import { onVaultEvent, watchVault } from './watch.js'
import { registerAiRoutes } from './ai/routes.js'
import { onAiEvent, scheduleEnrich } from './ai/enrich.js'
import { dropNoteState } from './ai/store.js'
import { assertBindAllowed, registerAuth } from './auth.js'
import { loadSettings, saveSettings } from './ai/settings.js'
import { getIndex, initIndexService } from './shared/index-service.js'
import { registerAgentAdmin, registerMcp } from './mcp/routes.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOST = process.env.HOST || '127.0.0.1'
const PORT = Number(process.env.PORT || 7710)

assertBindAllowed(HOST)

const app = Fastify({ logger: false, bodyLimit: MAX_IMAGE_BYTES + 64 * 1024, trustProxy: true })
await app.register(multipart, { limits: { files: 1, fileSize: MAX_IMAGE_BYTES } })
await registerAuth(app)

app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
  const status = typeof err.statusCode === 'number' ? err.statusCode : 500
  reply.status(status).send({ error: err.message })
})

app.get('/api/tree', async () => ({ tree: await readTree() }))

// 链接索引（F23.1）：服务端构建，Web 前端与 MCP 同源取数
app.get('/api/index', async () => getIndex())

app.get('/api/note', async req => {
  const { path: p } = req.query as { path?: string }
  if (!p) throw Object.assign(new Error('缺少 path'), { statusCode: 400 })
  return readNote(p)
})

app.get('/api/notes', async () => readAllNotes())

app.put('/api/note', async req => {
  const { path: p, content } = req.body as { path?: string; content?: string }
  if (!p || typeof content !== 'string') throw Object.assign(new Error('参数不完整'), { statusCode: 400 })
  const r = await writeNote(p, content)
  // AI 富集由「用户保存」触发（防抖在内侧判断配置与幂等），不监听文件事件，避免回环
  scheduleEnrich(p)
  return r
})

app.post('/api/note/create', async req => {
  const { path: p, isDir } = req.body as { path?: string; isDir?: boolean }
  if (!p) throw Object.assign(new Error('缺少 path'), { statusCode: 400 })
  return createNode(p, !!isDir)
})

// 改名/移动：默认全库 wikilink 改写（F25.3，与 MCP rename_note 共用实现）
app.post('/api/note/rename', async req => {
  const { from, to, updateLinks } = req.body as { from?: string; to?: string; updateLinks?: boolean }
  if (!from || !to) throw Object.assign(new Error('参数不完整'), { statusCode: 400 })
  return renameWithLinks(from, to, updateLinks !== false)
})

// 删除：一律进回收站（F25.1/N14.1，与 MCP 共享存储与保留策略）
app.post('/api/note/delete', async req => {
  const { path: p } = req.body as { path?: string }
  if (!p) throw Object.assign(new Error('参数不完整'), { statusCode: 400 })
  const entry = await deleteToTrash(p, 'web')
  // 清掉该笔记的 AI 富集状态（向量缓存按内容 hash 自然过期，不主动清）
  await dropNoteState(p).catch(() => undefined)
  return { ok: true as const, trashId: entry.id }
})

app.get('/api/trash', async () => ({ entries: await listTrash() }))

app.post('/api/trash/restore', async req => {
  const { id } = req.body as { id?: string }
  if (!id) throw Object.assign(new Error('缺少 id'), { statusCode: 400 })
  return restoreFromTrash(id)
})

app.post('/api/trash/purge', async req => {
  const { id } = req.body as { id?: string }
  if (!id) throw Object.assign(new Error('缺少 id'), { statusCode: 400 })
  return purgeTrashEntry(id)
})

// 写作设置（F27）：模板/日记目录约定，存 settings.json 的 writing 段
app.get('/api/settings/writing', async () => ({ writing: (await loadSettings()).writing }))

app.put('/api/settings/writing', async req => {
  const { writing } = req.body as { writing?: Record<string, string> }
  if (!writing || typeof writing !== 'object') {
    throw Object.assign(new Error('参数不完整'), { statusCode: 400 })
  }
  const next = await saveSettings({ writing })
  return { writing: next.writing }
})

app.get('/api/file', async (req, reply) => {
  const { path: p } = req.query as { path?: string }
  if (!p) throw Object.assign(new Error('缺少 path'), { statusCode: 400 })
  const { body, mime } = await readAttachment(p)
  return reply
    .header('Content-Type', mime)
    .header('X-Content-Type-Options', 'nosniff')
    .header('Cache-Control', 'private, max-age=31536000, immutable')
    .send(body)
})

app.post('/api/file', async req => {
  const file = await req.file()
  if (!file) throw Object.assign(new Error('缺少文件'), { statusCode: 400 })
  const buf = await file.toBuffer()
  if (file.file.truncated) throw Object.assign(new Error('图片不能超过 8MB'), { statusCode: 400 })
  return writeAttachment(file.filename || 'image', buf)
})

// 首启导入示例库（F7：仅当 vault 为空时允许）
app.post('/api/import-sample', async () => {
  const tree = await readTree()
  if (tree?.children?.length) {
    throw Object.assign(new Error('vault 非空，不能导入示例库'), { statusCode: 409 })
  }
  // dev：server/../sample-vault；prod：server/dist/../../sample-vault
  const candidates = [
    path.resolve(__dirname, '../sample-vault'),
    path.resolve(__dirname, '../../sample-vault'),
  ]
  const sampleDir = candidates.find(c => fs.existsSync(c))
  if (!sampleDir) throw Object.assign(new Error('示例库不存在'), { statusCode: 500 })
  await fs.promises.cp(sampleDir, VAULT_DIR, { recursive: true })
  return { ok: true }
})

// SSE：vault 文件变更 + AI 富集事件推送
app.get('/api/events', async (req, reply) => {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  reply.raw.write('retry: 2000\n\n')
  const off = onVaultEvent(e => {
    reply.raw.write(`event: ${e.kind}\ndata: ${JSON.stringify({ path: e.path })}\n\n`)
  })
  const offAi = onAiEvent(e => {
    reply.raw.write(`event: ai\ndata: ${JSON.stringify(e)}\n\n`)
  })
  req.raw.on('close', () => {
    off()
    offAi()
  })
  await new Promise<void>(() => {
    /* 保持连接 */
  })
})

// Phase 2：AI 富集端点（薄路由，逻辑在 server/ai/）
registerAiRoutes(app)

// v0.3.0：外部 Agent 接入（MCP，F22）+ 浏览器侧 token 管理
registerMcp(app)
registerAgentAdmin(app)

// 生产模式：托管前端静态文件（dist 存在时）
// dev（tsx，__dirname=server）：../dist；prod（server/dist）：../../dist
const distCandidates = [path.resolve(__dirname, '../dist'), path.resolve(__dirname, '../../dist')]
const distDir = distCandidates.find(c => fs.existsSync(path.join(c, 'index.html')))
if (distDir) {
  await app.register(fastifyStatic, {
    root: distDir,
    // 资源文件名带哈希可长缓存；index.html 必须每次校验，否则发版后浏览器吃旧 bundle
    setHeaders: (res, p) => {
      if (p.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache')
    },
  })
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) {
      reply.status(404).send({ error: 'not found' })
      return
    }
    reply.sendFile('index.html')
  })
}

await ensureVault()
watchVault()
initIndexService()
await app.listen({ host: HOST, port: PORT })
console.log(`[MarkGraph] http://${HOST}:${PORT}  vault: ${VAULT_DIR}`)
