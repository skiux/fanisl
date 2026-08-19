import type { ReactNode } from 'react'
import { ArrowClockwise, Key, PlugsConnected, Wallet } from '@phosphor-icons/react'
import { Eyebrow } from '../../components/Primitives'
import type { VenueState } from '../../api/types'

function Skel({ className }: { className: string }) {
  return <div className={`skel ${className}`} />
}

/** 骨架按真实布局的尺寸排布，加载完成时不会发生跳版 */
export function PortfolioSkeleton() {
  return (
    <div aria-busy="true" aria-label="正在读取账户" className="space-y-12">
      <section className="grid gap-10 lg:grid-cols-[1.55fr_1fr] lg:gap-14">
        <div>
          <Skel className="h-3 w-32" />
          <Skel className="mt-5 h-[56px] w-[min(100%,340px)]" />
          <Skel className="mt-6 h-4 w-56" />
          <div className="mt-8 grid grid-cols-3 gap-px overflow-hidden rounded-[var(--radius-panel)] bg-line">
            {[0, 1, 2].map((index) => (
              <div className="bg-bg px-4 py-3.5" key={index}>
                <Skel className="h-3 w-14" />
                <Skel className="mt-2.5 h-4 w-20" />
              </div>
            ))}
          </div>
        </div>
        <div className="lg:border-l lg:border-line lg:pl-10">
          <Skel className="h-3 w-20" />
          <div className="mt-4 space-y-4">
            {[0, 1].map((index) => <Skel className="h-4 w-full" key={index} />)}
          </div>
          <Skel className="mt-7 h-4 w-2/3" />
        </div>
      </section>

      <section>
        <Skel className="h-3 w-28" />
        <Skel className="mt-3 h-2.5 w-full" />
        <div className="mt-4 flex gap-6">
          {[0, 1, 2, 3, 4].map((index) => <Skel className="h-3 w-16" key={index} />)}
        </div>
      </section>

      <section className="grid gap-12 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div>
          <Skel className="h-3 w-24" />
          <div className="mt-6 space-y-6">
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <div className="flex items-center gap-3" key={index}>
                <Skel className="size-7 shrink-0 rounded-[6px]" />
                <Skel className="h-3.5 w-24" />
                <Skel className="ml-auto h-3.5 w-20" />
              </div>
            ))}
          </div>
        </div>
        <div>
          <Skel className="h-3 w-24" />
          <Skel className="mt-6 h-20 w-full rounded-[var(--radius-panel)]" />
          <div className="mt-6 space-y-5">
            {[0, 1].map((index) => <Skel className="h-12 w-full" key={index} />)}
          </div>
        </div>
      </section>
    </div>
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

export function UnauthorizedState({ venues, onRetry }: { venues: VenueState[]; onRetry: () => void }) {
  const detail = venues.find((v) => v.detail)?.detail
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
