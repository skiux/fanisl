import { useState, type ReactNode } from 'react'
import { ArrowsClockwise, MoonStars, Sun } from '@phosphor-icons/react'
import { AccountMenu } from '../../components/AccountMenu'
import { cn } from '../../lib/cn'
import { clockTime } from '../../lib/format'
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

  return (
    <header className="rule-heavy px-5 pb-3.5 pt-4 sm:px-10 sm:pb-4 sm:pt-5">
      {/* 窄屏分两行：第一行是品牌与账号（各占一端），第二行才是导航与控件。
          原先三组东西挤在一个 flex-wrap 里，375px 下账号和主题被挤到下一行，
          落在哪儿全看内容长短——显示名一长就又是另一个样子。 */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
        <span className="order-1 flex items-center gap-2">
          <svg aria-hidden="true" className="text-ink" height="15" viewBox="0 0 20 20" width="15">
            <path d="M2 16.5 L8.2 3.5 L11 9.4 L13.4 5.1 L18 16.5" fill="none" stroke="currentColor" strokeLinecap="square" strokeWidth="1.5" />
            <circle cx="13.4" cy="5.1" fill="var(--accent)" r="1.9" />
          </svg>
          <span className="text-xs font-semibold tracking-tight text-ink">FANISL</span>
          <span className="label">Console</span>
        </span>

        {/* 账号与主题：窄屏跟品牌同一行、贴右；宽屏挪到整行最右 */}
        <div className="order-2 ml-auto flex shrink-0 items-center gap-3 sm:order-4">
          <AccountMenu />
          <ThemeToggle />
        </div>

        <nav aria-label="控制台导航"
             className="order-3 flex w-full items-center gap-4 sm:order-2 sm:w-auto">
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

        {/* 页面自己的控件（流水页的区间选择器等）。窄屏另起一行，
            宽屏挤在导航右边、被账号那一组推到中间 */}
        {controls && (
          <div className="order-4 flex w-full flex-wrap items-center gap-x-3 gap-y-2 sm:order-3 sm:ml-auto sm:w-auto sm:justify-end">
            {controls}
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
        <h1 className="font-display text-xl font-medium tracking-[-0.015em] text-ink">
          {title}
        </h1>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {/* 这些数字有多新。**时刻按 UTC，后面缀上"UTC"两个字母。**
              整页按 UTC 日切（日历的每一格、成交与结算的分桶都是 Binance 的结算日），
              时刻自然也是 UTC。可读的人在 UTC+8，屏幕上写 13:09 而墙上是 21:09——
              标上 UTC 才一眼看懂，那两个字母是数据的一部分，不是说明文字。
              前面不写"截至"：一个时刻摆在报头上，本来就是"这些数字截到什么时候"。

              旁边原先还挂着「N 项取不到」/「数据已过期」，都删了：**同一件事
              说三遍**——取不到的那个数字本身就是 `—`，总览页还有一整块
              「下面的数字不完整」逐个列出是哪个来源；过期则另有一条横幅。

              用户管理这类没有数据源的页面整条不出现（`sources=[]` 时原先会显示
              "截至 — · 0 个来源正常"，读着像故障）。 */}
          {sources.length > 0 && (
            <span className="tnum text-xs text-ink-2">
              {clockTime(asOf)}<span className="text-ink-3"> UTC</span>
            </span>
          )}
          {/* 重新取数是运维动作：它绕过缓存直接打交易所，而权重预算是共享的。
              成员点它既没有判断依据，也可能把预算打空让所有人一起 429。 */}
          {isAdmin && (
            <button
              className="flex items-center gap-1.5 text-xs text-ink-3 transition-colors duration-200 hover:text-ink disabled:opacity-40"
              disabled={refreshing}
              onClick={onRefresh}
              type="button"
            >
              <ArrowsClockwise aria-hidden="true" className={cn(refreshing && 'animate-spin')} size={12} />
              重新取数
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
