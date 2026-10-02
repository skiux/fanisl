import { useLayoutEffect, useRef, useState } from 'react'

/** Keep a desktop list above the floating navigation without fixing its height on mobile. */
export function useViewportListHeight() {
  const ref = useRef<HTMLUListElement>(null)
  const [height, setHeight] = useState<number | null>(null)

  useLayoutEffect(() => {
    const list = ref.current
    if (!list) return
    const scroller = list.parentElement?.closest<HTMLElement>('.scroll-y')
    const nav = document.querySelector<HTMLElement>('[aria-label="资产主导航"]')
    const measure = () => {
      if (!window.matchMedia?.('(min-width: 1024px)').matches) {
        setHeight(null)
        return
      }
      const bottom = Math.min(scroller?.getBoundingClientRect().bottom ?? innerHeight,
        nav?.getBoundingClientRect().top ?? innerHeight)
      // Adding the outer scroll position keeps the limit stable if the user scrolls
      // down to the smaller account sections below these lists.
      const top = list.getBoundingClientRect().top + (scroller?.scrollTop ?? 0)
      const next = Math.max(120, Math.floor(bottom - top - 16))
      setHeight((current) => current === next ? current : next)
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    if (scroller) observer?.observe(scroller)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  })

  return { ref, height }
}
