/**
 * 设置对话框（F14）：居中弹窗 + 卡片分区（非整页）。
 * 四张卡：AI 接入（连接四项 + 测试连接）、AI 行为（开关 + 插链上限）、Agent 接入（MCP token）、外观（五主题）。
 * 快捷开关与右栏智能面板同源（同一 PUT），连接配置热生效无需重启。
 */
import { useEffect, useState } from 'react'
import { Plug, Sparkles, Palette, Bot, Trash2, NotebookPen } from 'lucide-react'
import { api } from '@/api/client'
import type { AgentScope, AgentTokenInfo, TestConnectionResult, TrashEntry, WritingSettings } from '@/api/types'
import { useStore } from '@/state/store'
import { useAiStore } from '@/state/ai'
import type { AiLinkMode } from '@/api/types'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Seg } from '@/components/ui/seg'
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
    <section className="mg-settings-card rounded-xl border border-[var(--border)] p-4">
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
          API Key（只存服务端；本地网关可留空）
          <Input
            type="password"
            value={form.apiKey}
            onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))}
            placeholder={status?.settings.ai.apiKeySet ? '留空保持不变' : 'sk-…（本地网关可留空）'}
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
  const saveError = useAiStore(s => s.saveError)
  if (!status) return null
  const s = status.settings
  return (
    <section className="mg-settings-card rounded-xl border border-[var(--border)] p-4" style={{ animationDelay: '40ms' }}>
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
          <span className="text-[13px]">单次自动插链上限（当前 {s.maxAutoLinks}）</span>
          <Seg
            value={String(s.maxAutoLinks) as '1' | '2' | '3' | '5' | '10'}
            options={[['1', '1'], ['2', '2'], ['3', '3'], ['5', '5'], ['10', '10']]}
            onChange={v => void saveSettings({ maxAutoLinks: Number(v) })}
          />
        </div>
      </div>
      {saveError && (
        <p className="mt-2 text-[11.5px] text-[var(--mg-broken)]">
          保存失败：{saveError}（请确认服务是否在运行）
        </p>
      )}
    </section>
  )
}

/** Agent 接入卡（F22.2 / v0.3.0）：MCP token 的生成/吊销；明文只在生成时展示一次 */
function AgentCard() {
  const [tokens, setTokens] = useState<AgentTokenInfo[] | null>(null)
  const [name, setName] = useState('')
  const [scope, setScope] = useState<AgentScope>('read-write')
  const [creating, setCreating] = useState(false)
  const [fresh, setFresh] = useState<{ token: string; name: string } | null>(null)
  const [flash, setFlash] = useState('')

  const refresh = () => {
    void api
      .agentsTokens()
      .then(r => setTokens(r.tokens))
      .catch(() => setTokens([]))
  }
  useEffect(refresh, [])

  const create = async () => {
    if (!name.trim()) {
      setFlash('先给 agent 起个名字')
      return
    }
    setCreating(true)
    setFlash('')
    try {
      const r = await api.agentsCreateToken(name.trim(), scope)
      setFresh({ token: r.token, name: r.name })
      setName('')
      refresh()
    } catch (err) {
      setFlash(`生成失败：${(err as Error).message}`)
    } finally {
      setCreating(false)
    }
  }

  const revoke = async (id: string, tokenName: string) => {
    try {
      await api.agentsRevokeToken(id)
      setFlash(`已吊销「${tokenName}」，使用它的 agent 立即失权`)
      refresh()
    } catch (err) {
      setFlash(`吊销失败：${(err as Error).message}`)
    }
  }

  return (
    <section className="mg-settings-card rounded-xl border border-[var(--border)] p-4" style={{ animationDelay: '60ms' }}>
      <CardTitle icon={<Bot className="h-3.5 w-3.5" />}>Agent 接入（MCP）</CardTitle>
      <p className="mt-1 text-[11.5px] leading-4 text-[var(--muted-foreground)]">
        把笔记库开放给外部 AI agent（Claude Code / ZCode / Cursor 等）：地址为同源 <code>/mcp</code>（Streamable
        HTTP），鉴权用 Bearer Token。token 只在生成时显示一次；删除一律进回收站，全程审计。
      </p>
      {fresh && (
        <div className="mt-2 rounded-lg bg-[var(--secondary)] px-3 py-2 text-[11.5px] leading-5">
          <div className="font-medium">「{fresh.name}」的 Token（只显示这一次，请立即复制）：</div>
          <code className="mt-1 block break-all text-[var(--mg-link)]">{fresh.token}</code>
          <div className="mt-1 text-[var(--muted-foreground)]">
            agent 配置示例：streamableHttp 指向本站 /mcp，Authorization 头带此 token
          </div>
        </div>
      )}
      <div className="mt-3 flex items-end gap-2">
        <label className="grid flex-1 gap-1 text-[11.5px] text-[var(--muted-foreground)]">
          名字（如「ZCode on MacBook」）
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="agent 标识" spellCheck={false} />
        </label>
        <div className="pb-0.5">
          <Seg
            value={scope}
            options={[['read', '只读'], ['read-write', '读写']] as [AgentScope, string][]}
            onChange={setScope}
          />
        </div>
        <Button size="sm" onClick={() => void create()} disabled={creating}>
          {creating ? '生成中…' : '生成'}
        </Button>
      </div>
      {tokens && tokens.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {tokens.map(t => (
            <li key={t.id} className="flex items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2 text-[12px]">
              <div className="min-w-0">
                <span className="font-medium">{t.name}</span>
                <span className="ml-2 text-[var(--muted-foreground)]">
                  {t.scope === 'read' ? '只读' : '读写'} · …{t.fingerprint}
                </span>
              </div>
              <Button size="sm" variant="outline" onClick={() => void revoke(t.id, t.name)}>
                吊销
              </Button>
            </li>
          ))}
        </ul>
      )}
      {tokens && tokens.length === 0 && (
        <p className="mt-2 text-[11.5px] text-[var(--muted-foreground)]">还没有 token——生成第一个前 /mcp 对外一律 401。</p>
      )}
      {flash && <p className="mt-2 text-[11.5px] text-[var(--muted-foreground)]">{flash}</p>}
    </section>
  )
}

/** 回收站卡（F25.2）：列出/恢复/彻底清除；与 MCP 通道共享存储，保留 200 条或 30 天 */
function TrashCard() {
  const [entries, setEntries] = useState<TrashEntry[] | null>(null)
  const [flash, setFlash] = useState('')
  const refreshTree = useStore(s => s.refreshTree)

  const refresh = () => {
    void api
      .trashList()
      .then(r => setEntries([...r.entries].reverse())) // 最新删除的在前
      .catch(() => setEntries([]))
  }
  useEffect(refresh, [])

  const restore = async (e: TrashEntry) => {
    setFlash('')
    try {
      const r = await api.trashRestore(e.id)
      setFlash(`已恢复到 ${r.path}`)
      await refreshTree()
      refresh()
    } catch (err) {
      setFlash(`恢复失败：${(err as Error).message}`)
    }
  }

  const purge = async (e: TrashEntry) => {
    setFlash('')
    try {
      await api.trashPurge(e.id)
      setFlash(`已彻底清除「${e.path}」，不可恢复`)
      refresh()
    } catch (err) {
      setFlash(`清除失败：${(err as Error).message}`)
    }
  }

  return (
    <section className="mg-settings-card rounded-xl border border-[var(--border)] p-4" style={{ animationDelay: '100ms' }}>
      <CardTitle icon={<Trash2 className="h-3.5 w-3.5" />}>回收站</CardTitle>
      <p className="mt-1 text-[11.5px] leading-4 text-[var(--muted-foreground)]">
        删除的笔记都在这里（保留 200 条或 30 天，与外部 agent 通道共用）。
      </p>
      {entries && entries.length === 0 && (
        <p className="mt-2 text-[11.5px] text-[var(--muted-foreground)]">回收站是空的。</p>
      )}
      {entries && entries.length > 0 && (
        <ul className="mt-2.5 space-y-1.5">
          {entries.map(e => (
            <li key={e.id} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-[12px]">
              <div className="min-w-0">
                <button
                  className="block max-w-full truncate font-medium text-[var(--mg-link)] hover:underline"
                  title={`恢复并打开 ${e.path}`}
                  onClick={() => void restore(e)}
                >
                  {e.path}
                </button>
                <span className="text-[var(--muted-foreground)]">
                  {new Date(e.deletedAt).toLocaleString('zh-CN', { hour12: false })}
                </span>
              </div>
              <div className="flex flex-none items-center gap-1.5">
                <Button size="sm" variant="outline" onClick={() => void restore(e)}>
                  恢复
                </Button>
                <Button size="sm" variant="ghost" className="text-[var(--mg-broken)]" onClick={() => void purge(e)}>
                  彻底清除
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {flash && <p className="mt-2 text-[11.5px] text-[var(--muted-foreground)]">{flash}</p>}
    </section>
  )
}

/** 写作卡（F27.1）：模板/日记目录约定，保存后命令面板的日记与模板命令即时生效 */
function WritingCard() {
  const writing = useStore(s => s.writing)
  const refreshWriting = useStore(s => s.refreshWriting)
  const [form, setForm] = useState<WritingSettings>(writing)
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState('')

  useEffect(() => setForm(writing), [writing])

  const save = async () => {
    setSaving(true)
    setFlash('')
    try {
      await api.writingSave({
        templatesDir: form.templatesDir.trim(),
        diaryDir: form.diaryDir.trim(),
        diaryTemplate: form.diaryTemplate.trim(),
      })
      await refreshWriting()
      setFlash('已保存')
    } catch (err) {
      setFlash(`保存失败：${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  const field = (key: keyof WritingSettings, label: string, placeholder: string) => (
    <label className="grid gap-1 text-[11.5px] text-[var(--muted-foreground)]">
      {label}
      <Input
        value={form[key]}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        placeholder={placeholder}
        spellCheck={false}
      />
    </label>
  )

  return (
    <section className="mg-settings-card rounded-xl border border-[var(--border)] p-4" style={{ animationDelay: '90ms' }}>
      <CardTitle icon={<NotebookPen className="h-3.5 w-3.5" />}>写作</CardTitle>
      <p className="mt-1 text-[11.5px] leading-4 text-[var(--muted-foreground)]">
        「新建今日日记」按日期写入日记文件夹（套用日记模板）；空笔记可通过命令面板「插入模板」套用模板文件夹中的模板。
      </p>
      <div className="mt-3 grid grid-cols-1 gap-2.5">
        {field('templatesDir', '模板文件夹', '模板')}
        {field('diaryDir', '日记文件夹', '日记')}
        {field('diaryTemplate', '日记模板', '模板/日记.md')}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" onClick={() => void save()} disabled={saving}>
          {saving ? '保存中…' : '保存'}
        </Button>
        {flash && <span className="text-[11.5px] text-[var(--muted-foreground)]">{flash}</span>}
      </div>
    </section>
  )
}

/** 外观卡：五主题（与命令面板同源） */
function AppearanceCard() {
  const theme = useStore(s => s.theme)
  const setTheme = useStore(s => s.setTheme)
  return (
    <section className="mg-settings-card rounded-xl border border-[var(--border)] p-4" style={{ animationDelay: '80ms' }}>
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
      <DialogContent className="max-h-[85vh] gap-0 overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
        </DialogHeader>
        <div className="mt-2 space-y-3">
          <ConnectionCard />
          <BehaviorCard />
          <AgentCard />
          <TrashCard />
          <WritingCard />
          <AppearanceCard />
        </div>
        <p className="mt-3 text-center text-[11px] text-[var(--muted-foreground)]">
          HOST / PORT / VAULT_DIR 属部署配置，请在服务端 .env 中设置
        </p>
      </DialogContent>
    </Dialog>
  )
}
