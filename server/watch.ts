import chokidar, { type FSWatcher } from 'chokidar'
import path from 'node:path'
import { VAULT_DIR } from './fs-vault.js'

export type VaultWatcherEvent = { kind: 'change' | 'add' | 'unlink'; path: string }
type Handler = (e: VaultWatcherEvent) => void

const handlers = new Set<Handler>()
let watcher: FSWatcher | null = null

export function watchVault(): void {
  if (watcher) return
  watcher = chokidar.watch(VAULT_DIR, {
    ignored: /(^|[/\\])\./,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  })
  const toRel = (p: string) => path.relative(VAULT_DIR, p).split(path.sep).join('/')
  watcher
    .on('add', (p: string) => emit({ kind: 'add', path: toRel(p) }))
    .on('change', (p: string) => emit({ kind: 'change', path: toRel(p) }))
    .on('unlink', (p: string) => emit({ kind: 'unlink', path: toRel(p) }))
    .on('addDir', (p: string) => emit({ kind: 'add', path: toRel(p) }))
    .on('unlinkDir', (p: string) => emit({ kind: 'unlink', path: toRel(p) }))
}

function emit(e: VaultWatcherEvent): void {
  handlers.forEach(h => h(e))
}

export function onVaultEvent(h: Handler): () => void {
  handlers.add(h)
  return () => {
    handlers.delete(h)
  }
}
