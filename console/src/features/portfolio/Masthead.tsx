import { useId, useState, type ReactNode } from 'react'
import { ArrowsClockwise, MoonStars, Sun } from '@phosphor-icons/react'
import { AccountMenu } from '../../components/AccountMenu'
import { BrandMark } from '../../components/BrandMark'
import { cn } from '../../lib/cn'
import { clockTime } from '../../lib/format'
import { useIsAdmin } from '../../lib/role'
import { dataStatus, type DataLevel } from '../../lib/status'
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


const LIGHT: Record<DataLevel, string> = {
  ok: 'bg-gain',
  warn: 'bg-accent',
  error: 'bg-loss',
}

/**
 * 报头。走的是文件的规矩：先一行页眉（出处与导航），再是报表标题与出具时刻，
 * 底下压一条整份报表唯一的实心重线——层级由它定调，下面所有分隔线都比它轻。
 */
export function Masthead({
  sources, asOf, onRefresh, refreshing, controls, title, refreshError = null, syncing = false,
}: {
  sources: SourceState[]
  asOf: string | null
  onRefresh: () => void
  refreshing: boolean
  controls?: ReactNode
  title: ReactNode
  /** 最近一次后台刷新失败的原因；灯的颜色与提示用它 */
  refreshError?: string | null
  /** 有请求在路上 */
  syncing?: boolean
}) {
  const isAdmin = useIsAdmin()

  return (
    // relative z-20：view-transition-name 让报头自成一个层叠上下文，不抬高的话，
    // 状态灯的浮层会被后面的摘要条盖住（2026-10-03 实测只剩一层淡影）
    <header className="vt-masthead rule-heavy relative z-20 px-5 pb-3.5 pt-4 sm:px-10 sm:pb-4 sm:pt-5">
      {/* 窄屏分两行：第一行是品牌与账号（各占一端），第二行才是导航与控件。
          原先三组东西挤在一个 flex-wrap 里，375px 下账号和主题被挤到下一行，
          落在哪儿全看内容长短——显示名一长就又是另一个样子。 */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
        <span className="order-1 flex items-center gap-2">
          <BrandMark className="text-ink" size={16} />
          <span className="text-xs font-semibold tracking-tight text-ink">FANISL</span>
          <span className="label">Console</span>
        </span>

        {/* 账号与主题：窄屏跟品牌同一行、贴右；宽屏挪到整行最右 */}
        <div className="order-2 ml-auto flex shrink-0 items-center gap-3 sm:order-4">
          <AccountMenu />
          <ThemeToggle />
        </div>

        {/* 报头原先还排着各页的入口；资产、流水挪进底栏，「委托」页 2026-10-03 删了
            （委托在合约页与持仓页的右栏），这里只剩另一个应用的入口，原先隔开两者的
            那条竖线也就不要了。

            只给管理员：对成员来说资产台就是全部，给一个他用不上的入口
            只会让"这是一个独立的东西"这件事变模糊。成员那里整个 nav 不出现——
            留一个空的，窄屏上它照样占一整行，报头平白高出一截。 */}
        {isAdmin && (
          <nav aria-label="控制台导航"
               className="order-3 flex w-full items-center gap-4 sm:order-2 sm:w-auto">
            <a
              className="whitespace-nowrap text-xs text-ink-3 transition-colors duration-200 hover:text-ink-2"
              href="/"
            >
              知识库
            </a>
          </nav>
        )}

        {/* 页面自己的控件（流水页的区间选择器等）。窄屏另起一行，
            宽屏挤在导航右边、被账号那一组推到中间 */}
        {controls && (
          <div className="order-4 flex w-full flex-wrap items-center gap-x-3 gap-y-2 sm:order-3 sm:ml-auto sm:w-auto sm:justify-end">
            {controls}
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
        <h1 className="font-display text-lg font-medium leading-tight tracking-[-0.01em] text-ink">
          {title}
        </h1>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {/* 这些数字有多新。显示时刻按美东时间，并用 ET 同时涵盖 EST / EDT；
              盈亏日历仍按 Binance 的 UTC 结算日分桶，两种口径各自明确。
              前面不写"截至"：一个时刻摆在报头上，本来就是"这些数字截到什么时候"。

              右边那盏灯说这些数字现在可不可信（lib/status.ts），原因在悬停提示里。
              它取代了原先压在页面顶上的「已过期」横幅和整页蒙灰。

              用户管理这类没有数据源的页面整条不出现（`sources=[]` 时原先会显示
              "截至 — · 0 个来源正常"，读着像故障）。 */}
          {sources.length > 0 && (
            <StatusClock asOf={asOf} refreshError={refreshError} sources={sources} syncing={syncing} />
          )}
          {/* 重新取数是运维动作：它绕过缓存直接打交易所，而权重预算是共享的。
              成员点它既没有判断依据，也可能把预算打空让所有人一起 429。
              成员也不需要它：页面在前台时会自己按缓存节奏重取，见 lib/autoRefresh.ts */}
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

/**
 * 报头的时间与状态灯。灯的原因写在一个小浮层里：悬停、键盘聚焦、点一下都能看到。
 *
 * 第一版用的是 `title` 属性，用户说"鼠标悬停没有显示提示"（2026-10-03）：原生提示要停
 * 将近一秒才出、只挂在 7px 的圆点上很难对准、触屏上根本没有，样子也是系统画的。
 * 现在整组（时间 + 灯）都是触发区，浮层立即出现，贴右对齐不会伸出屏幕。
 */
function StatusClock({ asOf, sources, refreshError, syncing }: {
  asOf: string | null
  sources: SourceState[]
  refreshError: string | null
  syncing: boolean
}) {
  const status = dataStatus({ asOf, sources, refreshError, syncing })
  const [pinned, setPinned] = useState(false)
  const tipId = useId()
  return (
    <span className="group relative">
      <button
        aria-describedby={tipId}
        className={cn('tnum flex items-center gap-2 rounded-[4px] text-xs text-ink-2 outline-none',
          'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-accent')}
        onBlur={() => setPinned(false)}
        onClick={() => setPinned((on) => !on)}
        type="button"
      >
        <span>{clockTime(asOf)}<span className="text-ink-3"> ET</span></span>
        <span
          aria-hidden="true"
          className={cn('size-[7px] shrink-0 rounded-full transition-colors duration-500', LIGHT[status.level])}
          data-level={status.level}
        />
      </button>
      <span
        className={cn(
          'pointer-events-none absolute right-0 top-full z-40 mt-2 flex w-max max-w-[18rem] items-center gap-2',
          'rounded-[var(--radius-control)] border border-rule bg-sheet px-3 py-2 text-xs text-ink-2',
          'shadow-[var(--sheet-shadow)] transition-[opacity,transform] duration-150',
          'translate-y-0.5 opacity-0 group-hover:translate-y-0 group-hover:opacity-100',
          // 只认键盘聚焦：鼠标点一下按钮也会获得焦点，用 focus-within 的话再点一次关不掉
          'group-has-[:focus-visible]:translate-y-0 group-has-[:focus-visible]:opacity-100',
          pinned && 'translate-y-0 opacity-100',
        )}
        id={tipId}
        role="tooltip"
      >
        <span aria-hidden="true" className={cn('size-[7px] shrink-0 rounded-full', LIGHT[status.level])} />
        {status.text}
      </span>
    </span>
  )
}
