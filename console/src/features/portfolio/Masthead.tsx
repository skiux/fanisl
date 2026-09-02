import { useState, type ReactNode } from 'react'
import { ArrowsClockwise, MoonStars, Sun } from '@phosphor-icons/react'
import { AccountMenu } from '../../components/AccountMenu'
import { StatusDot } from '../../components/Primitives'
import { cn } from '../../lib/cn'
import { clockTime, freshnessOf } from '../../lib/format'
import { useIsAdmin } from '../../lib/role'
import { hrefOf, PAGES, type PageKey } from '../../lib/router'
import type { SourceState } from '../../api/types'

const THEME_KEY = 'fanisl.console.theme'
type Theme = 'dark' | 'light'

// 首帧的深浅由 index.html 里的引导脚本定（登录页没有报头，切换器管不到它）。
// 这里只读它落下的结果，别再自己判断一次——两处判断迟早会不一致。
function currentTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(currentTheme)
  // 只在用户真的点了之后才写存储：挂载即写会把"跟随系统"固化成一次明确选择。
  const pick = (next: Theme) => {
    document.documentElement.classList.toggle('dark', next === 'dark')
    try {
      window.localStorage.setItem(THEME_KEY, next)
    } catch {
      /* 隐私模式下写不进去，本次会话内仍然生效 */
    }
    setTheme(next)
  }
  return (
    <button
      aria-label={theme === 'dark' ? '切换到浅色' : '切换到深色'}
      className="grid size-7 place-items-center text-ink-3 transition-colors duration-200 hover:text-ink"
      onClick={() => pick(theme === 'dark' ? 'light' : 'dark')}
      type="button"
    >
      {theme === 'dark' ? <MoonStars aria-hidden="true" size={15} /> : <Sun aria-hidden="true" size={15} />}
    </button>
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
  const isAdmin = useIsAdmin()
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
          {/* 另一个应用的入口属于**导航**，不属于右侧那堆控件——
              它去的是另一个地方，不是这一份报表的另一节。用一条竖线分开。

              只给管理员：对成员来说资产台就是全部，给一个他用不上的入口
              只会让"这是一个独立的东西"这件事变模糊。 */}
          {isAdmin && (
            <>
              <i aria-hidden="true" className="h-3 w-px bg-rule-strong" />
              <a
                className="whitespace-nowrap text-xs text-ink-3 transition-colors duration-200 hover:text-ink-2"
                href="/"
              >
                知识库
              </a>
            </>
          )}
        </nav>

        {/* 这一组也要能折行：流水页比另外两页多一个区间选择器，375px 下正好顶出去，
            整页跟着横向滚动。够宽时 ml-auto 仍然把它推到右边。 */}
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 sm:ml-auto">
          {controls}
          <AccountMenu />
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
          {/* 取数状态是运维信息：来源健康、口径、页面时刻。成员要看的是自己的钱
              怎么样，这些只是噪音，而且泄露的是系统内部构造。 */}
          {isAdmin && sources.length > 0 && (
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
