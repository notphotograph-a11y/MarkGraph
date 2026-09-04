import type {
  AgentScope,
  AgentTokenCreated,
  AgentTokenInfo,
  AiEvent,
  AiNoteView,
  AiSettings,
  AiSettingsPatch,
  AiStatus,
  ChatSource,
  NoteContent,
  SerializedIndex,
  TestConnectionResult,
  TrashEntry,
  VaultEvent,
  VaultNode,
  WritingSettings,
} from './types'

const authListeners = new Set<() => void>()

export function onUnauthorized(cb: () => void): () => void {
  authListeners.add(cb)
  return () => {
    authListeners.delete(cb)
  }
}

function notifyUnauthorized() {
  authListeners.forEach(cb => cb())
}

async function json<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    closeEvents()
    notifyUnauthorized()
  }
  if (!res.ok) {
    let msg = `${res.status}`
    try {
      const body = await res.json()
      if (body?.error) msg = body.error
    } catch { /* ignore */ }
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

export const api = {
  tree: () => fetch('/api/tree').then(r => json<{ tree: VaultNode }>(r)),

  note: (path: string) =>
    fetch(`/api/note?path=${encodeURIComponent(path)}`).then(r => json<NoteContent>(r)),

  notes: () =>
    fetch('/api/notes').then(r => json<{ notes: { path: string; content: string }[] }>(r)),

  /** 链接索引（F23.1）：服务端构建，与 MCP 同源 */
  index: () => fetch('/api/index').then(r => json<SerializedIndex>(r)),

  save: (path: string, content: string) =>
    fetch('/api/note', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, content }),
    }).then(r => json<{ mtime: number }>(r)),

  create: (path: string, isDir = false) =>
    fetch('/api/note/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, isDir }),
    }).then(r => json<{ path: string }>(r)),

  rename: (from: string, to: string, updateLinks = true) =>
    fetch('/api/note/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, updateLinks }),
    }).then(r => json<{ path: string; updatedLinksIn: string[]; skippedByConflict: string[] }>(r)),

  remove: (path: string) =>
    fetch('/api/note/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    }).then(r => json<{ ok: true; trashId: string }>(r)),

  trashList: () =>
    fetch('/api/trash').then(r => json<{ entries: TrashEntry[] }>(r)),

  trashRestore: (id: string) =>
    fetch('/api/trash/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).then(r => json<{ path: string }>(r)),

  trashPurge: (id: string) =>
    fetch('/api/trash/purge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).then(r => json<{ ok: true }>(r)),

  writingGet: () =>
    fetch('/api/settings/writing').then(r => json<{ writing: WritingSettings }>(r)),

  writingSave: (writing: Partial<WritingSettings>) =>
    fetch('/api/settings/writing', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ writing }),
    }).then(r => json<{ writing: WritingSettings }>(r)),

  importSample: () =>
    fetch('/api/import-sample', { method: 'POST' }).then(r => json<{ ok: true }>(r)),

  authStatus: () =>
    fetch('/api/auth/status').then(r => json<{ required: boolean; loggedIn: boolean }>(r)),

  login: (password: string) =>
    fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    }).then(r => json<{ ok: true }>(r)),

  logout: () => fetch('/api/auth/logout', { method: 'POST' }).then(r => json<{ ok: true }>(r)),

  upload: (file: File) => {
    const body = new FormData()
    body.append('file', file, file.name)
    return fetch('/api/file', { method: 'POST', body }).then(r => json<{ path: string }>(r))
  },

  fileUrl: (rel: string) => `/api/file?path=${encodeURIComponent(rel)}`,

  /* ============ AI 富集（Phase 2） ============ */

  aiStatus: () => fetch('/api/ai/status').then(r => json<AiStatus>(r)),

  aiNote: (path: string) =>
    fetch(`/api/ai/notes?path=${encodeURIComponent(path)}`).then(r => json<AiNoteView>(r)),

  aiEnrich: (path: string) =>
    fetch('/api/ai/enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    }).then(r => json<{ ok: true }>(r)),

  aiEnrichAll: () =>
    fetch('/api/ai/enrich-all', { method: 'POST' }).then(r => json<{ ok: true; total: number }>(r)),

  aiApply: (path: string, target: string, anchor: string) =>
    fetch('/api/ai/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, target, anchor }),
    }).then(r => json<{ ok: true }>(r)),

  aiUndo: (path: string) =>
    fetch('/api/ai/undo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    }).then(r => json<{ ok: true }>(r)),

  aiSaveSettings: (patch: AiSettingsPatch) =>
    fetch('/api/ai/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(r => json<AiSettings>(r)),

  aiSearch: (q: string) =>
    fetch('/api/ai/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q }),
    }).then(r => json<{ results: { path: string; score: number }[] }>(r)),

  aiHasIndex: () => fetch('/api/ai/has-index').then(r => json<{ indexed: boolean }>(r)),

  /* ============ Agent 接入（F22.2 / v0.3.0） ============ */

  agentsTokens: () => fetch('/api/agents/tokens').then(r => json<{ tokens: AgentTokenInfo[] }>(r)),

  agentsCreateToken: (name: string, scope: AgentScope) =>
    fetch('/api/agents/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, scope }),
    }).then(r => json<AgentTokenCreated>(r)),

  agentsRevokeToken: (id: string) =>
    fetch(`/api/agents/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(r => json<{ ok: true }>(r)),

  /** 测试连接（F14.2）：传入值 → 已存值 → .env 逐级回退，可先测后存 */
  aiTestConnection: (conn: AiSettingsPatch['ai']) =>
    fetch('/api/ai/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(conn ?? {}),
    }).then(r => json<TestConnectionResult>(r)),

  /** RAG 问答：SSE 流式（meta 来源 / delta 增量 / error 错误） */
  aiAsk: (
    q: string,
    history: { role: 'user' | 'assistant'; content: string }[],
    cbs: { onMeta: (sources: ChatSource[]) => void; onDelta: (text: string) => void },
  ) =>
    fetch('/api/ai/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, history }),
    }).then(async res => {
      if (!res.ok || !res.body) {
        let msg = `${res.status}`
        try {
          const b = await res.json()
          if (b?.error) msg = b.error
        } catch { /* ignore */ }
        throw new Error(msg)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const frames = buf.split('\n\n')
        buf = frames.pop() ?? ''
        for (const f of frames) {
          const ev = /event: (.+)/.exec(f)?.[1]
          const dm = /data: (.+)/s.exec(f)
          if (!ev || !dm) continue
          let j: Record<string, unknown>
          try {
            j = JSON.parse(dm[1]) as Record<string, unknown>
          } catch {
            continue
          }
          if (ev === 'meta') cbs.onMeta((j.sources as ChatSource[]) ?? [])
          else if (ev === 'delta') cbs.onDelta((j.text as string) ?? '')
          else if (ev === 'error') throw new Error((j.message as string) ?? 'AI 请求失败')
        }
      }
    }),
}

let es: EventSource | null = null
const handlers = new Set<(e: VaultEvent) => void>()
const aiHandlers = new Set<(e: AiEvent) => void>()

export function closeEvents(): void {
  es?.close()
  es = null
}

export function subscribeVaultEvents(cb: (e: VaultEvent) => void): () => void {
  handlers.add(cb)
  if (!es) {
    es = new EventSource('/api/events')
    for (const kind of ['change', 'add', 'unlink'] as const) {
      es.addEventListener(kind, ev => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as { path: string }
          handlers.forEach(h => h({ kind, path: data.path }))
        } catch { /* ignore */ }
      })
    }
    es.addEventListener('ai', ev => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as AiEvent
        aiHandlers.forEach(h => h(data))
      } catch { /* ignore */ }
    })
  }
  return () => {
    handlers.delete(cb)
  }
}

/** AI 富集事件（与 vault 事件共用同一条 SSE 连接） */
export function subscribeAiEvents(cb: (e: AiEvent) => void): () => void {
  aiHandlers.add(cb)
  subscribeVaultEvents(() => undefined) // 确保 EventSource 已建立
  return () => {
    aiHandlers.delete(cb)
  }
}
