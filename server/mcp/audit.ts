/**
 * 审计日志（N12.3）：每次 agent 工具调用追加一行 JSONL。
 * 记录时间、工具、参数摘要（截断）、结果状态；token 明文与完整内容永不入日志。
 * 文件：vault/.markgraph/audit.jsonl（MCP 工具不可直接读写，经 read_audit_log 访问）
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { VAULT_DIR } from '../fs-vault.js'

const AUDIT_FILE = path.join(VAULT_DIR, '.markgraph', 'audit.jsonl')

export interface AuditEntry {
  ts: string
  tool: string
  ok: boolean
  /** 参数摘要：JSON 截断到 200 字 */
  args?: string
  error?: string
  /** 写类工具才记（读操作不刷屏） */
  write?: boolean
}

export async function appendAudit(e: AuditEntry): Promise<void> {
  try {
    await fs.mkdir(path.dirname(AUDIT_FILE), { recursive: true })
    await fs.appendFile(AUDIT_FILE, JSON.stringify(e) + '\n', 'utf8')
  } catch (err) {
    /* 审计失败不阻断工具调用，但也不静默吞掉排查线索 */
    console.error('[MarkGraph/MCP] 审计写入失败', (err as Error).message)
  }
}

/** 读最近 last 条（默认 50，上限 500）；无文件返回空 */
export async function readAudit(last = 50): Promise<AuditEntry[]> {
  let raw: string
  try {
    raw = await fs.readFile(AUDIT_FILE, 'utf8')
  } catch {
    return []
  }
  const lines = raw.split('\n').filter(Boolean)
  const n = Math.max(1, Math.min(500, Math.floor(last) || 50))
  return lines
    .slice(-n)
    .map(l => {
      try {
        return JSON.parse(l) as AuditEntry
      } catch {
        return null
      }
    })
    .filter((x): x is AuditEntry => !!x)
}
