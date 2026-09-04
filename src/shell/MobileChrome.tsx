/**
 * 窄屏壳（F20）：全宽当前页 + 底栏。桌面三栏不走这里。
 */
import { useEffect, useState, type ReactNode } from 'react'
import { BookOpen, CalendarPlus, FolderTree, LogOut, MoreHorizontal, PanelRight, Search, Share2, Settings2, MessageCircle } from 'lucide-react'
import { api } from '@/api/client'
import { FileTree } from '@/panels/FileTree'
import { getPanels } from '@/panels/registry'
import { useStore } from '@/state/store'
import { cn } from '@/lib/utils'

type Drawer = 'library' | 'context' | 'more' | null

export function MobileChrome({ children }: { children: ReactNode }) {
  const [drawer, setDrawer] = useState<Drawer>(null)
  const setPaletteOpen = useStore(s => s.setPaletteOpen)
  const setEditMode = useStore(s => s.setEditMode)
  const editMode = useStore(s => s.editMode)
  const openGraph = useStore(s => s.openGraph)
  const openChat = useStore(s => s.openChat)
  const setSettingsOpen = useStore(s => s.setSettingsOpen)
  const createTodayDiary = useStore(s => s.createTodayDiary)
  const activeIndex = useStore(s => s.activeIndex)

  useEffect(() => {
    setEditMode('read')
  }, [setEditMode])

  useEffect(() => {
    setDrawer(d => (d === 'library' || d === 'context' ? null : d))
  }, [activeIndex])

  const close = () => setDrawer(null)
  const toggle = (id: Exclude<Drawer, null>) => setDrawer(d => (d === id ? null : id))

  return (
    <div className="app-root mg-narrow flex h-full flex-col p-0">
      <main className="mg-glass flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-none">
        {children}
      </main>

      {drawer && (
        <button type="button" className="mg-drawer-mask" aria-label="关闭" onClick={close} />
      )}

      {drawer === 'library' && (
        <aside className="mg-drawer mg-drawer-left mg-glass flex flex-col">
          <FileTree />
        </aside>
      )}

      {drawer === 'context' && (
        <aside className="mg-drawer mg-drawer-right mg-glass flex flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {getPanels().map((p, i) => (
              <section
                key={p.id}
                className={i === 0 ? 'border-b border-[var(--mg-panel-border)] p-3.5' : 'p-3.5'}
              >
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  {p.title}
                </h3>
                {p.render()}
              </section>
            ))}
          </div>
        </aside>
      )}

      {drawer === 'more' && (
        <aside className="mg-drawer mg-drawer-right mg-glass p-3">
          <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            更多
          </p>
          <MoreBtn
            icon={<BookOpen className="h-4 w-4" />}
            label={editMode === 'read' ? '进入编辑' : '进入阅读'}
            onClick={() => {
              setEditMode(editMode === 'read' ? 'edit' : 'read')
              close()
            }}
          />
          <MoreBtn
            icon={<CalendarPlus className="h-4 w-4" />}
            label="新建今日日记"
            onClick={() => {
              void createTodayDiary()
              close()
            }}
          />
          <MoreBtn
            icon={<Share2 className="h-4 w-4" />}
            label="打开图谱"
            onClick={() => {
              openGraph()
              close()
            }}
          />
          <MoreBtn
            icon={<MessageCircle className="h-4 w-4" />}
            label="打开问答"
            onClick={() => {
              openChat()
              close()
            }}
          />
          <MoreBtn
            icon={<Settings2 className="h-4 w-4" />}
            label="设置"
            onClick={() => {
              setSettingsOpen(true)
              close()
            }}
          />
          <MoreBtn
            icon={<LogOut className="h-4 w-4" />}
            label="退出登录"
            onClick={() => {
              void api.logout().finally(() => location.reload())
            }}
          />
        </aside>
      )}

      <nav className="mg-dock mg-glass flex flex-none rounded-none">
        <DockBtn
          icon={<FolderTree className="h-5 w-5" />}
          label="库"
          active={drawer === 'library'}
          onClick={() => toggle('library')}
        />
        <DockBtn
          icon={<Search className="h-5 w-5" />}
          label="搜索"
          onClick={() => {
            close()
            setPaletteOpen(true)
          }}
        />
        <DockBtn
          icon={<PanelRight className="h-5 w-5" />}
          label="上下文"
          active={drawer === 'context'}
          onClick={() => toggle('context')}
        />
        <DockBtn
          icon={<MoreHorizontal className="h-5 w-5" />}
          label="更多"
          active={drawer === 'more'}
          onClick={() => toggle('more')}
        />
      </nav>
    </div>
  )
}

function DockBtn({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode
  label: string
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px]',
        active ? 'text-[var(--primary)]' : 'text-[var(--muted-foreground)]',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

function MoreBtn({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[14px] hover:bg-[var(--secondary)]"
    >
      <span className="text-[var(--muted-foreground)]">{icon}</span>
      {label}
    </button>
  )
}
