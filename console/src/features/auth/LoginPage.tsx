import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/http'
import { login } from '../../api/session'
import { cn } from '../../lib/cn'

/**
 * 登录页 = **这份报表的封面**，不是一个通用的登录卡片。
 *
 * 用的是三个页面同一套解剖：报头（品牌行 → 标题 → 那条唯一的实心重线）→ 正文 → 页脚口径。
 * 第一版是个居中的方框加两个输入框，功能上没错，但它跟后面的报表看不出是同一份文件；
 * 而登录页是任何人看到的第一屏，它定的是之后所有页面的调子。
 *
 * 两条刻意的克制：
 * - **不提示"用户名不存在"还是"口令错误"**。后端两种情况同文案、同耗时，
 *   前端拆开显示就把后端特意堵上的用户名枚举信道又打开了。
 * - **没有注册与找回**。账号由管理员开设，口令忘了找管理员重置。
 */
export function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const first = useRef<HTMLInputElement>(null)

  useEffect(() => { first.current?.focus() }, [])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    setError(null)
    setBusy(true)
    try {
      await login(username, password)
      // 成功后不跳转：闸门订阅了会话状态，会把整棵树换成资产台，
      // 而 hash 从头到尾没变——登录前在哪一节，登录后还在哪一节。
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '连不上服务器，请检查网络后重试')
      setPassword('')
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-[100dvh] place-items-center bg-desk px-4 py-10">
      <form className="sheet rise flex w-full max-w-[416px] flex-col" onSubmit={submit}>
        {/* 报头。与资产/委托/流水三页逐字同构——那条重线是整份报表唯一的实心线 */}
        <header className="rule-heavy px-8 pb-4 pt-7 sm:px-9 sm:pt-8">
          <span className="flex items-center gap-2">
            <svg aria-hidden="true" className="text-ink" height="15" viewBox="0 0 20 20" width="15">
              <path d="M2 16.5 L8.2 3.5 L11 9.4 L13.4 5.1 L18 16.5" fill="none"
                    stroke="currentColor" strokeLinecap="square" strokeWidth="1.5" />
              <circle cx="13.4" cy="5.1" fill="var(--accent)" r="1.9" />
            </svg>
            <span className="text-xs font-semibold tracking-tight text-ink">FANISL</span>
            <span className="label">Console</span>
          </span>

          <div className="mt-3.5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <h1 className="font-display text-xl font-medium tracking-[-0.015em] text-ink">
              资产报表
            </h1>
            <span className="text-xs text-ink-3">登录后查看</span>
          </div>
        </header>

        <div className="px-8 py-7 sm:px-9">
          {error && (
            <p
              className="mb-5 border-l-2 border-loss bg-loss/[0.07] px-3 py-2.5 text-xs leading-relaxed text-loss"
              role="alert"
            >
              {error}
            </p>
          )}

          <div className="space-y-5">
            <Field
              autoComplete="username"
              disabled={busy}
              id="login-username"
              inputRef={first}
              label="用户名"
              onChange={setUsername}
              value={username}
            />
            <Field
              autoComplete="current-password"
              disabled={busy}
              id="login-password"
              label="口令"
              onChange={setPassword}
              type="password"
              value={password}
            />
          </div>

          <button
            className={cn(
              'mt-7 w-full rounded-[var(--radius-control)] py-2.5 text-sm',
              'bg-ink text-sheet transition-all duration-200',
              'hover:opacity-88 active:translate-y-px',
              'disabled:cursor-default disabled:opacity-30 disabled:active:translate-y-0',
            )}
            disabled={busy || !username || !password}
            type="submit"
          >
            {busy ? '正在登录…' : '登录'}
          </button>
        </div>

        {/* 页脚口径。三个页面都有这一条，写的是"这份数据该怎么读"；
            在封面上，该说的是"这个账号是怎么回事"。 */}
        <footer className="border-t border-rule bg-sheet-2/60 px-8 py-3 sm:px-9">
          <p className="text-micro leading-relaxed text-ink-3">
            账号由管理员开设 · 口令忘了找管理员重置
          </p>
        </footer>
      </form>
    </div>
  )
}

function Field({ id, label, value, onChange, type = 'text', disabled, autoComplete, inputRef }: {
  id: string
  label: string
  value: string
  onChange: (next: string) => void
  type?: string
  disabled?: boolean
  autoComplete?: string
  inputRef?: React.RefObject<HTMLInputElement | null>
}) {
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      {/*
        输入框走的是报表的行线，不是圆角控件：整份报表的分隔全靠横线，
        这里再冒出一圈描边盒子就是另一套语言了。
      */}
      <input
        autoCapitalize="none"
        autoComplete={autoComplete}
        autoCorrect="off"
        className={cn(
          'mt-2 w-full border-b border-rule-strong bg-transparent pb-1.5',
          'text-base text-ink outline-none transition-colors duration-200',
          'hover:border-ink-3 focus:border-ink focus-visible:outline-none',
          'disabled:opacity-50',
        )}
        disabled={disabled}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        ref={inputRef}
        required
        type={type}
        value={value}
      />
    </div>
  )
}
