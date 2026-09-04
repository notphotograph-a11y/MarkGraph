/**
 * AI 设置（F9.2 / F14）：行为开关 + 网关连接配置，存 VAULT_DIR/.markgraph/settings.json。
 * 连接字段（含 API Key）只在服务端落盘（0600）；对外一律经 publicSettings() 掩码。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { VAULT_DIR } from '../fs-vault.js'

export type AiLinkMode = 'off' | 'suggest' | 'auto'

export interface AiConnection {
  baseUrl: string
  apiKey: string
  chatModel: string
  embedModel: string
}

export interface AiSettings {
  /** 自动生成标签写入 frontmatter */
  autoTags: boolean
  /** 自动生成摘要写入 frontmatter */
  autoSummary: boolean
  /** 建议链接模式：off 关闭 / suggest 仅建议 / auto 自动应用 */
  autoLinks: AiLinkMode
  /** 单次自动插入链接上限 */
  maxAutoLinks: number
  /** 网关连接（UI 内配置，优先于 .env，F14.5） */
  ai: AiConnection
  /** 写作设置（F27）：模板/日记目录约定 */
  writing: WritingSettings
}

export interface WritingSettings {
  /** 模板文件夹（vault 相对路径） */
  templatesDir: string
  /** 日记文件夹（vault 相对路径） */
  diaryDir: string
  /** 日记模板文件（vault 相对路径，不存在则建空日记） */
  diaryTemplate: string
}

export const DEFAULT_SETTINGS: AiSettings = {
  autoTags: true,
  autoSummary: true,
  autoLinks: 'auto',
  maxAutoLinks: 3,
  ai: { baseUrl: '', apiKey: '', chatModel: '', embedModel: '' },
  writing: { templatesDir: '模板', diaryDir: '日记', diaryTemplate: '模板/日记.md' },
}

const DIR = path.join(VAULT_DIR, '.markgraph')
const FILE = path.join(DIR, 'settings.json')

export async function loadSettings(): Promise<AiSettings> {
  try {
    return normalize(JSON.parse(await fs.readFile(FILE, 'utf8')))
  } catch {
    return structuredClone(DEFAULT_SETTINGS)
  }
}

export async function saveSettings(patch: Record<string, unknown>): Promise<AiSettings> {
  const cur = await loadSettings()
  const next = normalize({
    ...cur,
    ...patch,
    ai: { ...cur.ai, ...(patch.ai as object ?? {}) },
    writing: { ...cur.writing, ...(patch.writing as object ?? {}) },
  })
  await fs.mkdir(DIR, { recursive: true })
  await fs.writeFile(FILE, JSON.stringify(next, null, 2), 'utf8')
  await fs.chmod(FILE, 0o600).catch(() => undefined)
  return next
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

export function normalize(raw: Record<string, unknown>): AiSettings {
  const s = structuredClone(DEFAULT_SETTINGS)
  if (typeof raw.autoTags === 'boolean') s.autoTags = raw.autoTags
  if (typeof raw.autoSummary === 'boolean') s.autoSummary = raw.autoSummary
  if (raw.autoLinks === 'off' || raw.autoLinks === 'suggest' || raw.autoLinks === 'auto') {
    s.autoLinks = raw.autoLinks
  }
  if (typeof raw.maxAutoLinks === 'number' && Number.isFinite(raw.maxAutoLinks)) {
    s.maxAutoLinks = Math.min(10, Math.max(0, Math.floor(raw.maxAutoLinks)))
  }
  const ai = raw.ai
  if (ai && typeof ai === 'object') {
    const c = ai as Record<string, unknown>
    if (typeof c.baseUrl === 'string') s.ai.baseUrl = c.baseUrl.trim().replace(/\/+$/, '')
    if (typeof c.chatModel === 'string') s.ai.chatModel = c.chatModel.trim()
    if (typeof c.embedModel === 'string') s.ai.embedModel = c.embedModel.trim()
    // key 允许显式清空（改用 .env），空串在 PUT 语义里由路由层拦截为「不变」，此处只兜底
    if (typeof c.apiKey === 'string') s.ai.apiKey = c.apiKey.trim()
  }
  const w = raw.writing
  if (w && typeof w === 'object') {
    const c = w as Record<string, unknown>
    for (const k of ['templatesDir', 'diaryDir', 'diaryTemplate'] as const) {
      if (typeof c[k] === 'string') {
        // vault 相对 POSIX 路径：去首尾斜杠、拒绝对应的隐藏语义
        s.writing[k] = (c[k] as string).trim().replace(/^\/+|\/+$/g, '')
      }
    }
  }
  return s
}

/** 掩码：sk-***尾4位（N11.1：任何出服务端的 key 都走这里） */
export function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 8) return '***'
  return `${key.slice(0, 3)}***${key.slice(-4)}`
}

/** 对外（GET/SSE/前端）的设置形状：不含完整 key */
export function publicSettings(s: AiSettings) {
  return {
    autoTags: s.autoTags,
    autoSummary: s.autoSummary,
    autoLinks: s.autoLinks,
    maxAutoLinks: s.maxAutoLinks,
    ai: {
      baseUrl: s.ai.baseUrl,
      chatModel: s.ai.chatModel,
      embedModel: s.ai.embedModel,
      apiKeyMasked: maskKey(s.ai.apiKey),
      apiKeySet: !!s.ai.apiKey,
    },
  }
}

export type AiSettingsPublic = ReturnType<typeof publicSettings>
