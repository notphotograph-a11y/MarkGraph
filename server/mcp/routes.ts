/**
 * /mcp 端点（F22.1）：Streamable HTTP、无状态实现（每个请求独立处理，不要求会话）。
 * 协议：MCP JSON-RPC 2.0——initialize / notifications/initialized / ping / tools/list / tools/call。
 * 鉴权：Authorization: Bearer mg_...（与浏览器 Cookie 会话相互独立，F22.2）。
 * 安全：写类工具限速（N12.4）；全部调用进审计（N12.3）；token 不落日志。
 */
import type { FastifyInstance } from 'fastify'
import { createToken, listTokens, revokeToken, verifyToken, writeLimitPerMin, type TokenScope } from './tokens.js'
import { consumeWriteQuota, RateLimitError } from './rate-limit.js'
import { appendAudit } from './audit.js'
import { McpToolError, TOOLS, toolByName } from './tools.js'
import { markIndexDirty } from '../shared/index-service.js'

const PROTOCOL_VERSION = '2025-03-26'

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: number | string | null
  method: string
  params?: Record<string, unknown>
}

function rpcResult(id: JsonRpcRequest['id'], result: unknown) {
  return { jsonrpc: '2.0' as const, id, result }
}

function rpcError(id: JsonRpcRequest['id'], code: number, message: string, extra?: Record<string, unknown>) {
  return { jsonrpc: '2.0' as const, id, error: { code, message, ...extra } }
}

import type { FastifyReply } from 'fastify'

function unauthorized(reply: FastifyReply, message: string) {
  reply.status(401).header('WWW-Authenticate', 'Bearer realm="MarkGraph MCP"')
  return rpcError(null, -32001, message)
}

export function registerMcp(app: FastifyInstance): void {
  app.all('/mcp', async (req, reply) => {
    if (req.method !== 'POST') {
      reply.status(405).header('Allow', 'POST')
      return { error: 'MCP 端点只接受 POST（Streamable HTTP）' }
    }

    // ---- 鉴权（在协议处理之前：连 initialize 也需要 token）----
    const auth = req.headers.authorization ?? ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : undefined
    const v = await verifyToken(token)
    if (!v.ok) {
      const msg =
        v.reason === 'not-enabled'
          ? 'Agent 接入未启用：先在 MarkGraph「设置 → Agent 接入」生成 API Token'
          : v.reason === 'missing'
            ? '缺少 Authorization: Bearer <token>'
            : 'token 无效或已吊销'
      return unauthorized(reply, msg)
    }
    const scope = v.scope as TokenScope
    const tokenId = v.tokenId as string

    // ---- JSON-RPC 解析 ----
    const body = req.body
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      reply.status(400)
      return rpcError(null, -32600, '请求体必须是单个 JSON-RPC 2.0 对象')
    }
    const msg = body as JsonRpcRequest
    if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      reply.status(400)
      return rpcError(msg.id ?? null, -32600, '非法的 JSON-RPC 2.0 请求')
    }

    // 通知（无 id）：204 无正文
    if (msg.id === undefined || msg.id === null) {
      if (msg.method === 'notifications/initialized' || msg.method.startsWith('notifications/')) {
        reply.status(204)
        return null
      }
      reply.status(400)
      return rpcError(null, -32600, `通知方法未知：${msg.method}`)
    }

    switch (msg.method) {
      case 'initialize':
        return rpcResult(msg.id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'markgraph', version: '0.3.0', title: 'MarkGraph vault for AI agents' },
          instructions:
            '人用浏览器、agent 用 MCP：全部工具都是原子操作，整理策略由你编排。写入前先 read_note 取 mtime 做乐观并发；删除一律进回收站可恢复；health_check 是整理的统一入口。',
        })
      case 'ping':
        return rpcResult(msg.id, {})
      case 'tools/list':
        return rpcResult(msg.id, {
          tools: TOOLS.map(t => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
            annotations: { readOnlyHint: t.scope === 'read' },
          })),
        })
      case 'tools/call': {
        const name = (msg.params?.name ?? '') as string
        const args = (msg.params?.arguments ?? {}) as Record<string, unknown>
        const tool = toolByName(name)
        if (!tool) {
          return rpcError(msg.id, -32602, `未知工具：${name}（tools/list 查看全部）`)
        }
        if (tool.scope === 'write' && scope !== 'read-write') {
          await appendAudit({ ts: new Date().toISOString(), tool: name, ok: false, write: true, error: 'scope denied' })
          return rpcResult(msg.id, {
            content: [{ type: 'text', text: `当前 token 为 read 作用域，写工具 ${name} 被拒绝。需要 read-write token（在应用设置里生成）。` }],
            isError: true,
          })
        }
        if (tool.scope === 'write') {
          try {
            consumeWriteQuota(tokenId, await writeLimitPerMin())
          } catch (err) {
            const message = err instanceof RateLimitError ? err.message : '写操作被限速'
            await appendAudit({ ts: new Date().toISOString(), tool: name, ok: false, write: true, error: 'rate limited' })
            return rpcResult(msg.id, { content: [{ type: 'text', text: message }], isError: true })
          }
        }
        try {
          const result = await tool.handler(args)
          if (tool.scope === 'write') markIndexDirty() // 下一次查询立即反映写入（不等 watcher 防抖）
          await appendAudit({
            ts: new Date().toISOString(),
            tool: name,
            ok: true,
            write: tool.scope === 'write',
            args: summarizeArgs(args),
          })
          return rpcResult(msg.id, { content: [{ type: 'text', text: JSON.stringify(result, null, 1) }] })
        } catch (err) {
          const isToolErr = err instanceof McpToolError
          const message = (err as Error).message || '工具执行失败'
          await appendAudit({
            ts: new Date().toISOString(),
            tool: name,
            ok: false,
            write: tool.scope === 'write',
            args: summarizeArgs(args),
            error: message.slice(0, 200),
          })
          if (isToolErr) {
            const content: Array<{ type: string; text: string }> = [{ type: 'text', text: message }]
            if ((err as McpToolError).data !== undefined) {
              content.push({ type: 'text', text: JSON.stringify((err as McpToolError).data, null, 1) })
            }
            return rpcResult(msg.id, { content, isError: true })
          }
          console.error('[MarkGraph/MCP] 工具异常', name, message)
          return rpcResult(msg.id, { content: [{ type: 'text', text: `工具执行失败：${message}` }], isError: true })
        }
      }
      default:
        return rpcError(msg.id, -32601, `方法不存在：${msg.method}`)
    }
  })
}

/** 参数摘要进审计：截断 200 字，content 大字段整体省略（N12.3） */
function summarizeArgs(args: Record<string, unknown>): string {
  const slim: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === 'string' && v.length > 80) slim[k] = `${v.slice(0, 60)}…(${v.length}字)`
    else slim[k] = v
  }
  const s = JSON.stringify(slim)
  return s.length > 200 ? s.slice(0, 200) : s
}

/**
 * 浏览器侧 token 管理（A2：设置对话框「Agent 接入」卡片的后端）。
 * /api/agents/* 走 Cookie 会话守卫（registerAuth 的 onRequest hook 覆盖全部 /api/*）。
 */
export function registerAgentAdmin(app: FastifyInstance): void {
  app.get('/api/agents/tokens', async () => ({ tokens: await listTokens() }))

  // 生成：明文 token 只在本响应出现一次
  app.post('/api/agents/tokens', async req => {
    const { name, scope } = (req.body ?? {}) as { name?: string; scope?: string }
    if (typeof name !== 'string' || !name.trim()) {
      throw Object.assign(new Error('请给 agent 起个名字（如「ZCode on MacBook」）'), { statusCode: 400 })
    }
    const s = scope === 'read' ? 'read' : 'read-write'
    const { token, stored } = await createToken(name, s)
    return { token, scope: stored.scope, id: stored.id, name: stored.name, createdAt: stored.createdAt }
  })

  app.delete('/api/agents/tokens/:id', async req => {
    const { id } = req.params as { id?: string }
    if (!id) throw Object.assign(new Error('缺少 id'), { statusCode: 400 })
    const ok = await revokeToken(id)
    if (!ok) throw Object.assign(new Error('token 不存在或已吊销'), { statusCode: 404 })
    return { ok: true }
  })
}
