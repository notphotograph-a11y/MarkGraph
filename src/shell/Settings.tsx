/**
 * 设置对话框（F14）：居中弹窗 + 卡片分区（非整页）。
 * 三张卡：AI 接入（连接四项 + 测试连接）、AI 行为（开关 + 插链上限）、外观（五主题）。
 * 快捷开关与右栏智能面板同源（同一 PUT），连接配置热生效无需重启。
 */
import { useEffect, useState } from 'react'
import { Plug, Sparkles, Palette } from 'lucide-react'
import { api } from '@/api/client'
import type { TestConnectionResult } from '@/api/types'
import { useStore } from '@/state/store'
import { useAiStore } from '@/state/ai'
import type { AiLinkMode } from '@/api/types'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const THEMES: { id: 'apple' | 'paper' | 'obsidian' | 'x' | 'meta'; label: string }[] = [
  { id: 'apple', label: '玻璃' },
  { id: 'paper', label: '纸感' },
  { id: 'obsidian', label: '经典深色' },
  { id: 'x', label: '纯黑' },
  { id: 'meta', label: '卡片' },
]

function CardTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--muted-foreground)]">
      {icon}
      {children}
    </div>
  )
}

const segBtn =
  'rounded-md px-2.5 py-1 text-[12px] leading-4 transition-colors hover:bg-[var(--secondary)]'

function Seg<T extends string | boolean>({
  value,
  options,
  onChange,
}: {
  value: T
  options: [T, string][]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex gap-0.5 rounded-md bg-[var(--secondary)] p-0.5">
      {options.map(([v, label]) => (
        <button
          key={String(v)}
          type="button"
          onClick={() => onChange(v)}
          className={cn(segBtn, value === v && 'bg-[var(--background)] font-medium shadow-sm')}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/** AI 接入卡：连接表单 + 测试连接（先测后存） */
function ConnectionCard() {
  const status = useAiStore(s => s.status)
  const refreshStatus = useAiStore(s => s.refreshStatus)
  const [form, setForm] = useState({ baseUrl: '', chatModel: '', embedModel: '', apiKey: '' })
  const [origEmbed, setOrigEmbed] = useState('')
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [test, setTest] = useState<TestConnectionResult | null>(null)
  const [flash, setFlash] = useState('')
  const [embedChanged, setEmbedChanged] = useState(false)

  useEffect(() => {
    if (!status) return
    setForm({
      baseUrl: status.settings.ai.baseUrl,
      chatModel: status.settings.ai.chatModel,
      embedModel: status.settings.ai.embedModel,
      apiKey: '',
    })
    setOrigEmbed(status.settings.ai.embedModel)
    setTest(null)
    setFlash('')
    setEmbedChanged(false)
  }, [status?.settings.ai.baseUrl, status?.settings.ai.chatModel, status?.settings.ai.embedModel])

  const conn = () => ({
    baseUrl: form.baseUrl.trim(),
    chatModel: form.chatModel.trim(),
    embedModel: form.embedModel.trim(),
    ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
  })

  const runTest = async () => {
    setTesting(true)
    setTest(null)
    try {
      setTest(await api.aiTestConnection(conn()))
    } catch (err) {
      setTest({ reachable: false, embedOk: false, chatOk: false, error: (err as Error).message })
    } finally {
      setTesting(false)
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      await api.aiSaveSettings({ ai: conn() })
      setEmbedChanged(form.embedModel.trim() !== origEmbed && !!form.embedModel.trim())
      setFlash('已保存')
      setForm(f => ({ ...f, apiKey: '' }))
      await refreshStatus()
    } catch (err) {
      setFlash(`保存失败：${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-xl border border-[var(--border)] p-4">
      <CardTitle icon={<Plug className="h-3.5 w-3.5" />}>AI 接入</CardTitle>
      <p className="mt-1 text-[11.5px] leading-4 text-[var(--muted-foreground)]">
        OpenAI 兼容接口（newAPI 等网关）。此处配置优先于 .env，保存后即时生效。
        {status?.settings.ai.apiKeySet && (
          <> 密钥已保存（{status.settings.ai.apiKeyMasked}），留空即保持不变。</>
        )}
      </p>
      <div className="mt-3 grid grid-cols-1 gap-2.5">
        <label className="grid gap-1 text-[11.5px] text-[var(--muted-foreground)]">
          网关地址（Base URL）
          <Input
            value={form.baseUrl}
            onChange={e => setForm(f => ({ ...f, baseUrl: e.target.value }))}
            placeholder="https://your-gateway.example.com/v1"
            spellCheck={false}
          />
        </label>
        <div className="grid grid-cols-2 gap-2.5">
          <label className="grid gap-1 text-[11.5px] text-[var(--muted-foreground)]">
            Chat 模型
            <Input
              value={form.chatModel}
              onChange={e => setForm(f => ({ ...f, chatModel: e.target.value }))}
              placeholder="glm-4.7"
              spellCheck={false}
            />
          </label>
          <label className="grid gap-1 text-[11.5px] text-[var(--muted-foreground)]">
            Embedding 模型
            <Input
              value={form.embedModel}
              onChange={e => setForm(f => ({ ...f, embedModel: e.target.value }))}
              placeholder="embedding-3"
              spellCheck={false}
            />
          </label>
        </div>
        <label className="grid gap-1 text-[11.5px] text-[var(--muted-foreground)]">
          API Key（只存服务端）
          <Input
            type="password"
            value={form.apiKey}
            onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))}
            placeholder={status?.settings.ai.apiKeySet ? '留空保持不变' : 'sk-…'}
            spellCheck={false}
          />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => void runTest()} disabled={testing}>
          {testing ? '测试中…' : '测试连接'}
        </Button>
        <Button size="sm" onClick={() => void save()} disabled={saving}>
          {saving ? '保存中…' : '保存'}
        </Button>
        {flash && <span className="text-[11.5px] text-[var(--muted-foreground)]">{flash}</span>}
      </div>
      {test && (
        <div className="mt-2 rounded-lg bg-[var(--secondary)] px-3 py-2 text-[11.5px] leading-5">
          <div>
            向量接口：{test.embedOk ? '✓ 正常' : '✗ 失败'} · Chat 模型：{test.chatOk ? '✓ 正常' : '✗ 失败'}
          </div>
          {test.error && <div className="text-[var(--mg-broken)]">{test.error}</div>}
        </div>
      )}
      {embedChanged && (
        <p className="mt-2 text-[11.5px] text-[var(--mg-broken)]">
          Embedding 模型已变更：旧向量不兼容，请在「智能」面板执行一次「全库生成」重建索引。
        </p>
      )}
    </section>
  )
}

/** AI 行为卡：与智能面板同源的开关 + 插链上限 */
function BehaviorCard() {
  const status = useAiStore(s => s.status)
  const saveSettings = useAiStore(s => s.saveSettings)
  if (!status) return null
  const s = status.settings
  return (
    <section className="rounded-xl border border-[var(--border)] p-4">
      <CardTitle icon={<Sparkles className="h-3.5 w-3.5" />}>AI 行为</CardTitle>
      <div className="mt-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[13px]">自动标签（写 frontmatter）</span>
          <Seg value={s.autoTags} options={[[true, '开'], [false, '关']]} onChange={v => void saveSettings({ autoTags: v })} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[13px]">自动摘要（写 frontmatter）</span>
          <Seg value={s.autoSummary} options={[[true, '开'], [false, '关']]} onChange={v => void saveSettings({ autoSummary: v })} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[13px]">自动连接（插入双链）</span>
          <Seg
            value={s.autoLinks}
            options={[['auto', '全自动'], ['suggest', '仅建议'], ['off', '关']] as [AiLinkMode, string][]}
            onChange={v => void saveSettings({ autoLinks: v })}
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[13px]">单次自动插链上限</span>
          <Seg
            value={String(s.maxAutoLinks) as '1' | '2' | '3' | '5' | '10'}
            options={[['1', '1'], ['2', '2'], ['3', '3'], ['5', '5'], ['10', '10']]}
            onChange={v => void saveSettings({ maxAutoLinks: Number(v) })}
          />
        </div>
      </div>
    </section>
  )
}

/** 外观卡：五主题（与命令面板同源） */
function AppearanceCard() {
  const theme = useStore(s => s.theme)
  const setTheme = useStore(s => s.setTheme)
  return (
    <section className="rounded-xl border border-[var(--border)] p-4">
      <CardTitle icon={<Palette className="h-3.5 w-3.5" />}>外观</CardTitle>
      <div className="mt-3 grid grid-cols-5 gap-1.5">
        {THEMES.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTheme(t.id)}
            className={cn(
              'rounded-lg border px-2 py-2.5 text-[12px]',
              theme === t.id
                ? 'border-[var(--primary)] bg-[var(--secondary)] font-medium text-[var(--foreground)]'
                : 'border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--secondary)]',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
    </section>
  )
}

export function SettingsDialog() {
  const open = useStore(s => s.settingsOpen)
  const setOpen = useStore(s => s.setSettingsOpen)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="mg-fade-in max-h-[85vh] gap-0 overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
        </DialogHeader>
        <div className="mt-2 space-y-3">
          <ConnectionCard />
          <BehaviorCard />
          <AppearanceCard />
        </div>
        <p className="mt-3 text-center text-[11px] text-[var(--muted-foreground)]">
          HOST / PORT / VAULT_DIR 属部署配置，请在服务端 .env 中设置
        </p>
      </DialogContent>
    </Dialog>
  )
}
