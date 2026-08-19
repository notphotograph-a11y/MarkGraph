/**
 * 右栏面板：反向链接 + 大纲（F3）。
 * 数据同源：反链来自全库索引（indexer），大纲来自当前笔记内容实时解析；
 * 点击反链跳来源笔记，点击大纲条目经事件总线定位到正文。
 */
import { useMemo } from 'react'
import { useStore } from '@/state/store'
import { bus } from '@/shell/bus'
import { parseOutline, type OutlineTarget } from '@/graph/indexer'
import { registerPanel } from './registry'

/** 当前激活笔记路径（非笔记 tab 时为 null） */
function useActiveNotePath(): string | null {
  const tabs = useStore(s => s.tabs)
  const activeIndex = useStore(s => s.activeIndex)
  const tab = activeIndex >= 0 ? tabs[activeIndex] : null
  return tab?.kind === 'note' ? tab.path : null
}

/** 同名笔记带路径区分显示（与标签页规则一致，F2.8） */
function displayName(path: string, allPaths: string[]): string {
  const base = path.split('/').pop()!.replace(/\.md$/i, '')
  const dup = allPaths.filter(p => p.split('/').pop()?.replace(/\.md$/i, '') === base)
  return dup.length > 1 ? path : base
}

function PanelEmpty({ text }: { text: string }) {
  return <p className="px-1 py-2 text-xs leading-5 text-[var(--muted-foreground)]">{text}</p>
}

function BacklinksPanel() {
  const path = useActiveNotePath()
  const index = useStore(s => s.index)
  const contents = useStore(s => s.contents)
  const openNote = useStore(s => s.openNote)

  const items = useMemo(
    () => (path && index ? index.backlinks.get(path) ?? [] : []),
    [path, index],
  )
  const names = useMemo(() => Object.keys(contents), [contents])

  if (!path) return <PanelEmpty text="打开一篇笔记后，这里会显示链接到它的来源。" />
  if (!items.length) return <PanelEmpty text="还没有别的笔记链接到这里。" />

  return (
    <ul className="space-y-0.5">
      {items.map(b => (
        <li key={b.from}>
          <button
            onClick={() => {
              bus.emit('link:navigate', b.from)
              void openNote(b.from)
            }}
            className="w-full rounded-md px-2 py-1.5 text-left hover:bg-[var(--secondary)]"
          >
            <span className="block truncate text-[13px] text-[var(--mg-link)]">
              {displayName(b.from, names)}
            </span>
            {b.context && (
              <p className="mt-0.5 line-clamp-2 text-[12px] leading-5 text-[var(--muted-foreground)]">
                {b.context}
              </p>
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}

function OutlinePanel() {
  const path = useActiveNotePath()
  const note = useStore(s => (path ? s.notes[path] : undefined))
  const contents = useStore(s => s.contents)

  const outline = useMemo(() => {
    const content = note?.content ?? (path ? contents[path] : '') ?? ''
    return parseOutline(content)
  }, [note, contents, path])

  if (!path) return <PanelEmpty text="打开一篇笔记后，这里会显示标题结构。" />
  if (!outline.length) return <PanelEmpty text="这篇笔记还没有标题（用 # 到 #### 建立）。" />

  return (
    <ul className="space-y-px">
      {outline.map((o, i) => (
        <li key={`${o.line}-${i}`}>
          <button
            onClick={() =>
              bus.emit('outline:goto', {
                path,
                level: o.level,
                text: o.text,
                line: o.line,
                index: i,
              } satisfies OutlineTarget)
            }
            className="w-full truncate rounded px-1.5 py-1 text-left text-[12.5px] leading-5 text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
            style={{ paddingLeft: 6 + (o.level - 1) * 14 }}
          >
            <span className={o.level === 1 ? 'font-medium text-[var(--foreground)]' : ''}>{o.text}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** 内置右栏面板注册（App 启动时调用一次） */
export function registerBuiltinPanels(): void {
  registerPanel({ id: 'backlinks', title: '反向链接', render: () => <BacklinksPanel /> })
  registerPanel({ id: 'outline', title: '大纲', render: () => <OutlinePanel /> })
}
