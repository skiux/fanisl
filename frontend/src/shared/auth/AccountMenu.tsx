import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getSession, logout, subscribe } from './session'

const ROLE_LABEL = { admin: '管理员', member: '成员' } as const

/**
 * 账号菜单。
 *
 * 第一版是往顶栏右侧直接排了「用户名 · 管理 · 退出」三个文字——那不是设计，是把三件事
 * 塞进一个本来就排满的胶囊里。`.nav-actions` 是没有 gap 的 flex，于是它顶着搜索框、
 * 用户名被裁掉。
 *
 * 现在收成**一个入口**：名字是触发器，点开才是账号、用户管理、退出。
 * 一个槽位换三个，"账号"这件事也有了自己的地方。
 */
function AccountMenu() {
  const session = useSyncExternalStore(subscribe, getSession)
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      trigger.current?.focus()      // 焦点回到触发器，键盘用户不会掉进虚空
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

  return (
    <div className="account-menu" ref={root}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="account-trigger"
        onClick={() => setOpen((value) => !value)}
        ref={trigger}
        type="button"
      >
        <span>{user.display_name || user.username}</span>
        <i aria-hidden="true" />
      </button>

      {open && (
        <div className="account-panel" role="menu">
          <div className="account-identity">
            <b>{user.display_name || user.username}</b>
            <span>{ROLE_LABEL[user.role]} · {user.username}</span>
          </div>
          <a href="/console/#/account" onClick={() => setOpen(false)} role="menuitem">账号</a>
          {user.role === 'admin' && (
            <a href="/console/#/admin" onClick={() => setOpen(false)} role="menuitem">用户管理</a>
          )}
          <button
            onClick={() => {
              setOpen(false)
              // 退出失败时服务端会话仍然活着。不假装已退出——刷新一次让 /auth/me 说真话。
              logout().catch(() => window.location.reload())
            }}
            role="menuitem"
            type="button"
          >
            退出
          </button>
        </div>
      )}
    </div>
  )
}

export default AccountMenu
