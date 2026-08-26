/**
 * Agent API Token（F22.2 / N12.1）：
 * - 形如 mg_<24hex>，仅生成时明文返回一次；服务端只存 SHA-256
 * - 校验用常量时间比较；吊销即时生效（每次请求都重读文件，单进程内 50ms 缓存防 agent 循环打爆磁盘）
 * - 未配置任何 token 时 /mcp 一律 401（提示「未启用 Agent 接入」）
 * 文件：vault/.markgraph/agents.json
 */
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { VAULT_DIR } from '../fs-vault.js'

export type TokenScope = 'read' | 'read-write'

export interface StoredToken {
  id: string
  name: string
  scope: TokenScope
  /** sha256(token) 的 hex；明文永不落盘 */
  hash: string
  createdAt: string
  lastUsedAt?: string
}

interface AgentsFile {
  tokens: StoredToken[]
  /** 写类工具限速（次/分钟，N12.4）；0 = 不限 */
  writeLimitPerMin?: number
}

const AGENTS_FILE = path.join(VAULT_DIR, '.markgraph', 'agents.json')

const emptyFile = (): AgentsFile => ({ tokens: [] })

async function readAgents(): Promise<AgentsFile> {
  try {
    const raw = JSON.parse(await fs.readFile(AGENTS_FILE, 'utf8')) as Partial<AgentsFile>
    if (!Array.isArray(raw.tokens)) return emptyFile()
    return {
      tokens: raw.tokens.filter(
        (t): t is StoredToken => !!t && typeof t.hash === 'string' && (t.scope === 'read' || t.scope === 'read-write'),
      ),
      writeLimitPerMin: typeof raw.writeLimitPerMin === 'number' ? raw.writeLimitPerMin : undefined,
    }
  } catch {
    return emptyFile()
  }
}

async function writeAgents(f: AgentsFile): Promise<void> {
  await fs.mkdir(path.dirname(AGENTS_FILE), { recursive: true })
  await fs.writeFile(AGENTS_FILE, JSON.stringify(f, null, 2) + '\n', 'utf8')
}

/** 常量时间比较两个 hex hash */
function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex')
  const bb = Buffer.from(b, 'hex')
  if (ab.length !== bb.length || ab.length === 0) return false
  return crypto.timingSafeEqual(ab, bb)
}

/* ---- 50ms 进程内缓存：agent 高频轮询时避免每请求读盘 ---- */
let cache: { at: number; file: AgentsFile } | null = null

async function agents(): Promise<AgentsFile> {
  if (cache && Date.now() - cache.at < 50) return cache.file
  const file = await readAgents()
  cache = { at: Date.now(), file }
  return file
}

export interface VerifyResult {
  ok: boolean
  scope?: TokenScope
  tokenId?: string
  reason?: 'missing' | 'not-enabled' | 'invalid'
}

export async function verifyToken(token: string | undefined): Promise<VerifyResult> {
  const file = await agents()
  if (!file.tokens.length) return { ok: false, reason: 'not-enabled' }
  if (!token) return { ok: false, reason: 'missing' }
  const hash = crypto.createHash('sha256').update(token).digest('hex')
  const hit = file.tokens.find(t => safeEqualHex(t.hash, hash))
  if (!hit) return { ok: false, reason: 'invalid' }
  return { ok: true, scope: hit.scope, tokenId: hit.id }
}

/** 生成 token：明文只在本函数返回值里出现一次 */
export async function createToken(name: string, scope: TokenScope): Promise<{ token: string; stored: StoredToken }> {
  const file = await agents()
  const secret = crypto.randomBytes(12).toString('hex')
  const token = `mg_${secret}`
  const stored: StoredToken = {
    id: crypto.randomBytes(4).toString('hex'),
    name: name.trim().slice(0, 60) || 'unnamed agent',
    scope,
    hash: crypto.createHash('sha256').update(token).digest('hex'),
    createdAt: new Date().toISOString(),
  }
  file.tokens.push(stored)
  await writeAgents(file)
  cache = null
  return { token, stored }
}

export async function revokeToken(id: string): Promise<boolean> {
  const file = await agents()
  const before = file.tokens.length
  file.tokens = file.tokens.filter(t => t.id !== id)
  if (file.tokens.length === before) return false
  await writeAgents(file)
  cache = null
  return true
}

/** 列出 token（不含 hash，只有指纹前 8 位便于辨认） */
export async function listTokens(): Promise<Array<Omit<StoredToken, 'hash'> & { fingerprint: string }>> {
  const file = await agents()
  return file.tokens.map(({ hash, ...rest }) => ({ ...rest, fingerprint: hash.slice(0, 8) }))
}

export async function writeLimitPerMin(): Promise<number> {
  const file = await agents()
  return typeof file.writeLimitPerMin === 'number' ? file.writeLimitPerMin : 60
}

export async function setWriteLimitPerMin(n: number): Promise<void> {
  const file = await agents()
  file.writeLimitPerMin = n
  await writeAgents(file)
  cache = null
}
