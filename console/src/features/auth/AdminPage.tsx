import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Plus } from '@phosphor-icons/react'
import { fetchFund, saveFundMember, saveFundSettings } from '../../api/client'
import { ApiError } from '../../api/http'
import {
  createUser, deleteUser, getSession, listUsers, resetPassword, updateUser,
  type Role, type User,
} from '../../api/session'
import type { FundMember, FundSnapshot } from '../../api/types'
import { Module, ViewGrid } from '../../components/layout'
import { cn } from '../../lib/cn'
import { money, ratio, relativeTime } from '../../lib/format'
import { hrefOf } from '../../lib/router'
import { Masthead } from '../portfolio/Masthead'
import { PermissionState } from '../portfolio/states'

const ROLE_LABEL: Record<Role, string> = { admin: '管理员', member: '成员' }

/**
 * 用户。只有管理员能进——后端会 403，这里也不渲染，两头都拦。入口在底部导航。
 *
 * 一页管两件事：谁能登录（权限 admin / member，见 `auth/`），以及账户的盈亏怎么分
 * （初始净值、现金、每个成员的角色与比例，见 `binance/fund.py`）。后者只给成员：
 * 管理员不参与分配，列表里管理员那几行没有「分配」。
 *
 * 几条规则由后端保证（最后一个在岗管理员不能停用/降级/删除、不能删自己、
 * 管理员不能设 Manager / Investor），这里不重复实现，只把 409 的原话显示出来。
 * 前端复制一遍判定逻辑必然会与后端漂移，而漂移的方向通常是前端更松。
 */
export function AdminPage() {
  const session = getSession()
  const me = session.status === 'authenticated' ? session.user : null

  const [users, setUsers] = useState<User[] | null>(null)
  const [fund, setFund] = useState<FundSnapshot | null>(null)
  const [failed, setFailed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    setFailed(false)
    try {
      const [nextUsers, nextFund] = await Promise.all([listUsers(), fetchFund('live')])
      setUsers(nextUsers)
      setFund(nextFund)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '读取用户列表失败')
      // **失败要落地，但不能落成空列表。** 不动 users 的话上面挂着报错、下面
      // 还转着"正在读取…"；落成 `[]` 又会显示"还没有用户"——把"读失败"说成
      // "没有用户"，和"空账户 vs 取不到"是同一类错。所以单独一个失败态。
      setFailed(true)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const act = async (fn: () => Promise<unknown>) => {
    if (busy) return false
    setBusy(true)
    setError(null)
    try {
      await fn()
      await load()
      return true
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '操作失败')
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-[100dvh] bg-desk px-3 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-6">
      {/* 内容不多，纸张按内容收——钉在视口高度只会在下面留一大片空白 */}
      <div className="sheet mx-auto flex max-w-[1420px] flex-col">
        <Masthead asOf={null} onRefresh={() => { void load() }} page="admin"
                  refreshing={false} sources={[]} title="用户" />

        {me?.role !== 'admin' ? (
          <div className="px-6 sm:px-10">
            <PermissionState message="用户管理只对管理员开放。要开账号或改口令，找管理员。" />
          </div>
        ) : (
          <div className="min-h-0 flex-1 px-5 py-7 pb-28 sm:px-10 sm:py-8 sm:pb-28">
            <div className="rise">
              {error && (
                <p className="mb-6 rounded-[var(--radius-control)] border-l-2 border-loss bg-loss/[0.07] px-3 py-2.5 text-xs text-loss"
                   role="alert">
                  {error}
                </p>
              )}
              <ViewGrid>
                <Module figure={users ? `${users.length} 人` : '—'} span="lg:col-span-12" title="用户">
                  <UserTable busy={busy} failed={failed} fund={fund} meId={me.id} onAct={act} users={users} />
                </Module>
                <Module span="lg:col-span-7" title="账户">
                  {fund ? <FundForm busy={busy} fund={fund} key={fund.settings.updated_at ?? 'unset'} onAct={act} />
                    : <p className="py-6 text-sm text-ink-3">{failed ? '本次未取到。' : '正在读取…'}</p>}
                </Module>
                <Module span="lg:col-span-5" title="新建用户">
                  <CreateForm busy={busy} onAct={act} />
                </Module>
              </ViewGrid>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

type Act = (fn: () => Promise<unknown>) => Promise<boolean>

const input = cn(
  'tnum h-9 w-full min-w-0 rounded-[var(--radius-control)] border border-rule bg-sheet-2/50',
  'px-3 text-sm text-ink outline-none transition-colors duration-200',
  'hover:border-rule-strong focus-visible:border-accent disabled:opacity-50',
)

function Field({ label, htmlFor, children, suffix }: {
  label: string
  htmlFor: string
  children: ReactNode
  suffix?: string
}) {
  return (
    <div className="min-w-0">
      <label className="text-xs text-ink-3" htmlFor={htmlFor}>{label}</label>
      <div className="relative mt-1.5">
        {children}
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-ink-3">
            {suffix}
          </span>
        )}
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

const todayUtc = () => new Date().toISOString().slice(0, 10)

function FundForm({ fund, busy, onAct }: { fund: FundSnapshot; busy: boolean; onAct: Act }) {
  const { settings, members } = fund
  const [initial, setInitial] = useState(asText(settings.initial_nav_usd))
  const [inception, setInception] = useState(settings.inception_date ?? '')
  const [cash, setCash] = useState(asText(settings.cash_usd))

  const capital = members.reduce((sum, m) => sum + m.invested_capital_usd, 0)
  const profitShare = members.reduce((sum, m) => sum + m.performance_fee + m.investor_return, 0)
  const lossShare = members.reduce((sum, m) => sum + m.loss_allocation, 0)
  const over = (value: number) => value > 1 + 1e-9

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const initialNav = parseAmount(initial)
    void onAct(() => saveFundSettings({
      initial_nav_usd: initialNav,
      // 录了初始净值却没填起始日：按今天算，否则管理费和账户日历都没有起点
      inception_date: inception || (initialNav !== null ? todayUtc() : null),
      cash_usd: parseAmount(cash),
    }))
  }

  return (
    <form className="space-y-6" onSubmit={submit}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
        <Field htmlFor="fund-initial" label="初始净值" suffix="USD">
          <input className={cn(input, 'pr-12')} disabled={busy} id="fund-initial" inputMode="decimal"
                 onChange={(e) => setInitial(e.target.value)} value={initial} />
        </Field>
        <Field htmlFor="fund-inception" label="起始日">
          <input className={input} disabled={busy} id="fund-inception"
                 onChange={(e) => setInception(e.target.value)} type="date" value={inception} />
        </Field>
        <Field htmlFor="fund-cash" label="现金" suffix="USD">
          <input className={cn(input, 'pr-12')} disabled={busy} id="fund-cash" inputMode="decimal"
                 onChange={(e) => setCash(e.target.value)} value={cash} />
        </Field>
        <SubmitButton busy={busy} label="保存" />
      </div>

      {/* 合计：出资对得上初始净值、两种比例都不超过 100%，各人的账户加起来才等于整个账户 */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-rule pt-4 sm:grid-cols-4">
        <Total label="Invested Capital" value={money(capital)}
               warn={settings.initial_nav_usd !== null && Math.abs(capital - settings.initial_nav_usd) > 0.005} />
        <Total label="盈利分成" value={ratio(profitShare)} warn={over(profitShare)} />
        <Total label="Loss Allocation" value={ratio(lossShare)} warn={over(lossShare)} />
        <Total label="Management Fee" value={ratio(fund.management_fee_total)} />
      </dl>
    </form>
  )
}

function Total({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className={cn('tnum mt-1.5 text-base', warn ? 'text-accent' : 'text-ink')}>{value}</dd>
    </div>
  )
}

function SubmitButton({ busy, label, disabled = false }: { busy: boolean; label: string; disabled?: boolean }) {
  return (
    <button
      className={cn('h-9 rounded-[var(--radius-control)] bg-ink px-4 text-xs text-sheet',
        'transition-[opacity,transform] duration-150 hover:opacity-85 active:translate-y-px',
        'disabled:cursor-default disabled:opacity-35')}
      disabled={busy || disabled}
      type="submit"
    >
      {label}
    </button>
  )
}

// 列：用户 · 权限 · 角色 · 出资 · 四个比例 · 操作。四个比例的表头是英文全称，
// 1280 以下放不下一列一个，改成一行一行的「名称 数值」，不适用的比例不出现
const ROW = cn(
  'flex flex-wrap items-baseline gap-x-6 gap-y-1.5',
  'xl:grid xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_repeat(4,minmax(5.5rem,0.6fr))_244px] xl:items-center xl:gap-x-4',
)

function Cell({ label, right = false, hidden = false, children }: {
  label: string
  right?: boolean
  /** 窄屏不出现（不适用的比例）；宽屏照常占一列，显示 — */
  hidden?: boolean
  children: ReactNode
}) {
  return (
    <div className={cn('min-w-0 text-xs', right && 'xl:text-right', hidden && 'hidden xl:block')}>
      <span className="mr-1.5 text-ink-3 xl:hidden">{label}</span>
      {children}
    </div>
  )
}

const RATIOS: { key: keyof Pick<FundMember, 'loss_allocation' | 'management_fee' | 'performance_fee' | 'investor_return'>; label: string }[] = [
  { key: 'loss_allocation', label: 'Loss Allocation' },
  { key: 'management_fee', label: 'Management Fee' },
  { key: 'performance_fee', label: 'Performance Fee' },
  { key: 'investor_return', label: 'Investor Return' },
]

/** 这个比例对这个人有没有意义：管理费与业绩报酬只属于 Manager，Investor Return 只属于 Investor */
const applies = (member: FundMember, key: (typeof RATIOS)[number]['key']) =>
  key === 'loss_allocation' || (key === 'investor_return' ? member.is_investor : member.is_manager)

const fundRoles = (member: FundMember | undefined) => (member
  ? [member.is_manager && 'Manager', member.is_investor && 'Investor'].filter(Boolean).join(' · ')
  : '')

function UserTable({ users, fund, failed, meId, busy, onAct }: {
  users: User[] | null
  fund: FundSnapshot | null
  failed: boolean
  meId: number
  busy: boolean
  onAct: Act
}) {
  const [editing, setEditing] = useState<number | null>(null)
  if (failed) return <p className="py-10 text-center text-sm text-ink-3">本次未取到。</p>
  if (users === null) return <p className="py-10 text-center text-sm text-ink-3">正在读取…</p>
  if (users.length === 0) return <p className="py-10 text-center text-sm text-ink-3">还没有用户。</p>

  const byUser = new Map((fund?.members ?? []).map((member) => [member.user_id, member]))

  return (
    <>
      <div className={cn(ROW, 'hidden border-b border-rule pb-2 text-micro text-ink-3 xl:grid')}>
        <span>用户</span>
        <span>权限</span>
        <span>角色</span>
        <span className="text-right">Invested Capital</span>
        {RATIOS.map(({ key, label }) => <span className="text-right" key={key}>{label}</span>)}
        <span className="text-right">操作</span>
      </div>
      <ul className="divide-y divide-rule">
        {users.map((user) => {
          const member = byUser.get(user.id)
          return (
            <li className="py-3" key={user.id}>
              <div className={ROW}>
                <div className="min-w-0 basis-full xl:basis-auto">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm text-ink">{user.display_name || user.username}</span>
                    {user.id === meId && (
                      <span className="rounded-[4px] bg-sheet-2 px-1.5 py-px text-micro text-ink-2">你</span>
                    )}
                    {!user.is_active && (
                      <span className="rounded-[4px] border border-loss/40 px-1 py-px text-micro text-loss">已停用</span>
                    )}
                  </div>
                  <div className="truncate font-mono text-micro text-ink-3">{user.username}</div>
                </div>

                <Cell label="权限">
                  <span className="text-ink-2">{ROLE_LABEL[user.role]}</span>
                  <span className="tnum ml-2 text-micro text-ink-3 xl:ml-0 xl:mt-1 xl:block xl:truncate">
                    {user.last_seen_at ? `在线 ${relativeTime(user.last_seen_at)}`
                      : user.last_login_at ? `登录 ${relativeTime(user.last_login_at)}` : '从未登录'}
                  </span>
                </Cell>

                <Cell hidden={!member} label="角色">
                  {member ? <span className="text-ink-2">{fundRoles(member)}</span> : <span className="text-ink-3">—</span>}
                </Cell>

                <Cell hidden={!member} label="Invested Capital" right>
                  {member ? <span className="tnum text-ink">{money(member.invested_capital_usd)}</span>
                    : <span className="text-ink-3">—</span>}
                </Cell>

                {RATIOS.map(({ key, label }) => {
                  const shown = member !== undefined && applies(member, key)
                  return (
                    <Cell hidden={!shown} key={key} label={label} right>
                      {shown ? <span className="tnum text-ink">{ratio(member[key])}</span>
                        : <span className="text-ink-3">—</span>}
                    </Cell>
                  )
                })}

                <div className="basis-full pt-1 xl:basis-auto xl:pt-0">
                <RowActions
                  busy={busy}
                  editing={editing === user.id}
                  isMe={user.id === meId}
                  onAct={onAct}
                  onEdit={() => setEditing(editing === user.id ? null : user.id)}
                  user={user}
                />
                </div>
              </div>

              {editing === user.id && user.role === 'member' && (
                <MemberEditor
                  busy={busy}
                  member={member}
                  onAct={onAct}
                  onClose={() => setEditing(null)}
                  user={user}
                />
              )}
            </li>
          )
        })}
      </ul>
    </>
  )
}

/**
 * 一行的操作，全是文字按钮。
 *
 * 自己那一行不给任何管理动作。停用和删除后端本来就拒绝，而降级不拒绝——
 * 手一抖就把自己踢出管理面，且只能求另一个管理员捞回来。改自己的口令走「账号」页。
 */
function RowActions({ user, isMe, busy, editing, onEdit, onAct }: {
  user: User
  isMe: boolean
  busy: boolean
  editing: boolean
  onEdit: () => void
  onAct: Act
}) {
  const [mode, setMode] = useState<'idle' | 'reset' | 'delete'>('idle')
  const [password, setPassword] = useState('')

  const close = () => { setMode('idle'); setPassword('') }
  const run = (fn: () => Promise<unknown>) => { close(); void onAct(fn) }

  if (isMe) {
    return (
      <div className="flex justify-start text-xs text-ink-3 xl:justify-end">
        <a className="underline-offset-4 hover:text-ink-2 hover:underline" href={hrefOf('account')}>
          在「账号」里改自己的口令
        </a>
      </div>
    )
  }

  if (mode === 'reset') {
    return (
      <form
        className="flex flex-wrap items-center justify-start gap-2 xl:justify-end"
        onSubmit={(event) => {
          event.preventDefault()
          run(() => resetPassword(user.id, password))
        }}
      >
        <input
          aria-label={`${user.username} 的新口令`}
          autoFocus
          className="min-w-0 flex-1 border-b border-rule-strong bg-transparent pb-1 text-xs text-ink outline-none placeholder:text-ink-3 xl:max-w-[150px]"
          minLength={10}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="新口令，至少 10 位"
          required
          type="password"
          value={password}
        />
        <TextAction busy={busy} label="确定" type="submit" />
        <TextAction busy={false} label="取消" onClick={close} />
      </form>
    )
  }

  if (mode === 'delete') {
    return (
      <div className="flex flex-wrap items-center justify-start gap-2.5 xl:justify-end">
        <span className="text-xs text-ink-2">删除后无法恢复。</span>
        <TextAction busy={busy} label="确认删除" onClick={() => run(() => deleteUser(user.id))} tone="loss" />
        <TextAction busy={false} label="取消" onClick={close} />
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center justify-start gap-x-3 gap-y-1 xl:justify-end">
      {/* 管理员不参与分配，没有这一项 */}
      {user.role === 'member' && (
        <TextAction active={editing} busy={busy} label="分配" onClick={onEdit} />
      )}
      <TextAction busy={busy} label="重置口令" onClick={() => setMode('reset')} />
      <TextAction
        busy={busy}
        label={user.role === 'admin' ? '降为成员' : '升为管理员'}
        onClick={() => void onAct(() => updateUser(user.id, {
          role: user.role === 'admin' ? 'member' : 'admin',
        }))}
      />
      <TextAction
        busy={busy}
        label={user.is_active ? '停用' : '启用'}
        onClick={() => void onAct(() => updateUser(user.id, { is_active: !user.is_active }))}
      />
      <TextAction busy={busy} label="删除" onClick={() => setMode('delete')} tone="loss" />
    </div>
  )
}

function TextAction({ label, onClick, busy, tone, active = false, type = 'button' }: {
  label: string
  onClick?: () => void
  busy: boolean
  tone?: 'loss'
  active?: boolean
  type?: 'button' | 'submit'
}) {
  return (
    <button
      aria-pressed={type === 'button' && active ? true : undefined}
      className={cn('shrink-0 py-1 text-xs transition-colors duration-200 disabled:opacity-30',
        active ? 'text-ink' : tone === 'loss' ? 'text-ink-3 hover:text-loss' : 'text-ink-3 hover:text-ink')}
      disabled={busy}
      onClick={onClick}
      type={type}
    >
      {label}
    </button>
  )
}

/**
 * 一个成员的分配：角色与比例。两个角色都不选，保存就是把他移出分配。
 * 不属于所选角色的比例不显示，后端也会存成 0。
 */
function MemberEditor({ user, member, busy, onAct, onClose }: {
  user: User
  member: FundMember | undefined
  busy: boolean
  onAct: Act
  onClose: () => void
}) {
  const [manager, setManager] = useState(member?.is_manager ?? false)
  const [investor, setInvestor] = useState(member?.is_investor ?? false)
  const [capital, setCapital] = useState(asText(member?.invested_capital_usd))
  const [rates, setRates] = useState(() => Object.fromEntries(RATIOS.map(({ key }) => [
    key, member ? asPercentText(member[key]) : '',
  ])) as Record<(typeof RATIOS)[number]['key'], string>)

  const shown = RATIOS.filter(({ key }) => key === 'loss_allocation'
    || (key === 'investor_return' ? investor : manager))
  const percentOf = (key: (typeof RATIOS)[number]['key']) => (parseAmount(rates[key]) ?? 0) / 100
  const invalid = (manager || investor) && (parseAmount(capital) === null
    || shown.some(({ key }) => { const v = parseAmount(rates[key]); return v !== null && (v < 0 || v > 100) }))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void onAct(() => saveFundMember(user.id, {
      is_manager: manager,
      is_investor: investor,
      invested_capital_usd: parseAmount(capital) ?? 0,
      loss_allocation: percentOf('loss_allocation'),
      management_fee: percentOf('management_fee'),
      performance_fee: percentOf('performance_fee'),
      investor_return: percentOf('investor_return'),
    })).then((ok) => { if (ok) onClose() })
  }

  const id = (key: string) => `member-${user.id}-${key}`

  return (
    <form className="mt-3 rounded-[var(--radius-panel)] border border-rule bg-sheet-2/40 p-4" onSubmit={submit}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Toggle checked={manager} disabled={busy} label="Manager" onChange={setManager} />
        <Toggle checked={investor} disabled={busy} label="Investor" onChange={setInvestor} />
      </div>
      {(manager || investor) && (
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <Field htmlFor={id('capital')} label="Invested Capital" suffix="USD">
            <input className={cn(input, 'pr-12')} disabled={busy} id={id('capital')} inputMode="decimal"
                   onChange={(e) => setCapital(e.target.value)} required value={capital} />
          </Field>
          {shown.map(({ key, label }) => (
            <Field htmlFor={id(key)} key={key} label={label} suffix="%">
              <input className={cn(input, 'pr-8')} disabled={busy} id={id(key)} inputMode="decimal"
                     onChange={(e) => setRates((prev) => ({ ...prev, [key]: e.target.value }))}
                     value={rates[key]} />
            </Field>
          ))}
        </div>
      )}
      <div className="mt-4 flex items-center justify-end gap-3">
        <TextAction busy={false} label="取消" onClick={onClose} />
        {/* 两个角色都不选：原本是参与者就是「移出分配」，原本就不是则没什么可存 */}
        <SubmitButton busy={busy} disabled={invalid || (!manager && !investor && !member)}
                      label={manager || investor || !member ? '保存' : '移出分配'} />
      </div>
    </form>
  )
}

function Toggle({ label, checked, disabled, onChange }: {
  label: string
  checked: boolean
  disabled: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
      <input
        checked={checked}
        className="size-3.5 cursor-pointer accent-[var(--ink)]"
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      {label}
    </label>
  )
}

function CreateForm({ busy, onAct }: { busy: boolean; onAct: Act }) {
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('member')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void onAct(async () => {
      await createUser({ username, password, role, display_name: displayName })
      setUsername(''); setDisplayName(''); setPassword(''); setRole('member')
    })
  }

  return (
    <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={submit}>
      <Field htmlFor="new-username" label="用户名">
        <input autoCapitalize="none" autoCorrect="off" className={input} disabled={busy}
               id="new-username" onChange={(e) => setUsername(e.target.value)}
               placeholder="字母、数字、下划线、连字符" required value={username} />
      </Field>
      <Field htmlFor="new-display" label="显示名">
        <input className={input} disabled={busy} id="new-display"
               onChange={(e) => setDisplayName(e.target.value)} value={displayName} />
      </Field>
      <div>
        <Field htmlFor="new-password" label="初始口令">
          <input autoComplete="new-password" className={input} disabled={busy} id="new-password"
                 minLength={10} onChange={(e) => setPassword(e.target.value)} required
                 type="password" value={password} />
        </Field>
        {password && password.length < 10 && (
          <p className="mt-1.5 text-micro text-loss">还差 {10 - password.length} 位</p>
        )}
      </div>
      <Field htmlFor="new-role" label="权限">
        <select className={cn(input, 'cursor-pointer')} disabled={busy} id="new-role"
                onChange={(e) => setRole(e.target.value as Role)} value={role}>
          <option className="bg-sheet text-ink" value="member">成员</option>
          <option className="bg-sheet text-ink" value="admin">管理员</option>
        </select>
      </Field>
      <button
        className={cn('flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius-control)] sm:col-span-2',
          'bg-ink text-sm text-sheet transition-all duration-200',
          'hover:opacity-88 active:translate-y-px disabled:cursor-default disabled:opacity-35')}
        disabled={busy || !username || password.length < 10}
        type="submit"
      >
        <Plus aria-hidden="true" size={13} />新建
      </button>
    </form>
  )
}
