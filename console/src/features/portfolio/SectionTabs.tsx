import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '../../lib/cn'

export type ViewKey = 'overview' | 'changes' | 'spot' | 'earn' | 'perp' | 'risk'

export type TabItem = {
  key: ViewKey
  label: string
  /** 该节不可用时标出来，不必点进去才发现 */
  muted?: boolean
}

/**
 * 分节导航。做成横向、小字、无底框，靠一条会滑动的指示条建立连续感——
 * 指示条走 transform 而不是逐个元素的下边框，切换时是一条线在移动，
 * 而不是两个边框一闪一灭。这是"精致"真正落在的地方。
 */
export function SectionTabs({ items, current, onSelect }: {
  items: TabItem[]
  current: ViewKey
  onSelect: (key: ViewKey) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const [marker, setMarker] = useState<{ left: number; width: number } | null>(null)

  const measure = useCallback(() => {
    const list = listRef.current
    if (!list) return
    const active = list.querySelector<HTMLElement>('[data-active="true"]')
    if (!active) return
    setMarker({ left: active.offsetLeft, width: active.offsetWidth })
  }, [])

  useLayoutEffect(measure, [measure, current, items])

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const observer = new ResizeObserver(measure)
    observer.observe(list)
    // 字体是异步加载的，加载完成后标签宽度会变，指示条要跟着重新量
    document.fonts?.ready.then(measure).catch(() => {})
    return () => observer.disconnect()
  }, [measure])

  const move = (delta: number) => {
    const index = items.findIndex((item) => item.key === current)
    const next = items[(index + delta + items.length) % items.length]
    if (next) onSelect(next.key)
  }

  return (
    <div
      className="scrollbar-none relative overflow-x-auto border-b border-rule px-5 sm:px-10"
      onKeyDown={(event) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
        event.preventDefault()
        move(event.key === 'ArrowRight' ? 1 : -1)
      }}
      role="tablist"
    >
      <div className="relative flex w-max gap-4 sm:gap-7" ref={listRef}>
        {items.map((item) => {
          const active = current === item.key
          return (
            <button
              aria-selected={active}
              className={cn(
                'whitespace-nowrap py-3.5 text-sm transition-colors duration-200',
                active ? 'text-ink' : item.muted ? 'text-ink-3/70 hover:text-ink-3' : 'text-ink-3 hover:text-ink-2',
              )}
              data-active={active}
              key={item.key}
              onClick={() => onSelect(item.key)}
              role="tab"
              tabIndex={active ? 0 : -1}
              type="button"
            >
              {item.label}
              {item.muted && <span className="ml-1.5 text-micro text-loss">·</span>}
            </button>
          )
        })}
        {marker && (
          <span
            aria-hidden="true"
            className="absolute bottom-0 left-0 h-[1.5px] bg-ink transition-transform duration-[420ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{
              width: marker.width,
              transform: `translateX(${marker.left}px)`,
              transitionProperty: 'transform, width',
            }}
          />
        )}
      </div>
    </div>
  )
}
