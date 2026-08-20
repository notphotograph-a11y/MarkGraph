/** AI 开关设置（F9.2）：存 VAULT_DIR/.markgraph/settings.json，改完即时生效。 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { MARKGRAPH_DIR } from './config.js'

export type AiLinkMode = 'off' | 'suggest' | 'auto'

export interface AiSettings {
  /** 自动生成标签写入 frontmatter */
  autoTags: boolean
  /** 自动生成摘要写入 frontmatter */
  autoSummary: boolean
  /** 建议链接模式：off 关闭 / suggest 仅面板建议 / auto 自动应用 */
  autoLinks: AiLinkMode
  /** 单次自动插入链接上限 */
  maxAutoLinks: number
}

export const DEFAULT_SETTINGS: AiSettings = {
  autoTags: true,
  autoSummary: true,
  autoLinks: 'auto',
  maxAutoLinks: 3,
}

const FILE = () => path.join(MARKGRAPH_DIR, 'settings.json')

export async function loadSettings(): Promise<AiSettings> {
  try {
    return normalize(JSON.parse(await fs.readFile(FILE(), 'utf8')))
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export async function saveSettings(patch: Partial<AiSettings>): Promise<AiSettings> {
  const next = normalize({ ...(await loadSettings()), ...patch })
  await fs.mkdir(MARKGRAPH_DIR, { recursive: true })
  await fs.writeFile(FILE(), JSON.stringify(next, null, 2), 'utf8')
  return next
}

function normalize(raw: Record<string, unknown>): AiSettings {
  const s = { ...DEFAULT_SETTINGS }
  if (typeof raw.autoTags === 'boolean') s.autoTags = raw.autoTags
  if (typeof raw.autoSummary === 'boolean') s.autoSummary = raw.autoSummary
  if (raw.autoLinks === 'off' || raw.autoLinks === 'suggest' || raw.autoLinks === 'auto') {
    s.autoLinks = raw.autoLinks
  }
  if (typeof raw.maxAutoLinks === 'number' && Number.isFinite(raw.maxAutoLinks)) {
    s.maxAutoLinks = Math.min(10, Math.max(0, Math.floor(raw.maxAutoLinks)))
  }
  return s
}
