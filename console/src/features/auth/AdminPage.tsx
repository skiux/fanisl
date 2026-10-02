import { useState, type FormEvent, type ReactNode } from 'react'
import { CaretRight, PencilSimple, Plus } from '@phosphor-icons/react'
import { fetchFund, saveFundMember, saveFundSettings } from '../../api/client'
import { ApiError } from '../../api/http'
import {
  createUser, deleteUser, getSession, listUsers, resetPassword, updateUser,
  type Role, type User,
} from '../../api/session'
import { PortfolioError, type FundMember, type FundSnapshot } from '../../api/types'
import { Swatch } from '../../components/AllocationWheel'
import { SegmentedControl } from '../../components/controls'
import { DatePicker, yearsAround } from '../../components/DatePicker'
import { Module, Stack, ViewGrid } from '../../components/layout'
import { PersonMark, personColor } from '../../components/PersonMark'
import { Sheet } from '../../components/Sheet'
import { cn } from '../../lib/cn'
import { money, percent, ratio, relativeTime } from '../../lib/format'
import { capitalShare, profitShare } from '../../lib/fund'
import { usePageData } from '../../lib/pageData'
import { hrefOf } from '../../lib/router'
import { Masthead } from '../portfolio/Masthead'
import { ErrorState, PermissionState } from '../portfolio/states'

const ROLE_LABEL: Record<Role, string> = { admin: '管理员', member: '成员' }
const DAY_MS = 86_400_000

/**
 * 用户。只有管理员能进——后端会 403，这里也不渲染，两头都拦。入口在底栏。
 *
 * 一页管两件事：谁能登录（权限 管理员 / 成员，`auth/`），以及账户的盈亏怎么分
 * （初始净值、现金、每个成员的角色与比例，`binance/fund.py`）。
 *
 * **页面上只放读数，改什么点开改。** 第一版把新建表单、账户表单、九列的用户表和
 * 每行五个文字按钮全摊在页面上，起始日还用了系统画的日期框，2026-10-03 被评"太敷衍"。
 * 现在左边是人，右边是账户与分配；点一个人、点「编辑」、点「新建」都开一张纸。
 *
 * 几条规则由后端保证（最后一个在岗管理员不能停用/降级/删除、不能删自己、
 * 管理员不能设 Manager / Investor），这里不重复实现，只把 409 的原话显示出来。
 */
type AdminData = { users: User[]; fund: FundSnapshot }

async function loadAdmin(signal?: AbortSignal): Promise<AdminData> {
  try {
    const [users, fund] = await Promise.all([listUsers(), fetchFund('live', signal)])
    return { users, fund }
  } catch (error) {
    // 用户接口的失败是 ApiError：转成页面数据层认的那一种，原话才显示得出来
    if (error instanceof ApiError && error.status !== 401) {
      throw new PortfolioError('server', error.message)
    }
    throw error
  }
}

type Person = { user: User; member: FundMember | null }
type Open = { kind: 'fund' } | { kind: 'create' } | { kind: 'person'; id: number } | null

export function AdminPage() {
  const session = getSession()
  const me = session.status === 'authenticated' ? session.user : null
  const isAdmin = me?.role === 'admin'
  // 与三个数据页同一套取数：切回来先显示上一次的，再静默更新
  const { phase, revealed, refreshing, retry, accept } = usePageData({
    scope: 'admin',
    load: (signal) => loadAdmin(signal),
    failure: '读取用户列表失败',
    refreshEveryMs: 60_000,
    autoRefresh: isAdmin,
  })
  const [open, setOpen] = useState<Open>(null)

  const reload = async () => accept(await loadAdmin())

  return (
    <div className="min-h-[100dvh] bg-desk px-3 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-6">
      <div className="sheet mx-auto flex max-w-[1420px] flex-col">
        <Masthead asOf={null} onRefresh={retry} page="admin" refreshing={refreshing} sources={[]} title="用户" />

        {!isAdmin ? (
          <div className="px-6 sm:px-10">
            <PermissionState message="用户管理只对管理员开放。要开账号或改口令，找管理员。" />
          </div>
        ) : phase.kind === 'failed' ? (
          <div className="px-6 sm:px-10"><ErrorState message={phase.message} onRetry={retry} /></div>
        ) : (
          <div className="px-5 py-7 pb-28 sm:px-10 sm:py-8 sm:pb-28">
            {phase.kind === 'loading' ? <AdminSkeleton /> : (
              <div className={revealed ? 'rise' : undefined}>
                <Board data={phase.snapshot} meId={me.id} onOpen={setOpen} />
              </div>
            )}
          </div>
        )}
      </div>

      {phase.kind === 'ready' && open?.kind === 'fund' && (
        <FundSheet fund={phase.snapshot.fund} onClose={() => setOpen(null)} onSaved={reload} />
      )}
      {phase.kind === 'ready' && open?.kind === 'create' && (
        <CreateSheet onClose={() => setOpen(null)} onSaved={reload} />
      )}
      {phase.kind === 'ready' && open?.kind === 'person' && (() => {
        const person = peopleOf(phase.snapshot).find((p) => p.user.id === open.id)
        return person ? (
          <PersonSheet
            fund={phase.snapshot.fund}
            isMe={person.user.id === me?.id}
            onClose={() => setOpen(null)}
            onSaved={reload}
            person={person}
          />
        ) : null
      })()}
    </div>
  )
}

/** 参与分配的在前（出资大的在前），其余成员，管理员最后 */
function peopleOf({ users, fund }: AdminData): Person[] {
  const byId = new Map(fund.members.map((member) => [member.user_id, member]))
  const rank = (p: Person) => (p.member ? 0 : p.user.role === 'member' ? 1 : 2)
  return users.map((user) => ({ user, member: byId.get(user.id) ?? null }))
    .sort((a, b) => rank(a) - rank(b)
      || (b.member?.invested_capital_usd ?? 0) - (a.member?.invested_capital_usd ?? 0)
      || a.user.id - b.user.id)
}

const nameOf = (user: User) => user.display_name || user.username
const activityOf = (user: User) => (user.last_seen_at ? `在线 ${relativeTime(user.last_seen_at)}`
  : user.last_login_at ? `登录 ${relativeTime(user.last_login_at)}` : '从未登录')

function Board({ data, meId, onOpen }: { data: AdminData; meId: number; onOpen: (open: Open) => void }) {
  const people = peopleOf(data)
  return (
    <ViewGrid>
      <Module
        action={<HeadAction icon={<Plus aria-hidden="true" size={12} />} label="新建" onClick={() => onOpen({ kind: 'create' })} />}
        figure={`${people.length} 人`}
        span="self-start lg:col-span-7"
        title="成员"
      >
        <PeopleList initialNav={data.fund.settings.initial_nav_usd} meId={meId}
                    onOpen={(id) => onOpen({ kind: 'person', id })} people={people} />
      </Module>
      <Stack span="lg:col-span-5">
        <FundModule fund={data.fund} onEdit={() => onOpen({ kind: 'fund' })} />
        <ShareModule fund={data.fund} people={people} />
      </Stack>
    </ViewGrid>
  )
}

function HeadAction({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      className="flex items-center gap-1 text-xs text-ink-3 transition-colors duration-200 hover:text-ink"
      onClick={onClick}
      type="button"
    >
      {icon}{label}
    </button>
  )
}

function Tag({ children, tone }: { children: ReactNode; tone?: 'loss' | 'quiet' }) {
  return (
    <span className={cn('shrink-0 rounded-[4px] px-1.5 py-px text-micro leading-tight',
      tone === 'loss' ? 'border border-loss/40 text-loss'
        : tone === 'quiet' ? 'bg-sheet-2 text-ink-2' : 'border border-rule-strong text-ink-2')}>
      {children}
    </span>
  )
}

function PeopleList({ people, meId, initialNav, onOpen }: {
  people: Person[]
  meId: number
  initialNav: number | null
  onOpen: (id: number) => void
}) {
  if (people.length === 0) return <p className="py-10 text-center text-sm text-ink-3">还没有用户。</p>
  return (
    <ul className="-mx-2">
      {people.map(({ user, member }) => (
        <li key={user.id}>
          <button
            className={cn(
              'group grid w-full grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3.5 rounded-[var(--radius-control)]',
              'px-2 py-3 text-left outline-none transition-colors duration-200 hover:bg-sheet-2/60',
              'focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent',
              !user.is_active && 'opacity-60',
            )}
            onClick={() => onOpen(user.id)}
            type="button"
          >
            <PersonMark name={nameOf(user)} username={user.username} />
            <span className="min-w-0">
              {/* 名字优先：窄屏放不下时标签折到下一行，而不是把名字挤成「A…」 */}
              <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <span className="max-w-full shrink-0 truncate text-sm text-ink">{nameOf(user)}</span>
                {member?.is_manager && <Tag>Manager</Tag>}
                {member?.is_investor && <Tag>Investor</Tag>}
                {user.id === meId && <Tag tone="quiet">你</Tag>}
                {!user.is_active && <Tag tone="loss">已停用</Tag>}
              </span>
              <span className="mt-0.5 block truncate text-micro text-ink-3">
                <span className="font-mono">{user.username}</span> · {ROLE_LABEL[user.role]} · {activityOf(user)}
              </span>
            </span>
            <span className="text-right">
              {member && (
                <>
                  <span className="tnum block text-sm text-ink">{money(member.invested_capital_usd)}</span>
                  <span className="tnum mt-0.5 block text-micro text-ink-3">
                    {initialNav ? percent(capitalShare(member, initialNav), 1) : '—'}
                  </span>
                </>
              )}
            </span>
            <CaretRight aria-hidden="true" className="text-ink-3/40 transition-colors duration-200 group-hover:text-ink-2" size={12} />
          </button>
        </li>
      ))}
    </ul>
  )
}

function ReadRow({ label, value, tone }: { label: string; value: ReactNode; tone?: 'warn' }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className={cn('tnum text-sm', tone === 'warn' ? 'text-accent' : 'text-ink')}>{value}</dd>
    </div>
  )
}

function FundModule({ fund, onEdit }: { fund: FundSnapshot; onEdit: () => void }) {
  const { settings, members } = fund
  const capital = members.reduce((sum, m) => sum + m.invested_capital_usd, 0)
  const days = settings.inception_date
    ? Math.floor((Date.now() - Date.parse(`${settings.inception_date}T00:00:00Z`)) / DAY_MS) : null
  return (
    <Module
      action={<HeadAction icon={<PencilSimple aria-hidden="true" size={12} />} label="编辑" onClick={onEdit} />}
      span=""
      title="账户"
    >
      <dl className="divide-y divide-rule/70 border-b border-rule/70">
        <ReadRow label="Initial NAV" value={money(settings.initial_nav_usd)} />
        <ReadRow
          label="Inception Date"
          value={settings.inception_date
            ? `${settings.inception_date}${days !== null && days >= 0 ? ` · ${days} 天` : ''}` : '—'}
        />
        <ReadRow label="现金" value={money(settings.cash_usd)} />
        {/* 出资合计对不上初始净值时变金色：各人的账户加起来就不等于整个账户了 */}
        <ReadRow
          label="Invested Capital"
          tone={settings.initial_nav_usd !== null && members.length > 0
            && Math.abs(capital - settings.initial_nav_usd) > 0.005 ? 'warn' : undefined}
          value={members.length > 0 ? money(capital) : '—'}
        />
        <ReadRow label="Management Fee" value={members.some((m) => m.is_manager) ? ratio(fund.management_fee_total) : '—'} />
      </dl>
    </Module>
  )
}

/**
 * 盈利与亏损各分给谁：两条比例条共用一份图例。盈利按
 * Performance Fee + 出资占比 × Investor Return（`lib/fund.ts`），亏损按 Loss Allocation；
 * 没分完的归公司，超过 100% 就是规则录错了，合计变金色。
 */
function ShareModule({ fund, people }: { fund: FundSnapshot; people: Person[] }) {
  const initialNav = fund.settings.initial_nav_usd
  const participants = people.filter((p): p is Person & { member: FundMember } => p.member !== null)
  if (participants.length === 0) {
    return (
      <Module span="" title="分配">
        <p className="py-6 text-sm text-ink-3">—</p>
      </Module>
    )
  }
  const rows = participants.map(({ user, member }) => ({
    key: user.username,
    name: nameOf(user),
    color: personColor(user.username),
    profit: initialNav ? profitShare(member, initialNav) : null,
    loss: member.loss_allocation,
  }))
  const profitTotal = initialNav ? rows.reduce((sum, row) => sum + (row.profit ?? 0), 0) : null
  const lossTotal = rows.reduce((sum, row) => sum + row.loss, 0)
  const company = {
    profit: profitTotal === null ? null : Math.max(0, 1 - profitTotal),
    loss: Math.max(0, 1 - lossTotal),
  }

  return (
    <Module span="" title="分配">
      <ShareBar
        label="盈利"
        rows={rows.map((row) => ({ key: row.key, color: row.color, value: row.profit ?? 0 }))}
        total={profitTotal}
      />
      <ShareBar
        label="亏损"
        rows={rows.map((row) => ({ key: row.key, color: row.color, value: row.loss }))}
        total={lossTotal}
      />
      <table className="mt-5 w-full text-xs">
        <thead>
          <tr className="border-b border-rule text-micro text-ink-3">
            <th className="pb-2 text-left font-normal" />
            <th className="pb-2 text-right font-normal">盈利</th>
            <th className="w-20 pb-2 text-right font-normal">亏损</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-rule/70">
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="py-2.5"><span className="flex items-center gap-2 text-ink-2"><Swatch color={row.color} />{row.name}</span></td>
              <td className="tnum py-2.5 text-right text-ink">{row.profit === null ? '—' : percent(row.profit, 1)}</td>
              <td className="tnum py-2.5 text-right text-ink">{percent(row.loss, 1)}</td>
            </tr>
          ))}
          {((company.profit ?? 0) > 0.0005 || company.loss > 0.0005) && (
            <tr>
              <td className="py-2.5"><span className="flex items-center gap-2 text-ink-3"><Swatch className="bg-sheet-2 ring-1 ring-inset ring-rule-strong" color="transparent" />公司</span></td>
              <td className="tnum py-2.5 text-right text-ink-3">{company.profit === null ? '—' : percent(company.profit, 1)}</td>
              <td className="tnum py-2.5 text-right text-ink-3">{percent(company.loss, 1)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </Module>
  )
}

function ShareBar({ label, rows, total }: {
  label: string
  rows: { key: string; color: string; value: number }[]
  total: number | null
}) {
  // 超过 100% 时按合计缩放，条不溢出；数字照实写、变金色
  const scale = total !== null && total > 1 ? total : 1
  return (
    <div className="mb-3.5">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-xs text-ink-3">{label}</span>
        <span className={cn('tnum text-xs', total !== null && total > 1 + 1e-9 ? 'text-accent' : 'text-ink-2')}>
          {total === null ? '—' : percent(total, 1)}
        </span>
      </div>
      <span aria-hidden="true" className="flex h-[7px] gap-px overflow-hidden rounded-full bg-sheet-2">
        {rows.filter((row) => row.value > 0).map((row) => (
          <span className="block transition-[width] duration-500" key={row.key}
                style={{ width: `${(row.value / scale) * 100}%`, background: row.color }} />
        ))}
      </span>
    </div>
  )
}

/* ------------------------------- 纸上的表单 ------------------------------- */

const inputClass = cn(
  'tnum h-10 w-full min-w-0 rounded-[7px] border border-rule-strong bg-sheet px-3 text-sm text-ink outline-none',
  'transition-[border-color,box-shadow] duration-200 placeholder:text-ink-3',
  'focus:border-ink focus:shadow-[0_0_0_3px_var(--accent-soft)] disabled:opacity-50',
)

function Field({ label, htmlFor, unit, children }: {
  label: string
  htmlFor?: string
  unit?: string
  children: ReactNode
}) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <label className="text-xs text-ink-2" htmlFor={htmlFor}>{label}</label>
      <div className="relative">
        {children}
        {unit && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-ink-3">{unit}</span>}
      </div>
    </div>
  )
}

/** 输入框里的数：空着就是没录（null），不是 0 */
const parseAmount = (text: string) => {
  const value = Number(text.replace(/,/g, '').trim())
  return text.trim() === '' || !Number.isFinite(value) ? null : value
}
const asText = (value: number | null | undefined) => (value == null ? '' : String(value))
/** 比例按百分数录：填 30 存 0.3 */
const asPercentText = (value: number) => String(Number((value * 100).toFixed(4)))

function Actions({ busy, label, disabled = false, onCancel }: {
  busy: boolean
  label: string
  disabled?: boolean
  onCancel: () => void
}) {
  return (
    <div className="mt-6 flex items-center justify-end gap-3 border-t border-rule pt-4">
      <button
        className="rounded-[6px] px-2.5 py-1.5 text-xs text-ink-3 transition-colors duration-150 hover:text-ink"
        onClick={onCancel}
        type="button"
      >
        取消
      </button>
      <button
        className={cn('min-w-[72px] rounded-[6px] bg-ink px-3.5 py-2 text-xs text-sheet',
          'transition-[opacity,transform] duration-150 hover:opacity-85 active:translate-y-px',
          'disabled:cursor-default disabled:opacity-35')}
        disabled={busy || disabled}
        type="submit"
      >
        {busy ? '保存中' : label}
      </button>
    </div>
  )
}

function Problem({ message }: { message: string | null }) {
  if (!message) return null
  return <p className="mt-4 border-l-2 border-loss bg-loss/[0.07] px-3 py-2 text-xs text-loss" role="alert">{message}</p>
}

/** 一张纸里的一次写操作：忙、错误、成功后刷新列表 */
function useAct(onSaved: () => Promise<void>) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return false
    setBusy(true)
    setError(null)
    try {
      await fn()
      await onSaved()
      return true
    } catch (e) {
      setError(e instanceof ApiError || e instanceof PortfolioError ? e.message : '操作失败')
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

function FundSheet({ fund, onClose, onSaved }: {
  fund: FundSnapshot
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { settings } = fund
  const [initial, setInitial] = useState(asText(settings.initial_nav_usd))
  const [inception, setInception] = useState<string | null>(settings.inception_date)
  const [cash, setCash] = useState(asText(settings.cash_usd))
  const { busy, error, run } = useAct(onSaved)
  const range = yearsAround(10, 1)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void run(() => saveFundSettings({
      initial_nav_usd: parseAmount(initial),
      inception_date: inception,
      cash_usd: parseAmount(cash),
    })).then((ok) => { if (ok) onClose() })
  }

  return (
    <Sheet onClose={onClose} title="账户" width="26rem">
      <form className="grid gap-4" onSubmit={submit}>
        <Field htmlFor="fund-initial" label="Initial NAV" unit="USD">
          <input autoFocus className={cn(inputClass, 'pr-12')} disabled={busy} id="fund-initial" inputMode="decimal"
                 onChange={(e) => setInitial(e.target.value)} value={initial} />
        </Field>
        <Field htmlFor="fund-inception" label="Inception Date">
          <DatePicker disabled={busy} id="fund-inception" label="Inception Date" max={range.max} min={range.min}
                      onChange={setInception} value={inception} />
        </Field>
        <Field htmlFor="fund-cash" label="现金" unit="USD">
          <input className={cn(inputClass, 'pr-12')} disabled={busy} id="fund-cash" inputMode="decimal"
                 onChange={(e) => setCash(e.target.value)} value={cash} />
        </Field>
        <Problem message={error} />
        {/* 录了初始净值就要有起始日：管理费按天计提，账户日历也从这一天开始 */}
        <Actions busy={busy} disabled={parseAmount(initial) !== null && !inception} label="保存" onCancel={onClose} />
      </form>
    </Sheet>
  )
}

function CreateSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('member')
  const { busy, error, run } = useAct(onSaved)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void run(() => createUser({ username, password, role, display_name: displayName }))
      .then((ok) => { if (ok) onClose() })
  }

  return (
    <Sheet onClose={onClose} title="新建用户" width="26rem">
      <form className="grid gap-4" onSubmit={submit}>
        <Field htmlFor="new-username" label="用户名">
          <input autoCapitalize="none" autoCorrect="off" autoFocus className={inputClass} disabled={busy}
                 id="new-username" onChange={(e) => setUsername(e.target.value)}
                 placeholder="字母、数字、下划线、连字符" required value={username} />
        </Field>
        <Field htmlFor="new-display" label="显示名">
          <input className={inputClass} disabled={busy} id="new-display"
                 onChange={(e) => setDisplayName(e.target.value)} value={displayName} />
        </Field>
        <Field htmlFor="new-password" label="初始口令">
          <input autoComplete="new-password" className={inputClass} disabled={busy} id="new-password"
                 minLength={10} onChange={(e) => setPassword(e.target.value)} required
                 type="password" value={password} />
        </Field>
        {password && password.length < 10 && (
          <p className="-mt-2 text-micro text-loss">还差 {10 - password.length} 位</p>
        )}
        <div className="flex items-center justify-between gap-4 pt-1">
          <span className="text-xs text-ink-2">权限</span>
          <SegmentedControl
            items={[{ value: 'member', label: '成员' }, { value: 'admin', label: '管理员' }]}
            label="权限"
            onValueChange={setRole}
            size="sm"
            value={role}
          />
        </div>
        <Problem message={error} />
        <Actions busy={busy} disabled={!username || password.length < 10} label="新建" onCancel={onClose} />
      </form>
    </Sheet>
  )
}

type Ratio = 'loss_allocation' | 'management_fee' | 'performance_fee' | 'investor_return'
const RATIOS: { key: Ratio; label: string }[] = [
  { key: 'loss_allocation', label: 'Loss Allocation' },
  { key: 'management_fee', label: 'Management Fee' },
  { key: 'performance_fee', label: 'Performance Fee' },
  { key: 'investor_return', label: 'Investor Return' },
]

/**
 * 一个人：上半是分配（只给成员），下半是账号（权限、停用、口令、删除）。
 * 分配要点「保存」才写；账号那几项是单个动作，点了就生效——与第一版的行内按钮一致。
 */
function PersonSheet({ person, fund, isMe, onClose, onSaved }: {
  person: Person
  fund: FundSnapshot
  isMe: boolean
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { user, member } = person
  return (
    <Sheet
      leading={<PersonMark name={nameOf(user)} size="lg" username={user.username} />}
      onClose={onClose}
      subtitle={<><span className="font-mono">{user.username}</span> · {ROLE_LABEL[user.role]} · {activityOf(user)}</>}
      title={nameOf(user)}
      width="34rem"
    >
      {user.role === 'member' && (
        <AllocationForm fund={fund} member={member} onClose={onClose} onSaved={onSaved} user={user} />
      )}
      <AccountControls isMe={isMe} onClose={onClose} onSaved={onSaved} user={user} />
    </Sheet>
  )
}

function AllocationForm({ user, member, fund, onClose, onSaved }: {
  user: User
  member: FundMember | null
  fund: FundSnapshot
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [manager, setManager] = useState(member?.is_manager ?? false)
  const [investor, setInvestor] = useState(member?.is_investor ?? false)
  const [capital, setCapital] = useState(asText(member?.invested_capital_usd))
  const [rates, setRates] = useState(() => Object.fromEntries(RATIOS.map(({ key }) => [
    key, member ? asPercentText(member[key]) : '',
  ])) as Record<Ratio, string>)
  const { busy, error, run } = useAct(onSaved)

  const shown = RATIOS.filter(({ key }) => key === 'loss_allocation'
    || (key === 'investor_return' ? investor : manager))
  const fraction = (key: Ratio) => (parseAmount(rates[key]) ?? 0) / 100
  const participant = manager || investor
  const invalid = participant && (parseAmount(capital) === null
    || shown.some(({ key }) => { const v = parseAmount(rates[key]); return v !== null && (v < 0 || v > 100) }))
  const draft: FundMember = {
    ...(member ?? { user_id: user.id, username: user.username, display_name: nameOf(user), updated_at: null }),
    is_manager: manager, is_investor: investor,
    invested_capital_usd: parseAmount(capital) ?? 0,
    loss_allocation: fraction('loss_allocation'), management_fee: fraction('management_fee'),
    performance_fee: fraction('performance_fee'), investor_return: fraction('investor_return'),
  }
  const initialNav = fund.settings.initial_nav_usd

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void run(() => saveFundMember(user.id, {
      is_manager: draft.is_manager, is_investor: draft.is_investor,
      invested_capital_usd: draft.invested_capital_usd, loss_allocation: draft.loss_allocation,
      management_fee: draft.management_fee, performance_fee: draft.performance_fee,
      investor_return: draft.investor_return,
    })).then((ok) => { if (ok) onClose() })
  }

  const id = (key: string) => `member-${user.id}-${key}`
  const toggle = (active: boolean) => cn(
    'rounded-full px-3.5 py-1.5 text-xs outline-none transition-colors duration-200',
    'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent',
    active ? 'bg-ink text-sheet' : 'border border-rule-strong text-ink-2 hover:border-ink-3 hover:text-ink',
  )

  return (
    <form onSubmit={submit}>
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-xs text-ink-2">分配</h3>
        <div aria-label="角色" className="flex gap-2" role="group">
          <button aria-pressed={manager} className={toggle(manager)} disabled={busy}
                  onClick={() => setManager(!manager)} type="button">Manager</button>
          <button aria-pressed={investor} className={toggle(investor)} disabled={busy}
                  onClick={() => setInvestor(!investor)} type="button">Investor</button>
        </div>
      </div>

      {participant && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4">
            <div className="col-span-2">
              <Field htmlFor={id('capital')} label="Invested Capital" unit="USD">
                <input className={cn(inputClass, 'pr-12')} disabled={busy} id={id('capital')} inputMode="decimal"
                       onChange={(e) => setCapital(e.target.value)} required value={capital} />
              </Field>
            </div>
            {shown.map(({ key, label }) => (
              <Field htmlFor={id(key)} key={key} label={label} unit="%">
                <input className={cn(inputClass, 'pr-8')} disabled={busy} id={id(key)} inputMode="decimal"
                       onChange={(e) => setRates((prev) => ({ ...prev, [key]: e.target.value }))}
                       placeholder="0" value={rates[key]} />
              </Field>
            ))}
          </div>
          {/* 按现在填的数，这个人的出资占比、分到总盈利多少、承担亏损多少——和页面右栏同一个算法 */}
          <dl className="mt-5 grid grid-cols-3 gap-4 rounded-[var(--radius-control)] bg-sheet-2/60 px-4 py-3">
            <Readout label="出资占比" value={initialNav ? percent(capitalShare(draft, initialNav), 1) : '—'} />
            <Readout label="盈利" value={initialNav ? percent(profitShare(draft, initialNav), 1) : '—'} />
            <Readout label="亏损" value={percent(draft.loss_allocation, 1)} />
          </dl>
        </>
      )}
      <Problem message={error} />
      <Actions busy={busy} disabled={invalid || (!participant && !member)}
               label={participant || !member ? '保存' : '移出分配'} onCancel={onClose} />
    </form>
  )
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-micro text-ink-3">{label}</dt>
      <dd className="tnum mt-1 text-sm text-ink">{value}</dd>
    </div>
  )
}

function AccountControls({ user, isMe, onClose, onSaved }: {
  user: User
  isMe: boolean
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [mode, setMode] = useState<'idle' | 'reset' | 'delete'>('idle')
  const [password, setPassword] = useState('')
  const { busy, error, run } = useAct(onSaved)

  if (isMe) {
    return (
      <section className={cn(user.role === 'member' && 'mt-7 border-t border-rule pt-5')}>
        <a className="text-xs text-ink-3 underline-offset-4 hover:text-ink-2 hover:underline" href={hrefOf('account')}>
          在「账号」里改自己的口令
        </a>
      </section>
    )
  }

  const line = 'flex min-h-10 items-center justify-between gap-4 py-2'
  return (
    <section className={cn(user.role === 'member' && 'mt-7 border-t border-rule pt-5')}>
      <h3 className="mb-1 text-xs text-ink-2">账号</h3>
      <div className="divide-y divide-rule/70">
        <div className={line}>
          <span className="text-xs text-ink-3">权限</span>
          <SegmentedControl
            items={[{ value: 'member', label: '成员' }, { value: 'admin', label: '管理员' }]}
            label="权限"
            onValueChange={(role) => { if (role !== user.role) void run(() => updateUser(user.id, { role })) }}
            size="sm"
            value={user.role}
          />
        </div>
        <div className={line}>
          <span className="text-xs text-ink-3">状态</span>
          <SegmentedControl
            items={[{ value: 'on', label: '启用' }, { value: 'off', label: '停用' }]}
            label="状态"
            onValueChange={(next) => {
              const active = next === 'on'
              if (active !== user.is_active) void run(() => updateUser(user.id, { is_active: active }))
            }}
            size="sm"
            value={user.is_active ? 'on' : 'off'}
          />
        </div>
        <div className={line}>
          <span className="text-xs text-ink-3">口令</span>
          {mode === 'reset' ? (
            <form
              className="flex items-center gap-3"
              onSubmit={(event) => {
                event.preventDefault()
                void run(() => resetPassword(user.id, password)).then((ok) => {
                  if (ok) { setMode('idle'); setPassword('') }
                })
              }}
            >
              <input
                aria-label={`${user.username} 的新口令`}
                autoFocus
                className="w-40 border-b border-rule-strong bg-transparent pb-1 text-xs text-ink outline-none placeholder:text-ink-3 focus:border-ink"
                minLength={10}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="新口令，至少 10 位"
                required
                type="password"
                value={password}
              />
              <button className="text-xs text-ink disabled:opacity-35" disabled={busy || password.length < 10} type="submit">确定</button>
              <button className="text-xs text-ink-3 hover:text-ink" onClick={() => { setMode('idle'); setPassword('') }} type="button">取消</button>
            </form>
          ) : (
            <button className="text-xs text-ink-2 transition-colors hover:text-ink" onClick={() => setMode('reset')} type="button">
              重置口令
            </button>
          )}
        </div>
        <div className={line}>
          <span className="text-xs text-ink-3">删除</span>
          {mode === 'delete' ? (
            <span className="flex items-center gap-3">
              <span className="text-xs text-ink-2">删除后无法恢复</span>
              <button
                className="text-xs text-loss disabled:opacity-35"
                disabled={busy}
                onClick={() => void run(() => deleteUser(user.id)).then((ok) => { if (ok) onClose() })}
                type="button"
              >
                确认删除
              </button>
              <button className="text-xs text-ink-3 hover:text-ink" onClick={() => setMode('idle')} type="button">取消</button>
            </span>
          ) : (
            <button className="text-xs text-ink-3 transition-colors hover:text-loss" onClick={() => setMode('delete')} type="button">
              删除用户
            </button>
          )}
        </div>
      </div>
      <Problem message={error} />
    </section>
  )
}

function AdminSkeleton() {
  return (
    <div aria-busy="true" aria-label="正在读取用户" className="skeleton-reveal grid gap-12 lg:grid-cols-12">
      <div className="lg:col-span-7">
        <div className="skel mb-4 h-4 w-20" />
        {[0, 1, 2, 3].map((index) => (
          <div className="flex items-center gap-3.5 py-3" key={index}>
            <div className="skel size-8 rounded-full" />
            <div className="flex-1 space-y-2"><div className="skel h-3.5 w-32" /><div className="skel h-3 w-48" /></div>
            <div className="skel h-3.5 w-20" />
          </div>
        ))}
      </div>
      <div className="space-y-3 lg:col-span-5">
        <div className="skel mb-4 h-4 w-16" />
        {[0, 1, 2, 3, 4].map((index) => <div className="skel h-3.5 w-full" key={index} />)}
      </div>
    </div>
  )
}
