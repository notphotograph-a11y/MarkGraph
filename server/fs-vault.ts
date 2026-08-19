import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const VAULT_DIR = path.resolve(
  (process.env.VAULT_DIR ?? path.join(os.homedir(), 'MarkGraph-vault')).replace(/^~(?=$|\/)/, os.homedir()),
)

/** 解析 vault 内相对路径，拒绝路径穿越（N2） */
export function safeJoin(rel: string): string {
  const full = path.resolve(VAULT_DIR, rel)
  if (full !== VAULT_DIR && !full.startsWith(VAULT_DIR + path.sep)) {
    throw Object.assign(new Error('非法路径'), { statusCode: 400 })
  }
  return full
}

export interface VaultNode {
  type: 'dir' | 'file'
  name: string
  path: string
  children?: VaultNode[]
}

async function walk(rel: string, name: string): Promise<VaultNode | null> {
  if (name.startsWith('.')) return null
  const full = safeJoin(rel)
  const st = await fs.stat(full)
  if (st.isDirectory()) {
    const entries = await fs.readdir(full, { withFileTypes: true })
    const children: VaultNode[] = []
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name, 'zh'))) {
      if (e.name.startsWith('.')) continue
      const child = await walk(path.posix.join(rel, e.name), e.name)
      if (child) children.push(child)
    }
    // 文件夹在前
    children.sort((a, b) => (a.type === b.type ? 0 : a.type === 'dir' ? -1 : 1))
    return { type: 'dir', name, path: rel, children }
  }
  if (!e_isMarkdown(name)) return null
  return { type: 'file', name, path: rel }
}

function e_isMarkdown(name: string): boolean {
  return name.toLowerCase().endsWith('.md')
}

export async function readTree(): Promise<VaultNode | null> {
  try {
    return await walk('', '')
  } catch {
    return null
  }
}

export async function readNote(rel: string): Promise<{ content: string; mtime: number }> {
  if (!e_isMarkdown(rel)) throw Object.assign(new Error('仅支持 .md 文件'), { statusCode: 400 })
  const full = safeJoin(rel)
  const content = await fs.readFile(full, 'utf8')
  const { mtimeMs } = await fs.stat(full)
  return { content, mtime: mtimeMs }
}

export async function writeNote(rel: string, content: string): Promise<{ mtime: number }> {
  if (!e_isMarkdown(rel)) throw Object.assign(new Error('仅支持 .md 文件'), { statusCode: 400 })
  const full = safeJoin(rel)
  await fs.mkdir(path.dirname(full), { recursive: true })
  await fs.writeFile(full, content, 'utf8')
  const { mtimeMs } = await fs.stat(full)
  return { mtime: mtimeMs }
}

export async function createNode(rel: string, isDir: boolean): Promise<{ path: string }> {
  const full = safeJoin(rel)
  if (isDir) {
    await fs.mkdir(full, { recursive: false }).catch(err => {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        throw Object.assign(new Error('已存在同名项'), { statusCode: 409 })
      }
      throw err
    })
  } else {
    if (!e_isMarkdown(rel)) throw Object.assign(new Error('笔记必须以 .md 结尾'), { statusCode: 400 })
    const handle = await fs.open(full, 'wx').catch(err => {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        throw Object.assign(new Error('已存在同名笔记'), { statusCode: 409 })
      }
      throw err
    })
    await handle.close()
    await fs.writeFile(full, '', 'utf8')
  }
  return { path: rel }
}

export async function renameNode(from: string, to: string): Promise<{ path: string }> {
  if (from === to) return { path: to }
  const fullFrom = safeJoin(from)
  const fullTo = safeJoin(to)
  await fs.access(fullTo).then(
    () => {
      throw Object.assign(new Error('目标已存在'), { statusCode: 409 })
    },
    () => {
      /* 目标不存在，可改名 */
    },
  )
  await fs.mkdir(path.dirname(fullTo), { recursive: true })
  await fs.rename(fullFrom, fullTo)
  return { path: to }
}

export async function deleteNode(rel: string): Promise<{ ok: true }> {
  const full = safeJoin(rel)
  await fs.rm(full, { recursive: true, force: true })
  return { ok: true }
}

/** 批量读取全部笔记内容（前端索引器全量构建用） */
export async function readAllNotes(): Promise<{ notes: { path: string; content: string }[] }> {
  const tree = await readTree()
  const paths: string[] = []
  const collect = (n: VaultNode | null) => {
    if (!n) return
    if (n.type === 'file') paths.push(n.path)
    n.children?.forEach(collect)
  }
  collect(tree)
  const notes = await Promise.all(
    paths.map(async p => {
      const { content } = await readNote(p)
      return { path: p, content }
    }),
  )
  return { notes }
}

export async function ensureVault(): Promise<void> {
  await fs.mkdir(VAULT_DIR, { recursive: true })
}

export function isVaultEmpty(tree: VaultNode | null): boolean {
  return !tree || !tree.children || tree.children.length === 0
}
