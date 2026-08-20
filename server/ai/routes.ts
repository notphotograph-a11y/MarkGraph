/**
 * /api/ai/* 路由（薄层）：只做参数校验与向服务层转调，不含业务逻辑。
 * 未配置 AI 时 status 可用（configured=false），其余端点 503。
 */
import type { FastifyInstance } from 'fastify'
import { isConfigured, readAiEnv } from './config.js'
import { loadSettings, saveSettings, type AiLinkMode } from './settings.js'
import type { ChatMessage } from './openai.js'
import { askVault, hasIndex } from './rag.js'
import {
  aiStatusSnapshot,
  applySuggestion,
  emitAi,
  noteView,
  scheduleEnrich,
  scheduleEnrichAll,
  semanticSearch,
  undoLast,
} from './enrich.js'

const bad = (msg: string) => Object.assign(new Error(msg), { statusCode: 400 })

function requireAi(): void {
  if (!isConfigured()) {
    throw Object.assign(
      new Error('AI 未配置：请在服务端 .env 设置 AI_BASE_URL / AI_API_KEY / AI_CHAT_MODEL / AI_EMBED_MODEL 后重启'),
      { statusCode: 503 },
    )
  }
}

export function registerAiRoutes(app: FastifyInstance): void {
  app.get('/api/ai/status', async () => {
    const env = readAiEnv()
    return {
      configured: isConfigured(env),
      chatModel: env.chatModel,
      embedModel: env.embedModel,
      ...aiStatusSnapshot(),
      settings: await loadSettings(),
    }
  })

  app.get('/api/ai/notes', async req => {
    requireAi()
    const { path: p } = req.query as { path?: string }
    if (!p) throw bad('缺少 path')
    return noteView(p)
  })

  app.post('/api/ai/enrich', async req => {
    requireAi()
    const { path: p } = req.body as { path?: string }
    if (!p) throw bad('缺少 path')
    scheduleEnrich(p, 100)
    return { ok: true }
  })

  app.post('/api/ai/enrich-all', async () => {
    requireAi()
    return { ok: true, total: await scheduleEnrichAll() }
  })

  app.post('/api/ai/apply', async req => {
    requireAi()
    const { path: p, target, anchor } = req.body as { path?: string; target?: string; anchor?: string }
    if (!p || !target || !anchor) throw bad('参数不完整')
    await applySuggestion(p, target, anchor)
    return { ok: true }
  })

  app.post('/api/ai/undo', async req => {
    requireAi()
    const { path: p } = req.body as { path?: string }
    if (!p) throw bad('缺少 path')
    await undoLast(p)
    return { ok: true }
  })

  app.get('/api/ai/settings', async () => loadSettings())

  app.put('/api/ai/settings', async req => {
    const body = req.body as Partial<{ autoTags: boolean; autoSummary: boolean; autoLinks: AiLinkMode; maxAutoLinks: number }>
    const patch: typeof body = {}
    if (typeof body.autoTags === 'boolean') patch.autoTags = body.autoTags
    if (typeof body.autoSummary === 'boolean') patch.autoSummary = body.autoSummary
    if (body.autoLinks === 'off' || body.autoLinks === 'suggest' || body.autoLinks === 'auto') {
      patch.autoLinks = body.autoLinks
    }
    if (typeof body.maxAutoLinks === 'number' && Number.isFinite(body.maxAutoLinks)) {
      patch.maxAutoLinks = body.maxAutoLinks
    }
    const settings = await saveSettings(patch)
    emitAi({ type: 'settings', settings })
    return settings
  })

  app.post('/api/ai/search', async req => {
    requireAi()
    const { q } = req.body as { q?: string }
    if (!q || !q.trim()) throw bad('缺少 q')
    return { results: await semanticSearch(q.trim()) }
  })

  // RAG 问答（F13）：SSE 流式，事件 meta(来源)/delta(增量)/error
  app.post('/api/ai/ask', async (req, reply) => {
    requireAi()
    const { q, history } = req.body as { q?: string; history?: { role?: string; content?: unknown }[] }
    if (!q || !q.trim()) throw bad('缺少 q')
    const cleanHistory: ChatMessage[] = (Array.isArray(history) ? history : [])
      .filter(
        (m): m is { role: 'user' | 'assistant'; content: string } =>
          (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && !!m.content.trim(),
      )
      .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }))
      .slice(-12)

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    const send = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }
    try {
      await askVault(
        q.trim(),
        cleanHistory,
        sources =>
          send('meta', {
            sources: sources.map(s => ({ path: s.path, name: s.name, heading: s.heading })),
          }),
        text => send('delta', { text }),
      )
    } catch (err) {
      send('error', { message: (err as Error).message })
    }
    reply.raw.end()
  })

  // 问答空态判断（前端用它提示「先全库生成」）
  app.get('/api/ai/has-index', async () => {
    requireAi()
    return { indexed: await hasIndex() }
  })
}
