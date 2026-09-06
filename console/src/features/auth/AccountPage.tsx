import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../../api/http'
import {
  changePassword, getSession, listSessions, revokeAllSessions, type SessionRow,
} from '../../api/session'
import { Figure, Module, Stack, ViewGrid } from '../../components/layout'
import { cn } from '../../lib/cn'
import { relativeTime } from '../../lib/format'
import { Masthead } from '../portfolio/Masthead'

const ROLE_LABEL = { admin: '管理员', member: '成员' } as const

/**
 * 自己的账号：改口令 + 看/撤销会话。
 *
 * 后端一直有这两个接口，但一开始没做界面——于是用户只能找管理员重置口令，
 * 自己没法轮换。会话列表也是有用的：它是"我的账号有没有被别人登着"唯一能看的地方。
 */
export function AccountPage() {
  const session = getSession()
  const user = session.status === 'authenticated' ? session.user : null

  const [rows, setRows] = useState<SessionRow[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      setRows(await listSessions())
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '读取会话列表失败')
      // **失败要落地，但不能落成空列表。** 不动 rows 的话上面挂着报错、下面
      // 还转着"正在读取…"；落成 `[]` 又会显示成"一个会话都没有"。
      setFailed(true)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  if (!user) return null

  return (
    <div className="min-h-[100dvh] bg-desk px-3 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-6">
      {/* 这两页内容不多，纸张按内容收——钉在视口高度只会在下面留一大片空白 */}
      <div className="sheet mx-auto flex max-w-[1420px] flex-col">
        <Masthead asOf={null} onRefresh={() => { void load() }} page="account"
                  refreshing={false} sources={[]} title="账号" />

        <div className="min-h-0 flex-1 px-5 py-7 sm:px-10 sm:py-8">
          <div className="rise">
            {error && (
              <p className="mb-6 border-l-2 border-loss bg-loss/[0.07] px-3 py-2.5 text-xs text-loss"
                 role="alert">{error}</p>
            )}
            {notice && (
              <p className="mb-6 border-l-2 border-gain bg-gain/[0.07] px-3 py-2.5 text-xs text-gain"
                 role="status">{notice}</p>
            )}

            <ViewGrid>
              <Module note="改完口令后，别处的登录会被踢掉" span="lg:col-span-7" title="修改口令">
                <PasswordForm
                  busy={busy}
                  onDone={(message) => { setNotice(message); setError(null) }}
                  onError={(message) => { setError(message); setNotice(null) }}
                  setBusy={setBusy}
                />
              </Module>

              <Stack span="lg:col-span-5">
                <Module note={ROLE_LABEL[user.role]} span="" title="当前身份">
                  <dl className="grid grid-cols-2 gap-x-8 gap-y-5">
                    <Figure label="用户名" value={user.username} />
                    <Figure label="显示名" value={user.display_name || '—'} />
                    <Figure
                      label="最近登录"
                      value={user.last_login_at ? relativeTime(user.last_login_at) : '—'}
                    />
                    <Figure label="状态" value={user.is_active ? '正常' : '已停用'} />
                  </dl>
                </Module>

                <Module
                  figure={rows ? `${rows.length} 个` : '—'}
                  note="包含当前这条"
                  span=""
                  title="活跃会话"
                >
                  {failed ? (
                    <p className="py-6 text-center text-sm text-ink-3">这次没读到。</p>
                  ) : rows === null ? (
                    <p className="py-6 text-center text-sm text-ink-3">正在读取…</p>
                  ) : (
                    <>
                      <ul className="space-y-2.5">
                        {rows.map((row) => (
                          <li className="flex items-baseline justify-between gap-3"
                              key={`${row.created_at}-${row.ip}`}>
                            <span className="flex min-w-0 items-baseline gap-2">
                              <span className="truncate text-xs text-ink-2" title={row.user_agent}>
                                {row.ip || '未知来源'}
                              </span>
                              {/* 几台设备常常是同一个出口 IP，不标出来就分不清哪条是自己 */}
                              {row.is_current && (
                                <span className="shrink-0 rounded-[4px] bg-sheet-2 px-1.5 py-px text-micro text-ink-2">
                                  当前
                                </span>
                              )}
                            </span>
                            <span className="tnum shrink-0 text-micro text-ink-3">
                              {relativeTime(row.last_seen_at)}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <button
                        className={cn('mt-5 w-full rounded-[var(--radius-control)] border border-rule',
                          'py-2 text-xs text-ink-2 transition-colors duration-200',
                          'hover:border-rule-strong hover:text-ink disabled:opacity-40')}
                        disabled={busy}
                        onClick={() => {
                          if (!window.confirm('退出全部设备？当前这条会话也会失效，需要重新登录。')) return
                          setBusy(true)
                          revokeAllSessions()
                            .then(() => { window.location.reload() })
                            .catch((e: unknown) => {
                              setError(e instanceof ApiError ? e.message : '操作失败')
                              setBusy(false)
                            })
                        }}
                        type="button"
                      >
                        退出全部设备
                      </button>
                    </>
                  )}
                </Module>
              </Stack>
            </ViewGrid>
          </div>
        </div>

        <footer className="border-t border-rule bg-sheet-2/60 px-5 py-2.5 sm:px-10">
          <p className="text-xs text-ink-3">
            会话有效期与闲置上限由服务端配置 · 改口令、被停用、被改角色都会立即作废全部会话
          </p>
        </footer>
      </div>
    </div>
  )
}

function PasswordForm({ busy, setBusy, onDone, onError }: {
  busy: boolean
  setBusy: (value: boolean) => void
  onDone: (message: string) => void
  onError: (message: string) => void
}) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')

  const mismatch = again.length > 0 && next !== again

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy || mismatch) return
    setBusy(true)
    try {
      await changePassword(current, next)
      setCurrent(''); setNext(''); setAgain('')
      onDone('口令已修改，别处的登录已失效')
    } catch (e) {
      onError(e instanceof ApiError ? e.message : '修改失败')
    } finally {
      setBusy(false)
    }
  }

  const input = cn(
    'mt-2 w-full border-b border-rule-strong bg-transparent pb-1.5 text-base text-ink',
    'outline-none transition-colors duration-200',
    'hover:border-ink-3 focus:border-ink disabled:opacity-50',
  )

  return (
    <form className="max-w-[26rem] space-y-5" onSubmit={submit}>
      {([
        ['当前口令', current, setCurrent, 'current-password'],
        ['新口令', next, setNext, 'new-password'],
        ['再输一次', again, setAgain, 'new-password'],
      ] as const).map(([label, value, set, autoComplete], index) => (
        <div key={label}>
          <label className="label" htmlFor={`pw-${index}`}>{label}</label>
          <input
            autoComplete={autoComplete}
            className={input}
            disabled={busy}
            id={`pw-${index}`}
            onChange={(event) => set(event.target.value)}
            required
            type="password"
            value={value}
          />
        </div>
      ))}

      {mismatch && <p className="text-xs text-loss">两次输入不一致</p>}

      <button
        className={cn('w-full rounded-[var(--radius-control)] bg-ink py-2.5 text-sm text-sheet',
          'transition-all duration-200 hover:opacity-88 active:translate-y-px',
          'disabled:cursor-default disabled:opacity-30 disabled:active:translate-y-0')}
        disabled={busy || !current || !next || mismatch}
        type="submit"
      >
        {busy ? '正在提交…' : '修改口令'}
      </button>
    </form>
  )
}
