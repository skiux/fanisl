import { useEffect, useState, type ReactNode } from 'react'
import { MoonStars, Sun } from '@phosphor-icons/react'
import { cn } from '../lib/cn'

const THEME_KEY = 'fanisl.console.theme'
type Theme = 'dark' | 'light'

function readTheme(): Theme {
  const stored = window.localStorage.getItem(THEME_KEY)
  if (stored === 'dark' || stored === 'light') return stored
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
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
      className="grid size-8 place-items-center rounded-[var(--radius-control)] text-fg-3 transition-colors duration-200 hover:bg-surface-2 hover:text-fg active:scale-[0.96]"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      type="button"
    >
      {theme === 'dark'
        ? <MoonStars size={16} weight="regular" />
        : <Sun size={16} weight="regular" />}
    </button>
  )
}

function BrandMark() {
  return (
    <a className="group flex items-center gap-2.5" href="#/assets">
      <svg aria-hidden="true" className="text-fg" height="18" viewBox="0 0 20 20" width="18">
        <path d="M2 16.5 L8.2 3.5 L11 9.4 L13.4 5.1 L18 16.5" fill="none" stroke="currentColor" strokeLinecap="square" strokeWidth="1.4" />
        <circle cx="13.4" cy="5.1" fill="var(--accent)" r="1.9" />
      </svg>
      <span className="flex items-baseline gap-2">
        <span className="text-[13px] font-semibold tracking-tight text-fg">FANISL</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-fg-3 transition-colors group-hover:text-fg-2">
          Console
        </span>
      </span>
    </a>
  )
}

const NAV = [
  { key: 'assets', label: '资产', href: '#/assets', enabled: true },
  { key: 'orders', label: '委托', href: '#/orders', enabled: false },
  { key: 'ledger', label: '流水', href: '#/ledger', enabled: false },
] as const

export function Shell({ current, children, trailing }: {
  current: string
  children: ReactNode
  trailing?: ReactNode
}) {
  return (
    <div className="min-h-[100dvh] bg-bg">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[1320px] items-center gap-6 px-5 sm:px-8">
          <BrandMark />
          <nav aria-label="控制台导航" className="hidden items-center gap-1 sm:flex">
            {NAV.map((item) => (
              item.enabled ? (
                <a
                  aria-current={current === item.key ? 'page' : undefined}
                  className={cn(
                    'rounded-[var(--radius-control)] px-2.5 py-1.5 text-[13px] transition-colors duration-200',
                    current === item.key
                      ? 'bg-surface-2 text-fg'
                      : 'text-fg-3 hover:text-fg-2',
                  )}
                  href={item.href}
                  key={item.key}
                >
                  {item.label}
                </a>
              ) : (
                <span
                  aria-disabled="true"
                  className="cursor-default px-2.5 py-1.5 text-[13px] text-fg-3/45"
                  key={item.key}
                  title="尚未实现"
                >
                  {item.label}
                </span>
              )
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            {trailing}
            <a
              className="hidden rounded-[var(--radius-control)] px-2.5 py-1.5 text-[12px] text-fg-3 transition-colors hover:text-fg-2 md:block"
              href="/"
            >
              知识库
            </a>
            <ThemeToggle />
          </div>
        </div>
      </header>
      {children}
    </div>
  )
}
