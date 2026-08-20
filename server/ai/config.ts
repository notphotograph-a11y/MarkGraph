/** AI 环境配置与目录常量（F9.1 / F14.5）。有效配置 = settings.json 的 ai 段叠加在 .env 之上。 */
import path from 'node:path'
import { VAULT_DIR } from '../fs-vault.js'
import { loadSettings } from './settings.js'

export interface AiEnv {
  baseUrl: string
  apiKey: string
  chatModel: string
  embedModel: string
}

/** .env 基线（启动时读，无 UI 配置时的默认来源） */
export function readAiEnv(): AiEnv {
  return {
    baseUrl: (process.env.AI_BASE_URL || '').replace(/\/+$/, ''),
    apiKey: process.env.AI_API_KEY || '',
    chatModel: process.env.AI_CHAT_MODEL || '',
    embedModel: process.env.AI_EMBED_MODEL || '',
  }
}

/** 网关 + 双模型齐备即视为已配置；API Key 可空（Ollama 等本地网关零密钥，F18.1） */
export function isComplete(env: AiEnv): boolean {
  return !!(env.baseUrl && env.chatModel && env.embedModel)
}

let cache: { at: number; env: AiEnv } | null = null

/** 有效配置：settings.json 优先、字段级回退 .env（3s 缓存，保存设置后主动失效） */
export async function getAiConfig(): Promise<AiEnv> {
  if (cache && Date.now() - cache.at < 3000) return cache.env
  const env = readAiEnv()
  const s = (await loadSettings()).ai
  const merged: AiEnv = {
    baseUrl: s.baseUrl || env.baseUrl,
    apiKey: s.apiKey || env.apiKey,
    chatModel: s.chatModel || env.chatModel,
    embedModel: s.embedModel || env.embedModel,
  }
  cache = { at: Date.now(), env: merged }
  return merged
}

/** 设置保存后调用，让新配置立即生效 */
export function invalidateAiConfigCache(): void {
  cache = null
}

/** 保存后到触发富集的防抖间隔（测试用 AI_DEBOUNCE_MS 缩短） */
export const DEBOUNCE_MS = Number(process.env.AI_DEBOUNCE_MS || 8000)

/** vault 内 AI 数据目录（点开头：文件树不显示，chokidar 不监听） */
export const MARKGRAPH_DIR = path.join(VAULT_DIR, '.markgraph')
