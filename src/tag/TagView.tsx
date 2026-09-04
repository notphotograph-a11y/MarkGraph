/**
 * 标签筛选视图（F29.1）：虚拟视图——某标签下全部笔记的聚合卡片。
 * 数据来自共享索引 tags（frontmatter 与正文 #标签 同源）；vault 仍是纯 .md。
 * 入口：编辑/阅读/AI 面板中可点击的标签 chip。
 */
import { useMemo } from 'react'
import { Tag } from 'lucide-react'
import { useStore } from '@/state/store'
import { NoteCard } from '@/folder/FolderView'

export function TagView({ tag }: { tag: string }) {
  const paths = useStore(s => s.index?.tags.get(tag))

  const notes = useMemo(
    () =>
      (paths ?? [])
        .map(p => ({ path: p, name: p.split('/').pop()!.replace(/\.md$/i, '') }))
        .sort((a, b) => a.name.localeCompare(b.name, 'zh')),
    [paths],
  )

  return (
    <div className="mg-fade-in min-h-0 flex-1 overflow-y-auto px-10 py-8">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center gap-2.5">
          <Tag className="h-5 w-5 text-[var(--primary)]" />
          <h1 className="text-[24px] font-bold tracking-tight">#{tag}</h1>
        </div>
        <p className="mt-1.5 text-[12.5px] text-[var(--muted-foreground)]">{notes.length} 篇笔记 · 标签视图（虚拟，不产生文件）</p>

        {notes.length > 0 ? (
          <div className="mt-6 grid grid-cols-1 gap-2.5 md:grid-cols-2">
            {notes.map(n => (
              <NoteCard key={n.path} path={n.path} name={n.name} />
            ))}
          </div>
        ) : (
          <p className="mt-10 text-center text-sm text-[var(--muted-foreground)]">这个标签下没有笔记。</p>
        )}
      </div>
    </div>
  )
}
