import type { CSSProperties, ReactNode } from 'react'
import { ArrowClockwise, Key, PlugsConnected, Wallet } from '@phosphor-icons/react'
import { Eyebrow } from '../../components/Primitives'
import type { SourceState } from '../../api/types'

function Skel({ className, style }: { className: string; style?: CSSProperties }) {
  return <div className={`skel ${className}`} style={style} />
}

/** 骨架与正文同构：同一组分块与尺寸，加载完成不跳版 */
export function StatementSkeleton() {
  return (
    <div aria-busy="true" aria-label="正在读取账户">
      <section className="px-6 pb-7 pt-8 sm:px-12 sm:pb-9 sm:pt-11">
        <Skel className="h-3 w-14" />
        <Skel className="mt-4 h-12 w-64" />
        <Skel className="mt-5 h-5 w-52" />
        <Skel className="mt-8 h-[180px] w-full sm:mt-10 sm:h-[216px]" />
      </section>

      <section className="border-t border-rule px-6 py-7 sm:px-12 sm:py-9">
        <Skel className="h-3 w-20" />
        <Skel className="mt-5 h-6 w-full max-w-[42ch]" />
        <Skel className="mt-3 h-6 w-full max-w-[30ch]" />
        <div className="mt-8 flex flex-wrap gap-x-14 gap-y-4">
          {[0, 1, 2, 3, 4].map((index) => (
            <div key={index}>
              <Skel className="h-3 w-12" />
              <Skel className="mt-2 h-4 w-20" />
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-9 border-t border-rule px-6 py-7 sm:px-12 sm:py-9 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-14">
        <div>
          <Skel className="h-3 w-20" />
          <Skel className="mt-3 h-3 w-full" />
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
            {[0, 1, 2, 3, 4, 5].map((index) => <Skel className="h-3 w-24" key={index} />)}
          </div>
        </div>
        <div className="lg:border-l lg:border-rule lg:pl-14">
          <Skel className="h-3 w-12" />
          <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-5">
            {[0, 1, 2, 3].map((index) => (
              <div key={index}>
                <Skel className="h-3 w-20" />
                <Skel className="mt-2 h-5 w-16" />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-rule px-6 py-6 sm:px-12 sm:py-7">
        <Skel className="h-3 w-10" />
        <div className="mt-1">
          {[0, 1, 2].map((index) => (
            <div className="flex items-center gap-4 border-b border-rule py-4 last:border-b-0" key={index}>
              <Skel className="size-3 shrink-0" />
              <Skel className="h-4 w-24" />
              <Skel className="h-3 w-10" />
              <Skel className="ml-auto h-4 w-24" />
            </div>
          ))}
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
      <span className="grid size-10 place-items-center rounded-[10px] bg-sheet-2 text-ink-3">{icon}</span>
      <div className="space-y-2">
        <h2 className="text-[17px] font-medium tracking-tight text-ink">{title}</h2>
        <div className="text-[13px] leading-relaxed text-ink-2">{body}</div>
      </div>
      {action}
    </div>
  )
}

function RetryButton({ onRetry, label = '重新取数' }: { onRetry: () => void; label?: string }) {
  return (
    <button
      className="flex items-center gap-2 rounded-[var(--radius-control)] border border-rule px-3 py-1.5 text-[12.5px] text-ink-2 transition-all duration-200 hover:border-rule-strong hover:text-ink active:translate-y-px"
      onClick={onRetry}
      type="button"
    >
      <ArrowClockwise aria-hidden="true" size={13} />{label}
    </button>
  )
}

export function EmptyState() {
  return (
    <Frame
      action={<a className="text-[12.5px] text-accent underline-offset-4 hover:underline" href="https://www.binance.com" rel="noreferrer" target="_blank">前往 Binance</a>}
      body="连接正常，但现货和合约账户里都没有余额。等有持仓后这里会自动出现。"
      icon={<Wallet aria-hidden="true" size={19} />}
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
          <ul className="mt-3 space-y-1.5 text-[12.5px] text-ink-3">
            <li>· key 需要开启 Enable Reading（提现与交易保持关闭）</li>
            <li>· 若配置了 IP 白名单，服务器出口 IP 要在名单里</li>
            <li>· key 存放在后端 .env，不进前端构建产物</li>
          </ul>
        </>
      }
      icon={<Key aria-hidden="true" size={19} />}
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
          <p className="mt-3 text-ink-3">这里不会用上一次的数字顶替；取不到就是取不到。</p>
        </>
      }
      icon={<PlugsConnected aria-hidden="true" size={19} />}
      title="读不到账户数据"
    />
  )
}

export function StaleBanner({ asOfText }: { asOfText: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius-panel)] border border-loss/25 bg-loss/[0.06] px-4 py-3">
      <Eyebrow className="text-loss">已过期</Eyebrow>
      <p className="text-[12.5px] text-ink-2">
        下面全部数字来自 <span className="tnum text-ink">{asOfText}</span> 的快照，不是当前余额。
      </p>
    </div>
  )
}
