import { useEffect, useRef, type RefObject } from 'react'

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

type InertSnapshot = {
  element: HTMLElement
  inert: boolean
}

function isolateBranch(root: HTMLElement): InertSnapshot[] {
  const snapshots: InertSnapshot[] = []
  let branch: HTMLElement = root

  while (branch.parentElement) {
    const parent = branch.parentElement
    for (const sibling of Array.from(parent.children)) {
      if (sibling === branch || !(sibling instanceof HTMLElement)) continue
      snapshots.push({ element: sibling, inert: sibling.inert })
      sibling.inert = true
    }
    if (parent === document.body) break
    branch = parent
  }

  return snapshots
}

function focusableElements(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(focusableSelector))
    .filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true')
}

/**
 * Gives non-native overlays the same focus behavior as a modal dialog.
 * Prefer a native <dialog> for new overlays; this hook covers full-screen
 * readers whose existing layout cannot be represented by a top-level dialog.
 */
export function useModalFocus(
  rootRef: RefObject<HTMLElement | null>,
  active: boolean,
  onClose: () => void,
  restoreRef?: RefObject<HTMLElement | null>,
) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const root = rootRef.current
    if (!active || !root) return

    const trigger = restoreRef?.current
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    const snapshots = isolateBranch(root)
    const initial = root.querySelector<HTMLElement>('[autofocus]') ?? focusableElements(root)[0] ?? root
    if (!root.hasAttribute('tabindex')) root.tabIndex = -1
    initial.focus({ preventScroll: true })

    const handleKey = (event: KeyboardEvent) => {
      if (root.inert || !root.contains(event.target as Node)) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = focusableElements(root)
      if (!focusable.length) {
        event.preventDefault()
        root.focus({ preventScroll: true })
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('keydown', handleKey)
      snapshots.forEach(({ element, inert }) => { element.inert = inert })
      window.requestAnimationFrame(() => {
        if (trigger?.isConnected) trigger.focus({ preventScroll: true })
      })
    }
  }, [active, restoreRef, rootRef])
}
