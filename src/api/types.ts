export interface VaultNode {
  type: 'dir' | 'file'
  name: string
  path: string
  children?: VaultNode[]
}

export interface NoteContent {
  content: string
  mtime: number
}

export type VaultEventKind = 'change' | 'add' | 'unlink'
export interface VaultEvent {
  kind: VaultEventKind
  path: string
}

export type ThemeId = 'apple' | 'paper' | 'obsidian' | 'x' | 'meta'

/* ============ Phase 2：AI 富集 ============ */

export type AiLinkMode = 'off' | 'suggest' | 'auto'

/** 设置的对外形状：key 只给掩码（N11.1），完整值永不出服务端 */
export interface AiSettings {
  autoTags: boolean
  autoSummary: boolean
  autoLinks: AiLinkMode
  maxAutoLinks: number
  ai: {
    baseUrl: string
    chatModel: string
    embedModel: string
    apiKeyMasked: string
    apiKeySet: boolean
  }
}

/** PUT 载荷：ai.apiKey 留空 = 保持原值 */
export interface AiSettingsPatch {
  autoTags?: boolean
  autoSummary?: boolean
  autoLinks?: AiLinkMode
  maxAutoLinks?: number
  ai?: { baseUrl?: string; apiKey?: string; chatModel?: string; embedModel?: string }
}

export interface TestConnectionResult {
  reachable: boolean
  embedOk: boolean
  chatOk: boolean
  error: string
}

export interface AiStatus {
  configured: boolean
  chatModel: string
  embedModel: string
  running: boolean
  queued: number
  settings: AiSettings
}

export interface AiSuggestion {
  target: string
  reason: string
  anchor: string
  applied: boolean
  /** 服务端按当前文件树解析出的目标路径（空 = 目标已不存在） */
  targetPath: string
}

export interface AiNoteView {
  summary: string
  tags: string[]
  related: { path: string; score: number }[]
  suggestions: AiSuggestion[]
  enrichedAt: number | null
  indexed: boolean
  canUndo: boolean
}

/** SSE `event: ai` 载荷 */
export type AiEvent =
  | { type: 'note'; path: string }
  | { type: 'progress'; done: number; total: number }
  | { type: 'settings'; settings: AiSettings }

/* ============ Phase 3：RAG 问答 ============ */

export interface ChatSource {
  path: string
  name: string
  heading: string
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
  sources?: ChatSource[]
}
