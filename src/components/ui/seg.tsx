/**
 * 分段选择器（iOS 式滑块）：激活态滑块用 transform 平移（GPU），时长/曲线走主题动效 token。
 * 设置对话框与智能面板共用，保证两处开关手感一致。
 */
import { cn } from '@/lib/utils'

export function Seg<T extends string | boolean>({
  value,
  options,
  onChange,
  className,
}: {
  value: T
  options: [T, string][]
  onChange: (v: T) => void
  className?: string
}) {
  const activeIndex = options.findIndex(([v]) => v === value)
  return (
    <div className={cn('relative flex rounded-md bg-[var(--secondary)] p-0.5', className)}>
      {activeIndex >= 0 && (
        <i
          aria-hidden
          className="pointer-events-none absolute inset-y-0.5 left-0.5 rounded-md bg-[var(--background)] shadow-sm"
          style={{
            width: `calc((100% - 0.25rem) / ${options.length})`,
            transform: `translateX(${activeIndex} * 100%)`,
            transition: 'transform var(--mg-dur-hover) var(--mg-ease-pop)',
          }}
        />
      )}
      {options.map(([v, label]) => (
        <button
          key={String(v)}
          type="button"
          onClick={() => onChange(v)}
          className={cn(
            'relative z-10 flex-1 whitespace-nowrap rounded-md px-2.5 py-1 text-[12px] leading-4',
            'transition-colors hover:bg-[var(--secondary)]',
            value === v ? 'font-medium text-[var(--foreground)]' : 'text-[var(--muted-foreground)]',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
