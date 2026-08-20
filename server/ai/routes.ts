/**
 * /api/ai/* 路由（薄层）：只做参数校验与向服务层转调，不含业务逻辑。
 * 未配置 AI（.env 与 UI 设置都缺）时 status 可用（configured=false），其余端点 503。
 */
import type { FastifyInstance } from 'fastify'
import { getAiConfig, isComplete, invalidateAiConfigCache, type AiEnv } from './config.js'
import { loadSettings, publicSettings, saveSettings, type AiLinkMode } from './settings.js'
import { chatJson, embed, type ChatMessage } from './openai.js'
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

async function requireAi(): Promise<void> {
  if (!isComplete(await getAiConfig())) {
    throw Object.assign(
      new Error('AI 未配置：在应用「设置」里填写网关地址与模型，或在服务端 .env 配置后重启'),
      { statusCode: 503 },
    )
  }
}

export function registerAiRoutes(app: FastifyInstance): void {
  app.get('/api/ai/status', async () => {
    const env = await getAiConfig()
    return {
      configured: isComplete(env),
      chatModel: env.chatModel,
      embedModel: env.embedModel,
      ...aiStatusSnapshot(),
      settings: publicSettings(await loadSettings()),
    }
  })

  app.get('/api/ai/notes', async req => {
    await requireAi()
    const { path: p } = req.query as { path?: string }
    if (!p) throw bad('缺少 path')
    return noteView(p)
  })

  app.post('/api/ai/enrich', async req => {
    await requireAi()
    const { path: p } = req.body as { path?: string }
    if (!p) throw bad('缺少 path')
    scheduleEnrich(p, 100)
    return { ok: true }
  })

  app.post('/api/ai/enrich-all', async () => {
    await requireAi()
    return { ok: true, total: await scheduleEnrichAll() }
  })

  app.post('/api/ai/apply', async req => {
    await requireAi()
    const { path: p, target, anchor } = req.body as { path?: string; target?: string; anchor?: string }
    if (!p || !target || !anchor) throw bad('参数不完整')
    await applySuggestion(p, target, anchor)
    return { ok: true }
  })

  app.post('/api/ai/undo', async req => {
    await requireAi()
    const { path: p } = req.body as { path?: string }
    if (!p) throw bad('缺少 path')
    await undoLast(p)
    return { ok: true }
  })

  app.get('/api/ai/settings', async () => publicSettings(await loadSettings()))

  app.put('/api/ai/settings', async req => {
    const body = req.body as Partial<{
      autoTags: boolean
      autoSummary: boolean
      autoLinks: AiLinkMode
      maxAutoLinks: number
      ai: Partial<Record<'baseUrl' | 'apiKey' | 'chatModel' | 'embedModel', string>>
    }>
    const patch: Record<string, unknown> = {}
    if (typeof body.autoTags === 'boolean') patch.autoTags = body.autoTags
    if (typeof body.autoSummary === 'boolean') patch.autoSummary = body.autoSummary
    if (body.autoLinks === 'off' || body.autoLinks === 'suggest' || body.autoLinks === 'auto') {
      patch.autoLinks = body.autoLinks
    }
    if (typeof body.maxAutoLinks === 'number' && Number.isFinite(body.maxAutoLinks)) {
      patch.maxAutoLinks = body.maxAutoLinks
    }
    if (body.ai && typeof body.ai === 'object') {
      const p: Record<string, string> = {}
      for (const k of ['baseUrl', 'chatModel', 'embedModel'] as const) {
        if (typeof body.ai[k] === 'string') p[k] = body.ai[k] as string
      }
      // key：留空/缺省 = 保持原值（N11.1）
      if (typeof body.ai.apiKey === 'string' && body.ai.apiKey.trim()) p.apiKey = body.ai.apiKey.trim()
      if (Object.keys(p).length) patch.ai = p
    }
    const settings = await saveSettings(patch)
    invalidateAiConfigCache()
    const pub = publicSettings(settings)
    emitAi({ type: 'settings', settings: pub })
    return pub
  })

  // 测试连接（F14.2）：传入值 → 已存值 → .env 逐级回退，先测后存
  app.post('/api/ai/test-connection', async req => {
    const body = (req.body ?? {}) as Partial<Record<'baseUrl' | 'apiKey' | 'chatModel' | 'embedModel', string>>
    const base = await getAiConfig()
    const pick = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v.trim() : fallback)
    const env: AiEnv = {
      baseUrl: pick(body.baseUrl, base.baseUrl).replace(/\/+$/, ''),
      apiKey: pick(body.apiKey, base.apiKey),
      chatModel: pick(body.chatModel, base.chatModel),
      embedModel: pick(body.embedModel, base.embedModel),
    }
    const out = { reachable: false, embedOk: false, chatOk: false, error: '' }
    try {
      await embed(env, ['连接测试'])
      out.embedOk = true
    } catch (err) {
      out.error = (err as Error).message
    }
    if (env.chatModel) {
      try {
        const reply = await chatJson(env, '你是连通性测试助手，只输出 JSON。', '输出 {"ok":true}')
        out.chatOk = reply.length > 0
        if (!out.chatOk && !out.error) out.error = 'chat 模型返回为空'
      } catch (err) {
        if (!out.error) out.error = (err as Error).message
      }
    }
    out.reachable = out.embedOk || out.chatOk
    return out
  })

  app.post('/api/ai/search', async req => {
    await requireAi()
    const { q } = req.body as { q?: string }
    if (!q || !q.trim()) throw bad('缺少 q')
    return { results: await semanticSearch(q.trim()) }
  })

  // RAG 问答（F13）：SSE 流式，事件 meta(来源)/delta(增量)/error
  app.post('/api/ai/ask', async (req, reply) => {
    await requireAi()
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
    await requireAi()
    return { indexed: await hasIndex() }
  })
}
