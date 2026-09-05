import { useCallback, useEffect, useState } from 'react'
import { Plus } from '@phosphor-icons/react'
import { ApiError } from '../../api/http'
import {
  createUser, deleteUser, getSession, listUsers, resetPassword, updateUser,
  type Role, type User,
} from '../../api/session'
import { Module, ViewGrid } from '../../components/layout'
import { cn } from '../../lib/cn'
import { clockTime } from '../../lib/format'
import { hrefOf } from '../../lib/router'
import { Masthead } from '../portfolio/Masthead'
import { PermissionState } from '../portfolio/states'

const ROLE_LABEL: Record<Role, string> = { admin: '管理员', member: '成员' }

/**
 * 用户管理。只有管理员能进——后端会 403，这里也不渲染，两头都拦。
 *
 * 几条规则由后端保证（最后一个在岗管理员不能停用/降级/删除、不能删自己），
 * 这里不重复实现，只把 409 的原话显示出来。前端复制一遍判定逻辑必然会与后端漂移，
 * 而漂移的方向通常是前端更松。
 */
export function AdminPage() {
  const session = getSession()
  const me = session.status === 'authenticated' ? session.user : null

  const [users, setUsers] = useState<User[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    setFailed(false)
    try {
      setUsers(await listUsers())
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
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await fn()
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-[100dvh] bg-desk px-3 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-6">
      {/* 这两页内容不多，纸张按内容收——钉在视口高度只会在下面留一大片空白 */}
      <div className="sheet mx-auto flex max-w-[1420px] flex-col">
        <Masthead asOf={null} onRefresh={() => { void load() }} page="admin"
                  refreshing={false} sources={[]} title="用户管理" />

        {me?.role !== 'admin' ? (
          <div className="px-6 sm:px-10">
            <PermissionState message="用户管理只对管理员开放。要开账号或改口令，找管理员。" />
          </div>
        ) : (
          <div className="min-h-0 flex-1 px-5 py-7 sm:px-10 sm:py-8">
            <div className="rise">
              {error && (
                <p className="mb-6 rounded-[var(--radius-control)] border-l-2 border-loss bg-loss/[0.07] px-3 py-2.5 text-xs text-loss"
                   role="alert">
                  {error}
                </p>
              )}
              <ViewGrid>
                <Module figure={users ? `${users.length} 人` : '—'} note="停用与删除会立即踢掉该用户的会话"
                        span="lg:col-span-7" title="用户">
                  <UserTable busy={busy} failed={failed} meId={me.id} onAct={act} users={users} />
                </Module>
                <Module note="口令至少 10 位" span="lg:col-span-5" title="新建用户">
                  <CreateForm busy={busy} onAct={act} />
                </Module>
              </ViewGrid>
            </div>
          </div>
        )}

        <footer className="border-t border-rule bg-sheet-2/60 px-5 py-2.5 sm:px-10">
          <p className="text-xs text-ink-3">
            改口令 · 重置 · 停用 · 改角色都会作废该用户的全部会话；改显示名不会 ·
            最后一个在岗管理员不能被停用、降级或删除
          </p>
        </footer>
      </div>
    </div>
  )
}

// 窄屏收掉"最近登录"，但角色必须留着：改角色的按钮就在同一行，
// 看不见现在是什么角色就没法判断该不该按。
const ROW = 'grid grid-cols-[minmax(0,1fr)] items-start gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,0.6fr)_minmax(0,0.8fr)_236px] sm:items-center'

function UserTable({ users, failed, meId, busy, onAct }: {
  users: User[] | null
  failed: boolean
  meId: number
  busy: boolean
  onAct: (fn: () => Promise<unknown>) => Promise<void>
}) {
  if (failed) return <p className="py-10 text-center text-sm text-ink-3">这次没读到。</p>
  if (users === null) return <p className="py-10 text-center text-sm text-ink-3">正在读取…</p>
  if (users.length === 0) return <p className="py-10 text-center text-sm text-ink-3">还没有用户。</p>

  return (
    <>
      <div className={cn(ROW, 'hidden border-b border-rule pb-2 text-micro text-ink-3 sm:grid')}>
        <span>用户</span>
        <span>角色</span>
        <span>最近登录</span>
        <span className="text-right">操作</span>
      </div>
      <ul className="divide-y divide-rule">
        {users.map((user) => (
          <li className={cn(ROW, 'py-3')} key={user.id}>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm text-ink">
                  {user.display_name || user.username}
                </span>
                {user.id === meId && (
                  <span className="rounded-[4px] bg-sheet-2 px-1.5 py-px text-micro text-ink-2">
                    你
                  </span>
                )}
                {!user.is_active && (
                  <span className="rounded-[4px] border border-loss/40 px-1 py-px text-micro text-loss">
                    已停用
                  </span>
                )}
              </div>
              <div className="truncate font-mono text-micro text-ink-3">{user.username}</div>
            </div>

            <div className="text-xs text-ink-2">
              {ROLE_LABEL[user.role]}
              <span className="tnum text-ink-3 sm:hidden">
                {' · '}{user.last_login_at ? clockTime(user.last_login_at) : '从未登录'}
              </span>
            </div>

            <div className="tnum hidden truncate text-xs text-ink-3 sm:block">
              {user.last_login_at ? clockTime(user.last_login_at) : '从未登录'}
            </div>

            <RowActions busy={busy} isMe={user.id === meId} onAct={onAct} user={user} />
          </li>
        ))}
      </ul>
    </>
  )
}

/**
 * 一行的操作。四个动作全是文字按钮：原先是 13px 的图标，其中"改角色"用的还是
 * 一个循环箭头——跟报头上"重新取数"同一个符号，指的却是"把成员升成管理员"。
 *
 * 自己那一行不给任何管理动作。停用和删除后端本来就拒绝，而降级不拒绝——
 * 手一抖就把自己踢出管理面，且只能求另一个管理员捞回来。改自己的口令走「账号」页。
 */
function RowActions({ user, isMe, busy, onAct }: {
  user: User
  isMe: boolean
  busy: boolean
  onAct: (fn: () => Promise<unknown>) => Promise<void>
}) {
  const [mode, setMode] = useState<'idle' | 'reset' | 'delete'>('idle')
  const [password, setPassword] = useState('')

  const close = () => { setMode('idle'); setPassword('') }
  const run = (fn: () => Promise<unknown>) => { close(); void onAct(fn) }

  if (isMe) {
    return (
      <div className="flex justify-start text-xs text-ink-3 sm:justify-end">
        <a className="underline-offset-4 hover:text-ink-2 hover:underline" href={hrefOf('account')}>
          在「账号」里改自己的口令
        </a>
      </div>
    )
  }

  if (mode === 'reset') {
    return (
      <form
        className="flex flex-wrap items-center justify-start gap-2 sm:justify-end"
        onSubmit={(event) => {
          event.preventDefault()
          run(() => resetPassword(user.id, password))
        }}
      >
        <input
          aria-label={`${user.username} 的新口令`}
          autoFocus
          className="min-w-0 flex-1 border-b border-rule-strong bg-transparent pb-1 text-xs text-ink outline-none placeholder:text-ink-3 sm:max-w-[150px]"
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
      <div className="flex flex-wrap items-center justify-start gap-2.5 sm:justify-end">
        <span className="text-xs text-ink-2">删了不能恢复。</span>
        <TextAction busy={busy} label="确认删除" onClick={() => run(() => deleteUser(user.id))} tone="loss" />
        <TextAction busy={false} label="取消" onClick={close} />
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center justify-start gap-x-3 gap-y-1 sm:justify-end">
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

function TextAction({ label, onClick, busy, tone, type = 'button' }: {
  label: string
  onClick?: () => void
  busy: boolean
  tone?: 'loss'
  type?: 'button' | 'submit'
}) {
  return (
    <button
      className={cn('shrink-0 py-1 text-xs transition-colors duration-200 disabled:opacity-30',
        tone === 'loss' ? 'text-ink-3 hover:text-loss' : 'text-ink-3 hover:text-ink')}
      disabled={busy}
      onClick={onClick}
      type={type}
    >
      {label}
    </button>
  )
}

function CreateForm({ busy, onAct }: {
  busy: boolean
  onAct: (fn: () => Promise<unknown>) => Promise<void>
}) {
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('member')

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    void onAct(async () => {
      await createUser({ username, password, role, display_name: displayName })
      setUsername(''); setDisplayName(''); setPassword(''); setRole('member')
    })
  }

  const input = cn(
    'mt-2 w-full rounded-[var(--radius-control)] border border-rule bg-sheet-2/50',
    'px-3 py-2 text-sm text-ink outline-none transition-colors duration-200',
    'hover:border-rule-strong focus-visible:border-accent disabled:opacity-50',
  )

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div>
        <label className="label" htmlFor="new-username">用户名</label>
        <input autoCapitalize="none" autoCorrect="off" className={input} disabled={busy}
               id="new-username" onChange={(e) => setUsername(e.target.value)}
               placeholder="字母、数字、下划线、连字符" required value={username} />
      </div>
      <div>
        <label className="label" htmlFor="new-display">显示名</label>
        <input className={input} disabled={busy} id="new-display"
               onChange={(e) => setDisplayName(e.target.value)} value={displayName} />
      </div>
      <div>
        <label className="label" htmlFor="new-password">初始口令</label>
        <input autoComplete="new-password" className={input} disabled={busy} id="new-password"
               minLength={10} onChange={(e) => setPassword(e.target.value)} required
               type="password" value={password} />
        {password && password.length < 10 && (
          <p className="mt-1.5 text-micro text-loss">还差 {10 - password.length} 位</p>
        )}
      </div>
      <div>
        <label className="label" htmlFor="new-role">角色</label>
        <select className={cn(input, 'cursor-pointer')} disabled={busy} id="new-role"
                onChange={(e) => setRole(e.target.value as Role)} value={role}>
          <option className="bg-sheet text-ink" value="member">成员</option>
          <option className="bg-sheet text-ink" value="admin">管理员</option>
        </select>
      </div>
      <button
        className={cn('flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-control)]',
          'bg-ink py-2.5 text-sm text-sheet transition-all duration-200',
          'hover:opacity-88 active:translate-y-px disabled:cursor-default disabled:opacity-35')}
        disabled={busy || !username || password.length < 10}
        type="submit"
      >
        <Plus aria-hidden="true" size={13} />新建
      </button>
    </form>
  )
}
