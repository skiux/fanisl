import type { CSSProperties, ReactNode } from 'react'
import { ArrowClockwise, Key, PlugsConnected, Wallet } from '@phosphor-icons/react'
import { Eyebrow } from '../../components/Primitives'
import type { SourceState } from '../../api/types'

function Skel({ className, style }: { className: string; style?: CSSProperties }) {
  return <div className={`skel ${className}`} style={style} />
}

/** 骨架与工作台同构：同一套栅格、同样的分隔线，加载完成不会跳版 */
export function PortfolioSkeleton() {
  return (
    <main
      aria-busy="true"
      aria-label="正在读取账户"
      className="mx-auto flex max-w-[1800px] flex-col xl:h-[calc(100dvh-3.5rem)] xl:overflow-hidden"
    >
      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-12 xl:grid-rows-[minmax(13rem,auto)_minmax(0,1fr)]">
        <section className="cell border-b border-line xl:col-span-3 xl:border-r">
          <Skel className="h-3 w-28" />
          <Skel className="mt-4 h-9 w-44" />
          <Skel className="mt-4 h-3.5 w-36" />
          <div className="mt-auto space-y-2.5 border-t border-line pt-3">
            <Skel className="h-3.5 w-full" />
            <Skel className="h-3.5 w-2/3" />
          </div>
        </section>

        <section className="cell border-b border-line xl:col-span-5 xl:border-r">
          <Skel className="h-3 w-32" />
          <Skel className="mt-3 h-[132px] w-full" />
        </section>

        <section className="cell border-b border-line xl:col-span-4">
          <Skel className="h-3 w-24" />
          <div className="mt-4 space-y-4">
            {[0, 1].map((index) => (
              <div key={index}>
                <Skel className="h-3 w-full" />
                <Skel className="mt-2 h-1.5 w-full" />
              </div>
            ))}
            <Skel className="h-3.5 w-2/3" />
          </div>
        </section>

        <section className="cell border-b border-line xl:col-span-8 xl:border-b-0 xl:border-r">
          <div className="flex gap-5 border-b border-line pb-2.5">
            {[36, 44, 44, 60].map((width, index) => (
              <Skel className="h-3.5" key={index} style={{ width }} />
            ))}
          </div>
          <Skel className="mt-5 h-3 w-52" />
          <Skel className="mt-4 h-7 w-40" />
          <div className="mt-8 flex items-end gap-3">
            {[54, 82, 96, 61, 40, 47, 100].map((height, index) => (
              <div className="flex-1" key={index}>
                <Skel className="w-full" style={{ height }} />
              </div>
            ))}
          </div>
        </section>

        <section className="cell xl:col-span-4">
          <Skel className="h-3 w-24" />
          <div className="mt-3 flex-1 space-y-3">
            {[0, 1, 2, 3, 4, 5].map((index) => <Skel className="h-3.5 w-full" key={index} />)}
          </div>
          <div className="mt-3 border-t border-line pt-3">
            <Skel className="h-3.5 w-2/3" />
          </div>
        </section>
      </div>
    </main>
  )
}

function Frame({ icon, title, body, action }: {
  icon: ReactNode
  title: string
  body: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex max-w-[460px] flex-col items-start gap-4 py-20">
      <span className="grid size-10 place-items-center rounded-[10px] bg-surface-2 text-fg-3">{icon}</span>
      <div className="space-y-2">
        <h2 className="text-[17px] font-medium tracking-tight text-fg">{title}</h2>
        <div className="text-[13px] leading-relaxed text-fg-2">{body}</div>
      </div>
      {action}
    </div>
  )
}

function RetryButton({ onRetry, label = '重新取数' }: { onRetry: () => void; label?: string }) {
  return (
    <button
      className="flex items-center gap-2 rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-[12.5px] text-fg-2 transition-all duration-200 hover:border-line-strong hover:text-fg active:translate-y-px"
      onClick={onRetry}
      type="button"
    >
      <ArrowClockwise size={13} />{label}
    </button>
  )
}

export function EmptyState() {
  return (
    <Frame
      action={<a className="text-[12.5px] text-accent underline-offset-4 hover:underline" href="https://www.binance.com" rel="noreferrer" target="_blank">前往 Binance</a>}
      body="连接正常，但现货和合约账户里都没有余额。等有持仓后这里会自动出现。"
      icon={<Wallet size={19} />}
      title="账户里还没有资产"
    />
  )
}

export function UnauthorizedState({ sources, onRetry }: { sources: SourceState[]; onRetry: () => void }) {
  const detail = sources.find((s) => s.detail)?.detail
  return (
    <Frame
      action={<RetryButton onRetry={onRetry} />}
      body={
        <>
          <p>{detail ?? 'API key 校验没有通过。'}</p>
          <ul className="mt-3 space-y-1.5 text-[12.5px] text-fg-3">
            <li>· key 需要开启 Enable Reading（提现与交易保持关闭）</li>
            <li>· 若配置了 IP 白名单，服务器出口 IP 要在名单里</li>
            <li>· key 存放在后端 .env，不进前端构建产物</li>
          </ul>
        </>
      }
      icon={<Key size={19} />}
      title="凭据没有通过校验"
    />
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Frame
      action={<RetryButton onRetry={onRetry} />}
      body={
        <>
          <p>{message}</p>
          <p className="mt-3 text-fg-3">这里不会用上一次的数字顶替；取不到就是取不到。</p>
        </>
      }
      icon={<PlugsConnected size={19} />}
      title="读不到账户数据"
    />
  )
}

export function StaleBanner({ asOfText }: { asOfText: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius-panel)] border border-loss/25 bg-loss/[0.06] px-4 py-3">
      <Eyebrow className="text-loss">已过期</Eyebrow>
      <p className="text-[12.5px] text-fg-2">
        下面全部数字来自 <span className="tnum text-fg">{asOfText}</span> 的快照，不是当前余额。
      </p>
    </div>
  )
}
