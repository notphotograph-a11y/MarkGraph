/**
 * 改名/移动 + 全库 wikilink 改写（F23.2 / F25.3）。
 * Web（/api/note/rename）与 MCP（rename_note）两条通道共用此实现。
 */
import {
  readAllNotes,
  readNote,
  readTree,
  renameNode,
  writeNote,
  type VaultNode,
} from '../fs-vault.js'
import { buildNameIndex, collectPaths, makeResolver, rewriteLinks } from './wikilink.js'

export interface RenameResult {
  path: string
  updatedLinksIn: string[]
  skippedByConflict: string[]
}

export async function renameWithLinks(from: string, to: string, updateLinks: boolean): Promise<RenameResult> {
  if (updateLinks) {
    // 先在旧名称索引上判断谁引用了 from，再执行改名，最后逐个改写
    const tree = await readTree()
    const oldPaths = collectPaths((tree?.children ?? []) as VaultNode[])
    const oldIndex = buildNameIndex(oldPaths)
    const { notes } = await readAllNotes()
    await renameNode(from, to)
    const updated: string[] = []
    const skipped: string[] = []
    const newTarget = to.replace(/\.md$/i, '')
    for (const n of notes) {
      if (n.path === from) continue
      const resolver = makeResolver(oldIndex, n.path)
      const [next, changed] = rewriteLinks(n.content, target => (resolver(target) === from ? newTarget : null))
      if (!changed) continue
      try {
        const cur = await readNote(n.path) // 乐观：改写前文件被人工改过则跳过该文件
        if (cur.content !== n.content) {
          skipped.push(n.path)
          continue
        }
        await writeNote(n.path, next)
        updated.push(n.path)
      } catch {
        skipped.push(n.path)
      }
    }
    return { path: to, updatedLinksIn: updated, skippedByConflict: skipped }
  }
  await renameNode(from, to)
  return { path: to, updatedLinksIn: [], skippedByConflict: [] }
}
