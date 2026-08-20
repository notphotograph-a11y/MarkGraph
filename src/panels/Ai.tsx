/**
 * 右栏「智能」面板（Phase 2 / F10.2 / F11.2）：
 * AI 摘要与标签、相关笔记、建议链接（一键应用）、设置开关与撤销。
 * AI 未配置时显示引导文案，不影响写作流。
 */
import { useEffect } from 'react'
import { Link2, Sparkles, Undo2 } from 'lucide-react'
import { useStore } from '@/state/store'
import { useAiStore } from '@/state/ai'
import type { AiLinkMode } from '@/api/types'
import { registerPanel } from './registry'
import { Seg } from '@/components/ui/seg'

/** 当前激活笔记路径（非笔记 tab 时为 null） */
function useActiveNotePath(): string | null {
  const tabs = useStore(s => s.tabs)
  const activeIndex = useStore(s => s.activeIndex)
  const tab = activeIndex >= 0 ? tabs[activeIndex] : null
  return tab?.kind === 'note' ? tab.path : null
}

function displayName(path: string, allPaths: string[]): string {
  const base = path.split('/').pop()!.replace(/\.md$/i, '')
  const dup = allPaths.filter(p => p.split('/').pop()?.replace(/\.md$/i, '') === base)
  return dup.length > 1 ? path : base
}

function PanelEmpty({ text }: { text: string }) {
  return <p className="px-1 py-2 text-xs leading-5 text-[var(--muted-foreground)]">{text}</p>
}

/* ============ 设置 ============ */

function SettingsSection() {
  const status = useAiStore(s => s.status)
  const saveSettings = useAiStore(s => s.saveSettings)
  const saveError = useAiStore(s => s.saveError)
  if (!status) return null
  const s = status.settings

  const setLinkMode = (mode: AiLinkMode) => void saveSettings({ autoLinks: mode })

  return (
    <details className="group mb-2">
      <summary className="-mx-1 cursor-pointer list-none rounded px-1 py-1 text-[11px] font-medium text-[var(--muted-foreground)] hover:bg-[var(--secondary)]">
        自动化设置
        <span className="ml-1 inline-block transition-transform group-open:rotate-90">›</span>
      </summary>
      <div className="mt-1.5 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px]">自动标签</span>
          <Seg
            value={s.autoTags}
            options={[[true, '开'], [false, '关']]}
            onChange={v => void saveSettings({ autoTags: v })}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px]">自动摘要</span>
          <Seg
            value={s.autoSummary}
            options={[[true, '开'], [false, '关']]}
            onChange={v => void saveSettings({ autoSummary: v })}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px]">自动连接</span>
          <Seg
            value={s.autoLinks}
            options={[['auto', '全自动'], ['suggest', '仅建议'], ['off', '关']] as [AiLinkMode, string][]}
            onChange={setLinkMode}
          />
        </div>
        <p className="text-[11px] leading-4 text-[var(--muted-foreground)]">
          标签/摘要只写 frontmatter；链接以原句定位插到行末。每次 AI 写入都有备份，可撤销。
        </p>
        {saveError && (
          <p className="text-[11px] text-[var(--mg-broken)]">保存失败：{saveError}</p>
        )}
      </div>
    </details>
  )
}

/* ============ 主面板 ============ */

function AiPanel() {
  const path = useActiveNotePath()
  const openNote = useStore(s => s.openNote)
  const openChat = useStore(s => s.openChat)
  const contents = useStore(s => s.contents)
  const status = useAiStore(s => s.status)
  const view = useAiStore(s => (path ? s.views[path] : undefined))
  const progress = useAiStore(s => s.progress)
  const loadView = useAiStore(s => s.loadView)
  const enrichNow = useAiStore(s => s.enrichNow)
  const enrichAll = useAiStore(s => s.enrichAll)
  const apply = useAiStore(s => s.apply)
  const undo = useAiStore(s => s.undo)

  const configured = !!status?.configured

  useEffect(() => {
    if (path && configured) void loadView(path)
  }, [path, configured, loadView])

  if (!status) return <PanelEmpty text="AI 状态加载中…" />
  if (!configured) {
    return (
      <PanelEmpty text="AI 未配置：打开「设置」（⌘,）填网关地址与模型即可，或用服务端 .env 预配置。API Key 仅云端网关需要，本地模型（如 Ollama）可留空。" />
    )
  }

  const names = Object.keys(contents)

  return (
    <div>
      <SettingsSection />

      {!path ? (
        <PanelEmpty text="打开一篇笔记后，这里会显示 AI 摘要、相关笔记与建议链接。" />
      ) : !view ? (
        <PanelEmpty text="读取中…" />
      ) : (
        <div className="space-y-3">
          {view.summary && (
            <p className="text-[12.5px] leading-5 text-[var(--muted-foreground)]">{view.summary}</p>
          )}

          {view.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {view.tags.map(t => (
                <span
                  key={t}
                  className="rounded-full bg-[var(--secondary)] px-2 py-0.5 text-[11px] text-[var(--muted-foreground)]"
                >
                  #{t}
                </span>
              ))}
            </div>
          )}

          {view.related.length > 0 && (
            <div>
              <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-[var(--muted-foreground)]">
                <Sparkles className="h-3 w-3" /> 相关笔记
              </div>
              <ul className="space-y-0.5">
                {view.related.map(r => (
                  <li key={r.path}>
                    <button
                      onClick={() => void openNote(r.path)}
                      className="w-full truncate rounded-md px-2 py-1 text-left text-[13px] text-[var(--mg-link)] hover:bg-[var(--secondary)]"
                    >
                      {displayName(r.path, names)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {view.suggestions.filter(s => !s.applied).length > 0 && (
            <div>
              <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-[var(--muted-foreground)]">
                <Link2 className="h-3 w-3" /> 建议链接
              </div>
              <ul className="space-y-1.5">
                {view.suggestions
                  .filter(s => !s.applied)
                  .map(s => (
                    <li key={`${s.target}-${s.anchor}`} className="rounded-md bg-[var(--secondary)] p-2">
                      <button
                        onClick={() => s.targetPath && void openNote(s.targetPath)}
                        className="block truncate text-left text-[12.5px] text-[var(--mg-link)]"
                      >
                        {displayName(s.targetPath || s.target, names)}
                      </button>
                      {s.reason && (
                        <p className="mt-0.5 truncate text-[11px] text-[var(--muted-foreground)]">{s.reason}</p>
                      )}
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <p className="min-w-0 flex-1 truncate text-[11px] italic text-[var(--muted-foreground)]">
                          「{s.anchor}」
                        </p>
                        <button
                          type="button"
                          onClick={() => void apply(path, s.target, s.anchor)}
                          className="flex-none rounded-md border border-[var(--border)] px-2 py-0.5 text-[11px] hover:bg-[var(--background)]"
                        >
                          插入
                        </button>
                      </div>
                    </li>
                  ))}
              </ul>
            </div>
          )}

          <div className="flex items-center gap-2 pt-0.5">
            <button
              type="button"
              onClick={() => void enrichNow(path)}
              className="rounded-md border border-[var(--border)] px-2.5 py-1 text-[11.5px] hover:bg-[var(--secondary)]"
            >
              立即生成
            </button>
            <button
              type="button"
              onClick={() => void enrichAll()}
              className="rounded-md border border-[var(--border)] px-2.5 py-1 text-[11.5px] hover:bg-[var(--secondary)]"
            >
              全库生成
            </button>
            <button
              type="button"
              onClick={openChat}
              title="对整个笔记库提问"
              className="rounded-md border border-[var(--border)] px-2.5 py-1 text-[11.5px] hover:bg-[var(--secondary)]"
            >
              问答
            </button>
            {view.canUndo && (
              <button
                type="button"
                onClick={() => void undo(path)}
                title="撤销本篇最近一次 AI 写入"
                className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] text-[var(--muted-foreground)] hover:bg-[var(--secondary)]"
              >
                <Undo2 className="h-3 w-3" /> 撤销
              </button>
            )}
          </div>

          <p className="text-[11px] text-[var(--muted-foreground)]">
            {progress
              ? `全库生成中 ${progress.done}/${progress.total}…`
              : status.queued > 0
                ? `队列中 ${status.queued} 篇…`
                : view.enrichedAt
                  ? `上次生成 ${new Date(view.enrichedAt).toLocaleString()}`
                  : '尚未生成，保存后会自动进行'}
          </p>
        </div>
      )}
    </div>
  )
}

/** AI 面板注册（App 启动时调用一次） */
export function registerAiPanels(): void {
  registerPanel({ id: 'ai', title: '智能', render: () => <AiPanel /> })
}
