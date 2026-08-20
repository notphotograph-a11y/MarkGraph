/**
 * 文件夹页（F15）：虚拟视图，不创建物理文件——vault 保持纯 .md。
 * 聚合该文件夹的子文件夹与子笔记（AI 摘要 / 标签 / 被引数），数据全部来自
 * 现有内容池与索引；点击笔记进入，点击子文件夹继续下钻。
 */
import { useMemo } from 'react'
import { Folder, FolderOpen } from 'lucide-react'
import type { VaultNode } from '@/api/types'
import { useStore } from '@/state/store'
import { fmSummary, fmTags, splitFrontmatter } from '@/lib/frontmatter'

function findNode(root: VaultNode | null, path: string): VaultNode | null {
  if (!root) return null
  if (root.path === path) return root
  for (const c of root.children ?? []) {
    const hit = findNode(c, path)
    if (hit) return hit
  }
  return null
}

function NoteCard({ path, name }: { path: string; name: string }) {
  const content = useStore(s => s.contents[path])
  const backlinks = useStore(s => s.index?.backlinks.get(path)?.length ?? 0)
  const openNote = useStore(s => s.openNote)

  const { summary, tags } = useMemo(() => {
    const { fm } = splitFrontmatter(content ?? '')
    return { summary: fmSummary(fm), tags: fmTags(fm) }
  }, [content])

  return (
    <button
      type="button"
      onClick={() => void openNote(path)}
      className="mg-fade-in block w-full rounded-xl border border-[var(--border)] p-4 text-left hover:bg-[var(--secondary)]"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[15px] font-semibold text-[var(--mg-link)]">{name}</span>
        <span className="flex-none text-[11px] text-[var(--muted-foreground)]">
          被引 {backlinks}
        </span>
      </div>
      {summary && (
        <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-5 text-[var(--muted-foreground)]">
          {summary}
        </p>
      )}
      {tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {tags.map(t => (
            <span
              key={t}
              className="rounded-full bg-[var(--secondary)] px-2 py-0.5 text-[11px] text-[var(--muted-foreground)]"
            >
              #{t}
            </span>
          ))}
        </div>
      )}
    </button>
  )
}

export function FolderView({ path }: { path: string }) {
  const tree = useStore(s => s.tree)
  const openFolder = useStore(s => s.openFolder)

  const node = useMemo(() => findNode(tree, path), [tree, path])

  if (!node || node.type !== 'dir') {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-[var(--muted-foreground)]">
        这个文件夹不存在了（可能已被删除或改名）。
      </div>
    )
  }

  const dirs = (node.children ?? []).filter(c => c.type === 'dir')
  const files = (node.children ?? []).filter(c => c.type === 'file')

  return (
    <div className="mg-fade-in min-h-0 flex-1 overflow-y-auto px-10 py-8">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center gap-2.5">
          <FolderOpen className="h-5 w-5 text-[var(--primary)]" />
          <h1 className="text-[24px] font-bold tracking-tight">{node.name}</h1>
        </div>
        <p className="mt-1.5 text-[12.5px] text-[var(--muted-foreground)]">
          {files.length} 篇笔记{dirs.length > 0 ? ` · ${dirs.length} 个子文件夹` : ''} · {path}
        </p>

        {dirs.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-2">
            {dirs.map(d => (
              <button
                key={d.path}
                type="button"
                onClick={() => openFolder(d.path)}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-[13px] hover:bg-[var(--secondary)]"
              >
                <Folder className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                {d.name}
              </button>
            ))}
          </div>
        )}

        {files.length > 0 ? (
          <div className="mt-6 grid grid-cols-1 gap-2.5 md:grid-cols-2">
            {files.map(f => (
              <NoteCard key={f.path} path={f.path} name={f.name.replace(/\.md$/i, '')} />
            ))}
          </div>
        ) : (
          <p className="mt-10 text-center text-sm text-[var(--muted-foreground)]">
            这个文件夹还没有笔记——在左侧右键文件夹新建一篇。
          </p>
        )}
      </div>
    </div>
  )
}
