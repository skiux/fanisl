import { cn } from '../lib/cn'

/**
 * 页面顶部那条常驻摘要：一个主数字，右边跟几个指标。三个页面用同一个。
 *
 * 之前资产 / 委托 / 流水各写了一份，长得都不一样，而且都栽在同一处几何上——
 * 一排里放着 40px 的主数字和 17px 的指标，怎么摆都有一处不齐：
 *
 *   底对齐（items-end）：矮的那格整块下沉，标签线断掉；
 *   给数字加 padding 压到同一**基线**：标签和它的数字被扯开二十几个像素。
 *
 * 后者是改坏得最狠的一版，因为它牺牲的是最不该牺牲的那一个——标签和数字是
 * 一对，靠得近才读得出是一对，这比跨列对齐重要得多。
 *
 * 出路是**别拿基线当那条线**。字号不同的数字，基线对齐意味着小的那个要整体
 * 下沉（下沉量 = 字号差 × 上伸部系数）；而 `leading-none` 下顶对齐得到的是
 * 一条**字身顶线**，40px 和 21px 的实测墨迹顶差 0.86px。所以：
 *
 *   `items-start` + 每格内部同一个 `mt-2`
 *     → 标签同线、标签到数字的距离处处相等、数字顶也同线，一次全中。
 *
 * 每格只有标签和数字两行，没有第三行小注：三格里只有一格常年有字的话，
 * 那两个字既撑高整条又让这一格跟邻居不齐。需要提醒就让数字自己变色（tone）。
 */
export type StripTone = 'gain' | 'loss' | 'warn' | 'muted'

export type StripCell = {
  label: string
  value: string
  tone?: StripTone
  /** 点开看这个数怎么算的。给了才可点 */
  onOpen?: () => void
  /** 关闭详情后焦点要回到这个按钮，靠它找回来 */
  id?: string
}

const TONE: Record<StripTone, string> = {
  gain: 'text-gain',
  loss: 'text-loss',
  // 提醒用金色（两套主题里它都是唯一的强调色），不占一个新词
  warn: 'text-accent',
  muted: 'text-ink-3',
}

export function Strip({ hero, cells, veiled }: {
  hero: StripCell
  cells: StripCell[]
  veiled?: boolean
}) {
  return (
    <div className={cn(
      // 窄屏用两列定宽网格，宽屏才换成 flex：窄屏若也用 flex，第二列的位置
      // 取决于第一格数字有多长，数一变列就挪。
      'grid grid-cols-2 items-start gap-x-8 gap-y-6',
      'px-5 pb-4 pt-4 sm:flex sm:flex-wrap sm:gap-x-14 sm:px-10 sm:pb-5 sm:pt-5',
      veiled && 'veiled',
    )}>
      {/* 主数字独占一行：2rem 的数字旁边塞不下三个指标 */}
      <Item cell={hero} className="col-span-2 sm:w-auto" hero />
      {cells.map((cell) => <Item cell={cell} key={cell.label} />)}
    </div>
  )
}

function Item({ cell, hero = false, className }: {
  cell: StripCell
  hero?: boolean
  className?: string
}) {
  // 可点与不可点必须是**同一种盒子**，否则标签的行盒高度不同，一排里差几像素。
  // `block` 是为了这个：button 是 inline-block、span 是 inline，都显式压成块级。
  const labelClass = cn('label block text-left', cell.onOpen && cn(
    'cursor-pointer outline-none transition-colors duration-200 hover:text-ink-2',
    // 下划虚线是"这里能点"的最轻提示。摘要条是一排读数，不是一排按钮，
    // 不给它加边框或底色
    'decoration-rule-strong underline-offset-[5px] hover:underline hover:decoration-dotted',
    'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-4',
    'focus-visible:outline-accent',
  ))

  return (
    <div className={className}>
      {cell.onOpen ? (
        <button className={labelClass} data-strip-cell={cell.id} onClick={cell.onOpen} type="button">
          {cell.label}
        </button>
      ) : (
        <span className={labelClass}>{cell.label}</span>
      )}
      <div className={cn(
        // mt-2 两档共用——标签到数字的距离处处相等，见文件头
        'tnum mt-2 leading-none',
        hero ? 'text-[2rem] font-medium tracking-[-0.03em] sm:text-[2.5rem]' : 'text-xl',
        cell.tone ? TONE[cell.tone] : 'text-ink',
      )}>
        {cell.value}
      </div>
    </div>
  )
}
