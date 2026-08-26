/**
 * 写类工具限速（N12.4）：按 token 维护 60s 滑动窗口，默认 60 次/分钟。
 * 防 agent 循环失控写爆文件系统；超限抛 429 语义错误（MCP 工具结果 isError）。
 */
const windows = new Map<string, number[]>()

export class RateLimitError extends Error {
  constructor(retryAfterSec: number) {
    super(`写操作限速：每分钟次数已达上限，请 ${retryAfterSec} 秒后重试（可在 .markgraph/agents.json 调整 writeLimitPerMin）`)
  }
}

/** 记录一次写调用；超限抛 RateLimitError */
export function consumeWriteQuota(tokenId: string, limitPerMin: number): void {
  if (limitPerMin <= 0) return
  const now = Date.now()
  const arr = (windows.get(tokenId) ?? []).filter(t => now - t < 60_000)
  if (arr.length >= limitPerMin) {
    const oldest = arr[0]
    const retry = Math.ceil((60_000 - (now - oldest)) / 1000)
    windows.set(tokenId, arr)
    throw new RateLimitError(Math.max(1, retry))
  }
  arr.push(now)
  windows.set(tokenId, arr)
}
