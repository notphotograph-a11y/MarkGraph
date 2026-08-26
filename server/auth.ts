/**
 * 单用户口令 + Cookie 会话（F21）。
 * EventSource 不能带 Authorization，所以必须用 cookie。
 */
import crypto from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import cookie from '@fastify/cookie'
import secureSession from '@fastify/secure-session'

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost'])

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK.has(host)
}

function timingEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) {
    crypto.timingSafeEqual(left, left)
    return false
  }
  return crypto.timingSafeEqual(left, right)
}

const hits = new Map<string, { n: number; reset: number }>()

function limited(ip: string): boolean {
  const now = Date.now()
  const cur = hits.get(ip)
  if (!cur || now > cur.reset) {
    hits.set(ip, { n: 1, reset: now + 60_000 })
    return false
  }
  cur.n += 1
  return cur.n > 8
}

export function assertBindAllowed(host: string): void {
  const password = process.env.AUTH_PASSWORD ?? ''
  const disabled = process.env.AUTH_DISABLED === '1'
  if (isLoopbackHost(host)) return
  if (disabled) {
    throw new Error('[MarkGraph] AUTH_DISABLED 只能用于回环地址；非回环必须设置 AUTH_PASSWORD')
  }
  if (!password) {
    throw new Error('[MarkGraph] 非回环监听必须设置 AUTH_PASSWORD，否则拒绝启动')
  }
}

export function authRequired(): boolean {
  const password = process.env.AUTH_PASSWORD ?? ''
  if (!password) return false
  if (process.env.AUTH_DISABLED === '1') return false
  return true
}

function sessionKey(): Buffer {
  const raw = process.env.AUTH_SECRET
  if (raw && raw.length >= 32) return Buffer.from(raw).subarray(0, 32)
  const generated = crypto.randomBytes(32)
  if (authRequired()) {
    console.warn('[MarkGraph] 未设置 AUTH_SECRET，本次启动使用随机密钥（重启后需重新登录）')
  }
  return generated
}

declare module '@fastify/secure-session' {
  interface SessionData {
    ok?: boolean
    epoch?: number
  }
}

// secure-session 是无状态签名 cookie：delete() 只清浏览器侧，旧 cookie 仍验签通过。
// 用进程内世代号真正吊销会话——登出即轮换，所有已发 cookie 全部失效。
let sessionEpoch = crypto.randomInt(0x7fffffff)

export async function registerAuth(app: FastifyInstance): Promise<void> {
  await app.register(cookie)
  await app.register(secureSession, {
    key: sessionKey(),
    cookieName: 'mg_session',
    cookie: {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: 'auto',
    },
  })

  const required = authRequired()

  app.get('/api/health', async () => ({ ok: true }))
  app.get('/api/auth/status', async req => ({
    required,
    loggedIn: !required || !!req.session.get('ok'),
  }))

  app.post('/api/auth/login', async (req, reply) => {
    if (!required) return { ok: true }
    if (limited(req.ip)) {
      return reply.code(429).send({ error: '尝试过多，请稍后再试' })
    }
    const { password } = (req.body ?? {}) as { password?: string }
    const expected = process.env.AUTH_PASSWORD ?? ''
    if (typeof password !== 'string' || !timingEqual(password, expected)) {
      return reply.code(401).send({ error: '口令不对' })
    }
    req.session.set('ok', true)
    req.session.set('epoch', sessionEpoch)
    return { ok: true }
  })

  app.post('/api/auth/logout', async req => {
    sessionEpoch = crypto.randomInt(0x7fffffff)
    req.session.delete()
    return { ok: true }
  })

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!required) return
    const url = req.url.split('?')[0]
    if (
      url === '/api/health' ||
      url === '/api/auth/login' ||
      url === '/api/auth/status' ||
      url === '/api/auth/logout'
    ) {
      return
    }
    if (!url.startsWith('/api/')) return
    if (!req.session.get('ok') || req.session.get('epoch') !== sessionEpoch) {
      return reply.code(401).send({ error: '未登录' })
    }
  })
}
