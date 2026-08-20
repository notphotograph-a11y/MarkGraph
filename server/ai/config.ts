/** AI 环境配置与目录常量（F9.1）。AI 是可选能力：未配置时应用照常运行。 */
import path from 'node:path'
import { VAULT_DIR } from '../fs-vault.js'

export interface AiEnv {
  baseUrl: string
  apiKey: string
  chatModel: string
  embedModel: string
}

export function readAiEnv(): AiEnv {
  return {
    baseUrl: (process.env.AI_BASE_URL || '').replace(/\/+$/, ''),
    apiKey: process.env.AI_API_KEY || '',
    chatModel: process.env.AI_CHAT_MODEL || '',
    embedModel: process.env.AI_EMBED_MODEL || '',
  }
}

/** chat + embeddings 可用即视为已配置（向量是相关笔记/语义搜索的硬依赖） */
export function isConfigured(env: AiEnv = readAiEnv()): boolean {
  return !!(env.baseUrl && env.apiKey && env.chatModel && env.embedModel)
}

/** 保存后到触发富集的防抖间隔（测试用 AI_DEBOUNCE_MS 缩短） */
export const DEBOUNCE_MS = Number(process.env.AI_DEBOUNCE_MS || 8000)

/** vault 内 AI 数据目录（点开头：文件树不显示，chokidar 不监听） */
export const MARKGRAPH_DIR = path.join(VAULT_DIR, '.markgraph')
