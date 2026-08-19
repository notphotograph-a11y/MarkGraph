import type { NoteContent, VaultEvent, VaultNode } from './types'

async function json<T>(res: Response): Promise<T> {
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

  rename: (from: string, to: string) =>
    fetch('/api/note/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to }),
    }).then(r => json<{ path: string }>(r)),

  remove: (path: string) =>
    fetch('/api/note/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    }).then(r => json<{ ok: true }>(r)),

  importSample: () =>
    fetch('/api/import-sample', { method: 'POST' }).then(r => json<{ ok: true }>(r)),
}

let es: EventSource | null = null
const handlers = new Set<(e: VaultEvent) => void>()

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
  }
  return () => {
    handlers.delete(cb)
  }
}
