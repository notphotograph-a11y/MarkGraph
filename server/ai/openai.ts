/**
 * OpenAI 兼容客户端（F9.1）：支持 newAPI 等网关，仅用全局 fetch，不引 SDK。
 * 超时：chat 120s / embeddings 60s（N9.1）。
 */
import type { AiEnv } from './config.js'

export class AiError extends Error {}

interface ChatResponse {
  choices?: { message?: { content?: string } }[]
}

interface EmbedResponse {
  data?: { embedding?: number[] }[]
}

async function post<T>(env: AiEnv, urlPath: string, body: unknown, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${env.baseUrl}${urlPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.apiKey}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new AiError(`AI 接口 ${res.status}: ${text.slice(0, 300)}`)
    }
    return (await res.json()) as T
  } catch (err) {
    if (err instanceof AiError) throw err
    throw new AiError(`AI 请求失败: ${(err as Error).message}`)
  } finally {
    clearTimeout(timer)
  }
}

/** 单轮 chat，返回内容文本（约定模型输出 JSON 字符串） */
export async function chatJson(env: AiEnv, system: string, user: string): Promise<string> {
  const base = {
    model: env.chatModel,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.3,
    max_tokens: 2000,
  }
  // 部分网关/模型不支持 response_format：失败后去掉重试一次
  const run = async (extra: Record<string, unknown>) => {
    const data = await post<ChatResponse>(env, '/chat/completions', { ...base, ...extra }, 120_000)
    return data.choices?.[0]?.message?.content ?? ''
  }
  try {
    return await run({ response_format: { type: 'json_object' } })
  } catch {
    return await run({})
  }
}

/** 批量向量化（网关普遍限制单批条数，这里每批 ≤ 16） */
export async function embed(env: AiEnv, input: string[]): Promise<number[][]> {
  const out: number[][] = []
  for (let i = 0; i < input.length; i += 16) {
    const batch = input.slice(i, i + 16)
    const data = await post<EmbedResponse>(env, '/embeddings', { model: env.embedModel, input: batch }, 60_000)
    const vecs = data.data?.map(d => d.embedding ?? [])
    if (!vecs || vecs.length !== batch.length) {
      throw new AiError('AI 接口返回的向量数量与输入不一致')
    }
    out.push(...vecs)
  }
  return out
}

/** 从 chat 输出中提取 JSON 对象（容忍 ```json 围栏与前后杂文） */
export function extractJson(text: string): Record<string, unknown> | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const raw = fenced ? fenced[1] : text
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * 流式对话（Phase 3 RAG 问答）：逐段回调增量文本。
 * 网关忽略 stream 参数返回整体 JSON 时，自动降级为一次性回调。
 */
export async function chatStream(
  env: AiEnv,
  messages: ChatMessage[],
  onDelta: (text: string) => void,
): Promise<void> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 180_000)
  try {
    const res = await fetch(`${env.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.apiKey}` },
      body: JSON.stringify({ model: env.chatModel, messages, stream: true, temperature: 0.4, max_tokens: 2000 }),
      signal: ctrl.signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new AiError(`AI 接口 ${res.status}: ${text.slice(0, 300)}`)
    }
    const ctype = res.headers.get('content-type') ?? ''
    if (ctype.includes('application/json') || !res.body) {
      const data = (await res.json()) as ChatResponse
      const whole = data.choices?.[0]?.message?.content ?? ''
      if (whole) onDelta(whole)
      return
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const s = line.trim()
        if (!s.startsWith('data:')) continue
        const payload = s.slice(5).trim()
        if (payload === '[DONE]') return
        try {
          const j = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] }
          const d = j.choices?.[0]?.delta?.content
          if (d) onDelta(d)
        } catch {
          /* 跳过无法解析的行 */
        }
      }
    }
  } catch (err) {
    if (err instanceof AiError) throw err
    throw new AiError(`AI 请求失败: ${(err as Error).message}`)
  } finally {
    clearTimeout(timer)
  }
}
