import type { CSSProperties, ReactNode } from 'react'
import { ArrowClockwise, Key, ListChecks, Lock, PlugsConnected, Receipt, Wallet } from '@phosphor-icons/react'
import { Eyebrow } from '../../components/Primitives'
import { useIsAdmin } from '../../lib/role'
import type { SourceState } from '../../api/types'

function Skel({ className, style }: { className: string; style?: CSSProperties }) {
  return <div className={`skel ${className}`} style={style} />
}

/** 骨架与正文同构：同一套栏线与分节，行高按真实行排，加载完成不跳版 */
function Row({ height, children }: { height: number; children: ReactNode }) {
  return <div className="flex items-center" style={{ height }}>{children}</div>
}

export function StatementSkeleton() {
  return (
    // 骨架也钉在纸的高度里：不然加载时整页先长出一截，取完数又缩回去
    <div aria-busy="true" aria-label="正在读取账户" className="min-h-0 flex-1 overflow-hidden">
      <section className="grid gap-7 border-b border-rule px-5 py-6 sm:px-9 sm:py-7 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] xl:gap-14">
        <div>
          <Skel className="h-3 w-32" />
          <Skel className="mt-4 h-11 w-56" />
          <Skel className="mt-4 h-4 w-44" />
        </div>
        <Skel className="h-[152px] w-full" />
      </section>

      <div className="grid xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="space-y-7 border-b border-rule px-5 py-6 sm:px-9 sm:py-7 xl:space-y-9 xl:border-b-0 xl:border-r">
          <div>
            <div className="mb-4 flex items-baseline justify-between border-b border-rule pb-2.5">
              <Skel className="h-4 w-28" />
              <Skel className="h-3 w-36" />
            </div>
            {[0, 1, 2, 3, 4, 5, 6].map((index) => (
              <Row height={44} key={index}>
                <Skel className="h-3.5 w-24" />
                <Skel className="ml-auto h-3.5 w-28" />
              </Row>
            ))}
            <Row height={52}><Skel className="ml-auto h-6 w-40" /></Row>
          </div>

          <div>
            <div className="mb-4 flex items-baseline justify-between border-b border-rule pb-2.5">
              <Skel className="h-4 w-24" />
              <Skel className="h-3 w-40" />
            </div>
            <Row height={30}><Skel className="h-3 w-full" /></Row>
            {[0, 1, 2, 3, 4, 5, 6].map((index) => (
              <Row height={44} key={index}>
                <Skel className="size-7 shrink-0 rounded-[6px]" />
                <Skel className="ml-3 h-3.5 w-20" />
                <Skel className="ml-auto h-3.5 w-24" />
              </Row>
            ))}
            <Row height={44}><Skel className="h-3.5 w-32" /><Skel className="ml-auto h-3.5 w-16" /></Row>
          </div>
        </div>

        <div className="space-y-7 px-5 py-6 sm:px-9 sm:py-7 xl:space-y-9">
          <div>
            <div className="mb-4 border-b border-rule pb-2.5"><Skel className="h-4 w-24" /></div>
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <Row height={37} key={index}>
                <Skel className="h-3 w-16" />
                <Skel className="ml-3 h-[3px] flex-1" />
                <Skel className="ml-3 h-3 w-20" />
              </Row>
            ))}
            <div className="mt-5 border-t border-rule pt-4">
              {[0, 1, 2].map((index) => (
                <Row height={26} key={index}>
                  <Skel className="h-3 w-16" />
                  <Skel className="ml-auto h-3 w-24" />
                </Row>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-4 border-b border-rule pb-2.5"><Skel className="h-4 w-20" /></div>
            {[0, 1].map((index) => (
              <div className="mb-5" key={index}>
                <Skel className="h-3 w-full" />
                <Skel className="mt-2.5 h-1.5 w-full" />
              </div>
            ))}
            <div className="border-t border-rule pt-3.5">
              {[0, 1].map((index) => (
                <Row height={28} key={index}>
                  <Skel className="h-3 w-24" />
                  <Skel className="ml-auto h-3 w-28" />
                </Row>
              ))}
            </div>
          </div>
        </div>
      </div>
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

export function NoOrdersState() {
  return (
    <Frame
      body="现货、合约与杠杆账户里都没有未成交的委托。新挂的单会出现在这里。"
      icon={<ListChecks aria-hidden="true" size={19} />}
      title="当前没有挂单"
    />
  )
}

export function EmptyLedgerState({ days }: { days: number }) {
  return (
    <Frame
      body={`最近 ${days} 天里，八个来源都没有返回任何记录：没有充提、没有派息、也没有合约收支。换一个更长的区间可以看更早的。`}
      icon={<Receipt aria-hidden="true" size={19} />}
      title="这段区间里没有流水"
    />
  )
}

export function UnauthorizedState({ sources, onRetry }: { sources: SourceState[]; onRetry: () => void }) {
  const isAdmin = useIsAdmin()
  const detail = sources.find((s) => s.detail)?.detail

  // 排查清单是给能改 .env 的人看的。成员既做不了也不该知道后端怎么放 key——
  // 对他来说这就是"数据暂时读不到，去找管理员"。
  if (!isAdmin) {
    return (
      <Frame
        body="连接交易所的凭据还没配好或已失效，这里暂时读不到数据。找管理员处理。"
        icon={<Key aria-hidden="true" size={19} />}
        title="暂时读不到账户数据"
      />
    )
  }
  return (
    <Frame
      action={<RetryButton label="再试一次" onRetry={onRetry} />}
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
      title="Binance 凭据没有通过校验"
    />
  )
}

/** 403 不是故障，是这个账号就不该看这一页——所以不给重试按钮 */
export function PermissionState({ message }: { message: string }) {
  return (
    <Frame
      body={message}
      icon={<Lock aria-hidden="true" size={19} />}
      title="这个账号没有权限"
    />
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Frame
      action={<RetryButton label="再试一次" onRetry={onRetry} />}
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
