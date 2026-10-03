import { useEffect, useMemo, useState } from 'react'
import type { FundSnapshot, PortfolioSnapshot } from '../../api/types'
import { Module, Stack, ViewGrid } from '../../components/layout'
import { PersonMark } from '../../components/PersonMark'
import { Strip } from '../../components/Strip'
import { cn } from '../../lib/cn'
import { money, percent, ratio, signedMoney, signedPercent } from '../../lib/format'
import { accountDays, accountsAt, type Account, type AccountDay, type Allocation } from '../../lib/fund'
import { hrefOf } from '../../lib/router'
import { RealizedDays } from './RealizedDays'

/**
 * 资产页的「账户」一节：每个参与分配的人自己的账户。规则与口径见 `lib/fund.ts`。
 *
 * 管理员看全部参与者，右栏的列表用来切换；成员只拿得到自己那一行（后端筛过），
 * 列表就不出现。管理员本人不参与分配，所以这里没有"我的账户"。
 */

export type AccountsModel = ReturnType<typeof accountsAt> & { atMs: number }

/**
 * 账户的数都按快照那一刻算：管理费按时间计提，用页面上的时刻才和净值对得上。
 * 快照的净值已经含现金（取数时并进来的，见 `lib/fund.ts` 的 withCash）。
 */
export function accountsModel(snapshot: PortfolioSnapshot, fund: FundSnapshot | null): AccountsModel {
  const parsed = snapshot.as_of ? Date.parse(snapshot.as_of) : NaN
  const atMs = Number.isFinite(parsed) ? parsed : Date.now()
  return { ...accountsAt(fund, snapshot.totals?.equity_usd ?? null, atMs), atMs }
}

const tone = (value: number | null | undefined) => (value == null ? 'muted' as const
  : value > 0 ? 'gain' as const : value < 0 ? 'loss' as const : undefined)

const roleLabel = (account: Account) => [
  account.member.is_manager && 'Manager', account.member.is_investor && 'Investor',
].filter(Boolean).join(' · ')

function useDays(account: Account | null, snapshot: PortfolioSnapshot, fund: FundSnapshot | null, atMs: number) {
  return useMemo(() => (account
    ? accountDays(account.member, fund, snapshot.pnl?.daily ?? [], snapshot.totals?.equity_usd ?? null, atMs)
    : []), [account, fund, snapshot, atMs])
}

export function AccountsStrip({ account, snapshot, fund, atMs }: {
  account: Account | null
  snapshot: PortfolioSnapshot
  fund: FundSnapshot | null
  atMs: number
}) {
  const days = useDays(account, snapshot, fund, atMs)
  const today = days.at(-1)?.pnl_usd ?? null
  const total = account?.allocation?.total ?? null
  return (
    <Strip
      cells={[
        {
          label: '盈亏', value: signedMoney(total), tone: tone(total),
          detail: account?.return == null ? undefined : signedPercent(account.return, 2),
        },
        { label: '今日盈亏', value: signedMoney(today), tone: tone(today) },
        { label: 'Invested Capital', value: money(account?.member.invested_capital_usd) },
      ]}
      hero={{ label: '账户价值', value: money(account?.value) }}
    />
  )
}

export function AccountsView({ model, account, onSelect, snapshot, fund, admin }: {
  model: AccountsModel
  account: Account | null
  onSelect: (userId: number) => void
  snapshot: PortfolioSnapshot
  fund: FundSnapshot | null
  admin: boolean
}) {
  const days = useDays(account, snapshot, fund, model.atMs)
  const [selectedDate, setSelectedDate] = useState<string | null>(days.at(-1)?.date ?? null)
  useEffect(() => {
    if (selectedDate && days.some((day) => day.date === selectedDate)) return
    setSelectedDate(days.at(-1)?.date ?? null)
  }, [days, selectedDate])

  if (!account) {
    return (
      <div className="flex flex-col items-start gap-3 py-16">
        <p className="text-sm text-ink-2">还没有参与分配的用户。</p>
        {admin && (
          <a className="text-xs text-accent underline-offset-4 hover:underline" href={hrefOf('admin')}>
            去「用户」设置
          </a>
        )}
      </div>
    )
  }

  const selectedDay = days.find((day) => day.date === selectedDate) ?? null

  return (
    <ViewGrid>
      {/* 窄屏把账户列表放到最前：先选人，再看他的日历 */}
      {admin && model.accounts.length > 1 && (
        <Module figure={`${model.accounts.length} 个`} span="lg:hidden" title="账户">
          <AccountList accounts={model.accounts} current={account} onSelect={onSelect} />
        </Module>
      )}

      <Module span="self-start lg:col-span-7" title="每日盈亏">
        {model.terms === null ? (
          <p className="py-10 text-center text-sm text-ink-3">—</p>
        ) : (
          <RealizedDays days={days} onSelectDate={setSelectedDate} selectedDate={selectedDate} />
        )}
        <DayBreakdown account={account} day={selectedDay} />
      </Module>

      <Stack span="lg:col-span-5">
        {admin && model.accounts.length > 1 && (
          <div className="hidden lg:block">
            <Module figure={`${model.accounts.length} 个`} span="" title="账户">
              <AccountList accounts={model.accounts} current={account} onSelect={onSelect} />
            </Module>
          </div>
        )}
        <AllocationModule account={account} model={model} />
        <BaseModule model={model} />
      </Stack>
    </ViewGrid>
  )
}

function AccountList({ accounts, current, onSelect }: {
  accounts: Account[]
  current: Account
  onSelect: (userId: number) => void
}) {
  return (
    <ul className="divide-y divide-rule/70">
      {accounts.map((account) => {
        const active = account.member.user_id === current.member.user_id
        return (
          <li key={account.member.user_id}>
            <button
              aria-pressed={active}
              className={cn(
                'grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-[var(--radius-control)] px-2 py-2.5 text-left',
                'transition-colors duration-200 hover:bg-sheet-2/60',
                active && 'bg-sheet-2',
              )}
              onClick={() => onSelect(account.member.user_id)}
              type="button"
            >
              {/* 与「用户」页同一个标记、同一个颜色 */}
              <PersonMark name={account.member.display_name} username={account.member.username} />
              <span className="min-w-0">
                <span className="block truncate text-sm text-ink">{account.member.display_name}</span>
                <span className="block truncate text-micro text-ink-3">{roleLabel(account)}</span>
              </span>
              <span className="text-right">
                <span className="tnum block text-sm text-ink">{money(account.value)}</span>
                <span className={cn('tnum block text-xs',
                  tone(account.allocation?.total) === 'gain' ? 'text-gain'
                    : tone(account.allocation?.total) === 'loss' ? 'text-loss' : 'text-ink-3')}>
                  {account.return == null ? '—' : signedPercent(account.return, 2)}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** 一个人的分配项：哪几行出现取决于他的角色，Loss Allocation 人人都有 */
function parts(account: Account): { key: keyof Allocation; label: string; rate: number }[] {
  const { member } = account
  return [
    ...(member.is_manager ? [
      { key: 'management_fee' as const, label: 'Management Fee', rate: member.management_fee },
      { key: 'performance_fee' as const, label: 'Performance Fee', rate: member.performance_fee },
    ] : []),
    ...(member.is_investor
      ? [{ key: 'investor_return' as const, label: 'Investor Return', rate: member.investor_return }] : []),
    { key: 'loss' as const, label: 'Loss Allocation', rate: member.loss_allocation },
  ]
}

function Row({ label, rate, value, signed = true, strong = false }: {
  label: string
  rate?: string
  value: number | null | undefined
  signed?: boolean
  strong?: boolean
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(7.5rem,auto)] items-baseline gap-x-4 py-2.5">
      <dt className={cn('text-xs', strong ? 'text-ink-2' : 'text-ink-3')}>{label}</dt>
      <span className="tnum text-xs text-ink-3">{rate ?? ''}</span>
      <dd className={cn('tnum text-right', strong ? 'text-base' : 'text-sm',
        !signed ? 'text-ink' : value == null ? 'text-ink-3'
          : value > 0 ? 'text-gain' : value < 0 ? 'text-loss' : 'text-ink-2')}>
        {signed ? signedMoney(value) : money(value)}
      </dd>
    </div>
  )
}

function AllocationModule({ account, model }: { account: Account; model: AccountsModel }) {
  const { member, allocation } = account
  const initial = model.terms?.initialNav ?? null
  return (
    // 标题就是这个人：原先写「分配」、名字放在右边，用户嫌多余（2026-10-03）
    <Module span="" title={member.display_name}>
      <dl className="divide-y divide-rule/70 border-b border-rule/70">
        <Row
          label="Invested Capital"
          rate={initial ? percent(member.invested_capital_usd / initial, 1) : undefined}
          signed={false}
          value={member.invested_capital_usd}
        />
        {parts(account).map(({ key, label, rate }) => (
          <Row key={key} label={label} rate={ratio(rate)} value={allocation ? allocation[key] : null} />
        ))}
        <Row label="账户价值" signed={false} strong value={account.value} />
      </dl>
    </Module>
  )
}

/**
 * 分配的基数：净值（含现金）相对初始净值的盈亏，先扣管理费，剩下的才按比例分。
 * 不带标题（原先叫「可分配」），行名用基金的英文说法，最后一行 Net P&L 就是可分配的那个数。
 */
function BaseModule({ model }: { model: AccountsModel }) {
  const { terms, state } = model
  return (
    <section aria-label="Net P&L" className="min-w-0">
      <dl className="divide-y divide-rule/70 border-y border-rule/70">
        <div className="flex items-baseline justify-between gap-4 py-2.5">
          <dt className="text-xs text-ink-3">Inception Date</dt>
          <dd className="tnum text-sm text-ink">
            {terms ? `${terms.inception} · ${Math.floor(state?.days ?? 0)} 天` : '—'}
          </dd>
        </div>
        <Row label="Initial NAV" signed={false} value={terms?.initialNav} />
        <Row label="Current NAV" signed={false} value={state ? terms!.initialNav + state.pnl : null} />
        <Row label="Gross P&L" value={state?.pnl} />
        <Row label="Management Fee" rate={terms ? ratio(terms.feeRate) : undefined}
             value={state ? -state.fees : null} />
        <Row label="Net P&L" strong value={state?.distributable} />
      </dl>
    </section>
  )
}

function DayBreakdown({ account, day }: { account: Account; day: AccountDay | null }) {
  if (!day) return null
  return (
    <aside className="mt-6 min-w-0 border-t border-rule pt-5">
      <div className="flex items-baseline justify-between gap-4">
        <span className="tnum text-xs text-ink-3">{day.date}</span>
        <span className={cn('tnum text-xl', day.pnl_usd === null ? 'text-ink-3'
          : day.pnl_usd > 0 ? 'text-gain' : day.pnl_usd < 0 ? 'text-loss' : 'text-ink-2')}>
          {signedMoney(day.pnl_usd)}
        </span>
      </div>
      <dl className="mt-4 divide-y divide-rule/70 border-y border-rule/70">
        {parts(account).map(({ key, label }) => (
          <Row key={key} label={label} value={day.parts ? day.parts[key] : null} />
        ))}
      </dl>
    </aside>
  )
}
