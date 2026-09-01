import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { ArrowsClockwise, MoonStars, Sun } from '@phosphor-icons/react'
import { getSession, logout, subscribe } from '../../api/session'
import { StatusDot } from '../../components/Primitives'
import { cn } from '../../lib/cn'
import { clockTime, freshnessOf } from '../../lib/format'
import { hrefOf, PAGES, type PageKey } from '../../lib/router'
import type { SourceState } from '../../api/types'

const THEME_KEY = 'fanisl.console.theme'
type Theme = 'dark' | 'light'

function readTheme(): Theme {
  const stored = window.localStorage.getItem(THEME_KEY)
  if (stored === 'dark' || stored === 'light') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readTheme)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    window.localStorage.setItem(THEME_KEY, theme)
  }, [theme])
  return (
    <button
      aria-label={theme === 'dark' ? '切换到浅色' : '切换到深色'}
      className="grid size-7 place-items-center text-ink-3 transition-colors duration-200 hover:text-ink"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      type="button"
    >
      {theme === 'dark' ? <MoonStars aria-hidden="true" size={15} /> : <Sun aria-hidden="true" size={15} />}
    </button>
  )
}

/** 当前用户 + 退出。管理入口只对管理员出现——成员看到一个点进去就 403 的链接毫无意义。 */
function SessionChip() {
  const session = useSyncExternalStore(subscribe, getSession)
  if (session.status !== 'authenticated') return null
  const { user } = session
  return (
    <span className="flex items-center gap-2.5 whitespace-nowrap text-xs text-ink-3">
      <span className="text-ink-2">{user.display_name || user.username}</span>
      {user.role === 'admin' && (
        <a className="transition-colors hover:text-ink" href="#/admin">用户</a>
      )}
      <button
        className="transition-colors hover:text-ink"
        onClick={() => {
          // 退出请求失败时服务端会话仍然活着。不假装已退出——刷新一次，
          // 让 /auth/me 说真话。
          logout().catch(() => window.location.reload())
        }}
        type="button"
      >
        退出
      </button>
    </span>
  )
}

/**
 * 报头。走的是文件的规矩：先一行页眉（出处与导航），再是报表标题与出具时刻，
 * 底下压一条整份报表唯一的实心重线——层级由它定调，下面所有分隔线都比它轻。
 */
export function Masthead({ sources, asOf, onRefresh, refreshing, controls, page, title }: {
  sources: SourceState[]
  asOf: string | null
  onRefresh: () => void
  refreshing: boolean
  controls?: ReactNode
  page: PageKey
  title: string
}) {
  const degraded = sources.filter((source) => source.status !== 'ok')
  const { level } = freshnessOf(asOf)

  return (
    <header className="rule-heavy px-5 pb-3.5 pt-4 sm:px-10 sm:pb-4 sm:pt-5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="flex items-center gap-2">
          <svg aria-hidden="true" className="text-ink" height="15" viewBox="0 0 20 20" width="15">
            <path d="M2 16.5 L8.2 3.5 L11 9.4 L13.4 5.1 L18 16.5" fill="none" stroke="currentColor" strokeLinecap="square" strokeWidth="1.5" />
            <circle cx="13.4" cy="5.1" fill="var(--accent)" r="1.9" />
          </svg>
          <span className="text-xs font-semibold tracking-tight text-ink">FANISL</span>
          <span className="label">Console</span>
        </span>

        <nav aria-label="控制台导航" className="flex items-center gap-4">
          {PAGES.map((item) => {
            const current = item.key === page
            if (!item.enabled) {
              return (
                <span className="cursor-default whitespace-nowrap text-xs text-ink-3/50" key={item.key} title="尚未实现">
                  {item.label}
                </span>
              )
            }
            return (
              <a
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'whitespace-nowrap text-xs transition-colors duration-200',
                  current ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
                )}
                href={hrefOf(item.key)}
                key={item.key}
              >
                {item.label}
              </a>
            )
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {controls}
          <a className="whitespace-nowrap text-xs text-ink-3 transition-colors hover:text-ink-2" href="/">知识库</a>
          <SessionChip />
          <ThemeToggle />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
        <h1 className="font-display text-xl font-medium tracking-[-0.015em] text-ink">
          {title}
        </h1>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {/*
            用户管理这类页面没有数据来源，整条取数状态就不该出现——
            `sources=[]` 时原来会显示"截至 —· 0 个来源正常"，读着像故障。
          */}
          {sources.length > 0 && (
            <>
              <span className="tnum text-xs text-ink-2">截至 {clockTime(asOf)}</span>
              <span className="flex items-center gap-1.5">
                <StatusDot level={degraded.length > 0 ? 'error' : level} />
                <span className={cn('text-xs', degraded.length > 0 ? 'text-loss' : 'text-ink-3')}>
                  {degraded.length > 0
                    ? `${degraded.length} / ${sources.length} 个来源异常`
                    : `${sources.length} 个来源正常`}
                </span>
              </span>
              <span className="text-xs text-ink-3">计价 USD</span>
            </>
          )}
          <button
            className="flex items-center gap-1.5 text-xs text-ink-3 transition-colors duration-200 hover:text-ink disabled:opacity-40"
            disabled={refreshing}
            onClick={onRefresh}
            type="button"
          >
            <ArrowsClockwise aria-hidden="true" className={cn(refreshing && 'animate-spin')} size={12} />
            重新取数
          </button>
        </div>
      </div>
    </header>
  )
}
