import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { CaretDown } from '@phosphor-icons/react'
import { getSession, logout, subscribe } from '../api/session'
import { cn } from '../lib/cn'

const ROLE_LABEL = { admin: '管理员', member: '成员' } as const

/**
 * 账号菜单。
 *
 * 第一版是往报头右上角直接排了「用户名 · 用户 · 退出」三个文字元素——那不是设计，
 * 是把三件事塞进一个本来就排满的行里。报头那一行已经有场景开关、区间开关、
 * 知识库入口、主题切换，再加三个就挤到裁字。
 *
 * 现在收成**一个入口**：名字是触发器，点开才是账号、用户管理、退出。
 * 一个槽位换三个，而且"账号"这件事有了自己的地方，不再是几个孤立的链接。
 */
export function AccountMenu() {
  const session = useSyncExternalStore(subscribe, getSession)
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      trigger.current?.focus()          // 焦点回到触发器，键盘用户不会掉进虚空
    }
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  if (session.status !== 'authenticated') return null
  const { user } = session

  const item = cn(
    'block w-full px-3 py-2 text-left text-xs text-ink-2',
    'transition-colors duration-150 hover:bg-sheet-2 hover:text-ink',
  )

  return (
    <div className="relative" ref={root}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          'flex items-center gap-1.5 whitespace-nowrap text-xs',
          'transition-colors duration-200',
          open ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
        )}
        onClick={() => setOpen((value) => !value)}
        ref={trigger}
        type="button"
      >
        {user.display_name || user.username}
        <CaretDown
          aria-hidden="true"
          className={cn('transition-transform duration-200', open && 'rotate-180')}
          size={10}
        />
      </button>

      {open && (
        <div
          className={cn(
            'absolute right-0 top-[calc(100%+8px)] z-50 w-[184px]',
            'border border-rule bg-sheet shadow-[var(--sheet-shadow)]',
          )}
          role="menu"
        >
          <div className="border-b border-rule px-3 py-2.5">
            <div className="truncate text-xs text-ink">{user.display_name || user.username}</div>
            <div className="mt-0.5 truncate text-micro text-ink-3">
              {ROLE_LABEL[user.role]} · {user.username}
            </div>
          </div>

          <a className={item} href="#/account" onClick={() => setOpen(false)} role="menuitem">
            账号
          </a>
          {user.role === 'admin' && (
            <a className={item} href="#/admin" onClick={() => setOpen(false)} role="menuitem">
              用户管理
            </a>
          )}

          <div className="border-t border-rule">
            <button
              className={item}
              onClick={() => {
                setOpen(false)
                // 退出失败时服务端会话仍然活着。不假装已退出——刷新一次，
                // 让 /auth/me 说真话。
                logout().catch(() => window.location.reload())
              }}
              role="menuitem"
              type="button"
            >
              退出
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
