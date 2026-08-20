/**
 * 命令注册表（F5.3 / F8.3）。
 * 命令面板与后续快捷键共用同一份定义。
 */
import { api } from '@/api/client'
import type { ThemeId } from '@/api/types'
import { useStore } from '@/state/store'
import { useAiStore } from '@/state/ai'
import { bus } from './bus'

export interface Command {
  id: string
  title: string
  keywords: string
  run: () => void | Promise<void>
}

const THEMES: { id: ThemeId; label: string }[] = [
  { id: 'apple', label: '玻璃' },
  { id: 'paper', label: '纸感' },
  { id: 'obsidian', label: '经典深色' },
  { id: 'x', label: '纯黑' },
  { id: 'meta', label: '卡片' },
]

export function listCommands(): Command[] {
  const s = useStore.getState()
  const empty = !s.tree?.children?.length
  const cmds: Command[] = [
    {
      id: 'new-note',
      title: '新建笔记',
      keywords: 'new note 新建',
      run: () => bus.emit('ui:new-note', ''),
    },
    {
      id: 'open-graph',
      title: '打开图谱',
      keywords: 'graph 图谱 关系',
      run: () => s.openGraph(),
    },
    {
      id: 'open-chat',
      title: '打开问答',
      keywords: 'chat ask 问答 提问 rag',
      run: () => s.openChat(),
    },
    {
      id: 'toggle-mode',
      title: '切换编辑/阅读模式',
      keywords: 'edit read 编辑 阅读',
      run: () => {
        const cur = useStore.getState()
        if (!cur.tabs.some(t => t.kind === 'note')) return
        cur.toggleEditMode()
      },
    },
    ...THEMES.map(t => ({
      id: `theme-${t.id}`,
      title: `切换主题 · ${t.label}`,
      keywords: `theme ${t.id} ${t.label} 主题`,
      run: () => s.setTheme(t.id),
    })),
    {
      id: 'close-tab',
      title: '关闭当前标签',
      keywords: 'close tab 关闭',
      run: () => s.closeActiveTab(),
    },
  ]
  if (empty) {
    cmds.push({
      id: 'import-sample',
      title: '导入示例库',
      keywords: 'import sample 示例 导入',
      run: async () => {
        await api.importSample()
        await s.refreshTree()
      },
    })
  }
  // AI 命令（F10.4）：已配置才出现
  if (useAiStore.getState().status?.configured) {
    cmds.push(
      {
        id: 'ai-enrich-note',
        title: 'AI：为当前笔记生成标签/摘要/链接',
        keywords: 'ai enrich 生成 标签 摘要 链接',
        run: () => {
          const cur = useStore.getState()
          const tab = cur.activeIndex >= 0 ? cur.tabs[cur.activeIndex] : null
          const p = tab?.kind === 'note' ? tab.path : null
          if (p) void useAiStore.getState().enrichNow(p)
        },
      },
      {
        id: 'ai-enrich-all',
        title: 'AI：为全库生成索引',
        keywords: 'ai enrich all 全库 索引 向量',
        run: () => void useAiStore.getState().enrichAll(),
      },
    )
  }
  return cmds
}
