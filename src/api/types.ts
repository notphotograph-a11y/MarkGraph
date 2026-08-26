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

/* ============ 链接索引（F23.1：服务端 /api/index 的序列化形态） ============ */

export interface IndexGraphNode {
  id: string
  name: string
  folder: string
  ghost: boolean
}

export interface IndexGraphEdge {
  source: string
  target: string
  resolved: boolean
}

export interface IndexBacklink {
  from: string
  context: string
}

export interface SerializedIndex {
  nodes: IndexGraphNode[]
  edges: IndexGraphEdge[]
  backlinks: Record<string, IndexBacklink[]>
  tags: Record<string, string[]>
  ghostTargets: Record<string, string>
}

/* ============ Agent 接入（F22.2 / v0.3.0） ============ */

export type AgentScope = 'read' | 'read-write'

export interface AgentTokenInfo {
  id: string
  name: string
  scope: AgentScope
  /** sha256 前 8 位，供辨认；完整 hash 与明文都不可见 */
  fingerprint: string
  createdAt: string
  lastUsedAt?: string
}

/** 生成结果：token 明文只出现一次 */
export interface AgentTokenCreated extends AgentTokenInfo {
  token: string
}
