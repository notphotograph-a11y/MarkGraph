import { useState } from 'react'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function LoginGate({ onOk }: { onOk: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  return (
    <div className="app-root flex h-full items-center justify-center p-6">
      <form
        className="mg-glass mg-fade-in w-full max-w-sm p-6"
        onSubmit={async e => {
          e.preventDefault()
          setBusy(true)
          setError('')
          try {
            await api.login(password)
            onOk()
          } catch (err) {
            setError((err as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      >
        <h1 className="text-[20px] font-semibold tracking-tight">MarkGraph</h1>
        <p className="mt-1.5 text-[13px] leading-6 text-[var(--muted-foreground)]">
          这个库设了访问口令。口令只存在服务端环境变量，浏览器不保存。
        </p>
        <Input
          className="mt-4"
          type="password"
          autoFocus
          autoComplete="current-password"
          placeholder="访问口令"
          value={password}
          onChange={e => setPassword(e.target.value)}
        />
        {error && <p className="mt-2 text-[12.5px] text-[var(--mg-broken)]">{error}</p>}
        <Button className="mt-4 w-full" type="submit" disabled={busy || !password}>
          {busy ? '验证中…' : '进入'}
        </Button>
      </form>
    </div>
  )
}
