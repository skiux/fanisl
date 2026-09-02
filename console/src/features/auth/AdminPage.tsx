import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash, Key, ArrowsClockwise } from '@phosphor-icons/react'
import { ApiError } from '../../api/http'
import {
  createUser, deleteUser, getSession, listUsers, resetPassword, updateUser,
  type Role, type User,
} from '../../api/session'
import { Module, ViewGrid } from '../../components/layout'
import { cn } from '../../lib/cn'
import { clockTime } from '../../lib/format'
import { Masthead } from '../portfolio/Masthead'
import { ErrorState } from '../portfolio/states'

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
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      setUsers(await listUsers())
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '读取用户列表失败')
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
            <ErrorState message="需要管理员权限" onRetry={() => { void load() }} />
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
                  <UserTable busy={busy} meId={me.id} onAct={act} users={users} />
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

const ROW = 'grid grid-cols-[minmax(0,1.3fr)_auto] items-center gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1fr)_128px]'

function UserTable({ users, meId, busy, onAct }: {
  users: User[] | null
  meId: number
  busy: boolean
  onAct: (fn: () => Promise<unknown>) => Promise<void>
}) {
  if (users === null) return <p className="py-10 text-center text-sm text-ink-3">正在读取…</p>
  if (users.length === 0) return <p className="py-10 text-center text-sm text-ink-3">还没有用户。</p>

  return (
    <>
      <div className={cn(ROW, 'border-b border-rule pb-2 text-micro text-ink-3')}>
        <span>用户</span>
        <span className="hidden sm:block">角色</span>
        <span className="hidden sm:block">最近登录</span>
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

            <div className="hidden text-xs text-ink-2 sm:block">{ROLE_LABEL[user.role]}</div>

            <div className="tnum hidden truncate text-xs text-ink-3 sm:block">
              {user.last_login_at ? clockTime(user.last_login_at) : '从未登录'}
            </div>

            <div className="flex items-center justify-end gap-2.5">
              <IconAction
                busy={busy}
                icon={<Key size={13} />}
                label="重置口令"
                onClick={() => {
                  const next = window.prompt(`给 ${user.username} 设置新口令（至少 10 位）`)
                  if (next) void onAct(() => resetPassword(user.id, next))
                }}
              />
              <IconAction
                busy={busy}
                icon={<ArrowsClockwise size={13} />}
                label={user.role === 'admin' ? '降为成员' : '升为管理员'}
                onClick={() => void onAct(() => updateUser(user.id, {
                  role: user.role === 'admin' ? 'member' : 'admin',
                }))}
              />
              <IconAction
                busy={busy}
                icon={<span className="text-micro">{user.is_active ? '停用' : '启用'}</span>}
                label={user.is_active ? '停用' : '启用'}
                onClick={() => void onAct(() => updateUser(user.id, { is_active: !user.is_active }))}
              />
              <IconAction
                busy={busy}
                icon={<Trash size={13} />}
                label="删除"
                onClick={() => {
                  if (window.confirm(`删除用户 ${user.username}？此操作不可撤销。`)) {
                    void onAct(() => deleteUser(user.id))
                  }
                }}
                tone="loss"
              />
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}

function IconAction({ icon, label, onClick, busy, tone }: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  busy: boolean
  tone?: 'loss'
}) {
  return (
    <button
      aria-label={label}
      className={cn('shrink-0 transition-colors duration-200 disabled:opacity-30',
        tone === 'loss' ? 'text-ink-3 hover:text-loss' : 'text-ink-3 hover:text-ink')}
      disabled={busy}
      onClick={onClick}
      title={label}
      type="button"
    >
      {icon}
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
               onChange={(e) => setPassword(e.target.value)} required type="password"
               value={password} />
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
        disabled={busy || !username || !password}
        type="submit"
      >
        <Plus aria-hidden="true" size={13} />新建
      </button>
    </form>
  )
}
