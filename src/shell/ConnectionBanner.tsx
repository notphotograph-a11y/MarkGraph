/**
 * 断连提示（F24.4）：应用壳可离线打开，但笔记数据在服务器——
 * 断网或服务器不可达必须明确可见，不假装可用；恢复后自动探测并消失。
 */
import { useEffect, useState } from 'react'
import { CloudOff, WifiOff } from 'lucide-react'

type State = 'ok' | 'offline' | 'unreachable'

export function ConnectionBanner() {
  const [state, setState] = useState<State>('ok')

  useEffect(() => {
    let alive = true
    let timer: number | undefined

    const stopPoll = () => {
      if (timer !== undefined) {
        window.clearInterval(timer)
        timer = undefined
      }
    }
    const startPoll = () => {
      stopPoll()
      timer = window.setInterval(probe, 8000)
    }
    const probe = async () => {
      if (!navigator.onLine) {
        if (alive) setState('offline')
        return
      }
      try {
        const ctrl = new AbortController()
        const timeout = setTimeout(() => ctrl.abort(), 4000)
        const res = await fetch('/api/health', { cache: 'no-store', signal: ctrl.signal })
        clearTimeout(timeout)
        if (!alive) return
        if (res.ok) {
          setState('ok')
          stopPoll()
        } else {
          setState('unreachable')
          startPoll()
        }
      } catch {
        if (!alive) return
        setState('unreachable')
        startPoll()
      }
    }
    const goOffline = () => {
      setState('offline')
      startPoll()
    }
    const goOnline = () => void probe()

    void probe() // 启动探一次：壳来自 SW 缓存但服务器不可达的场景
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      alive = false
      stopPoll()
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [])

  if (state === 'ok') return null
  const offline = state === 'offline'
  return (
    <div className="mg-fade-in fixed left-1/2 top-3 z-50 -translate-x-1/2">
      <div className="mg-glass flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-[12.5px] text-[var(--foreground)] shadow-[var(--mg-shadow)]">
        {offline ? (
          <WifiOff className="h-3.5 w-3.5 flex-none text-[var(--destructive)]" />
        ) : (
          <CloudOff className="h-3.5 w-3.5 flex-none text-[var(--destructive)]" />
        )}
        {offline ? '网络连接已断开' : '无法连接服务器——检查网络或服务是否在线，恢复后自动继续'}
      </div>
    </div>
  )
}
