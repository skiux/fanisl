import { useSyncExternalStore } from 'react'
import { CaretDown } from '@phosphor-icons/react'
import { DropdownMenu } from 'radix-ui'
import { getSession, logout, subscribe } from '../api/session'
import { cn } from '../lib/cn'

const ROLE_LABEL = { admin: '管理员', member: '成员' } as const

/**
 * 账号菜单。
 *
 * 报头右上角原先直接排着「用户名 · 用户 · 退出」三个文字元素，那一行本来就有
 * 场景开关、区间开关、知识库入口、主题切换，再加三个就挤到裁字。现在收成一个入口。
 *
 * **面板走 Radix 的 DropdownMenu，不再自己定位。** 上一版是 `absolute right-0`，
 * 没有碰撞检测：窄屏下报头那一行会折行，触发器落到什么位置不确定，184px 宽的面板
 * 就飘到屏幕外去了。`collisionPadding` 让它自己翻转和贴边，这类事自己写永远漏一种情况
 * ——还要连带自己处理 Escape、点外面关闭、焦点归位、滚动锁。
 */
export function AccountMenu() {
  const session = useSyncExternalStore(subscribe, getSession)
  if (session.status !== 'authenticated') return null
  const user = session.user

  const item = cn(
    'block w-full cursor-default px-3 py-2 text-left text-xs text-ink-2 outline-none',
    'data-[highlighted]:bg-sheet-2 data-[highlighted]:text-ink',
  )

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className={cn(
          'flex items-center gap-1.5 whitespace-nowrap text-xs outline-none',
          'text-ink-3 transition-colors duration-200 hover:text-ink-2',
          'data-[state=open]:text-ink',
          'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2',
          'focus-visible:outline-accent',
        )}
      >
        {/* 显示名可能很长，窄屏下要能截断，否则它自己就能把报头撑破 */}
        <span className="max-w-[8rem] truncate sm:max-w-[12rem]">
          {user.display_name || user.username}
        </span>
        <CaretDown aria-hidden="true" className="shrink-0" size={10} />
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          className={cn(
            'z-50 w-[184px] border border-rule bg-sheet shadow-[var(--sheet-shadow)]',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0',
          )}
          collisionPadding={12}
          sideOffset={8}
        >
          <DropdownMenu.Label className="border-b border-rule px-3 py-2.5">
            <div className="truncate text-xs text-ink">{user.display_name || user.username}</div>
            <div className="mt-0.5 truncate text-micro text-ink-3">
              {ROLE_LABEL[user.role]} · {user.username}
            </div>
          </DropdownMenu.Label>

          <DropdownMenu.Item asChild>
            <a className={item} href="#/account">账号</a>
          </DropdownMenu.Item>
          {user.role === 'admin' && (
            <DropdownMenu.Item asChild>
              <a className={item} href="#/admin">用户管理</a>
            </DropdownMenu.Item>
          )}

          <DropdownMenu.Separator className="border-t border-rule" />
          <DropdownMenu.Item
            className={item}
            onSelect={() => {
              // 退出失败时服务端会话仍然活着。不假装已退出——刷新一次，
              // 让 /auth/me 说真话。
              logout().catch(() => window.location.reload())
            }}
          >
            退出
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
