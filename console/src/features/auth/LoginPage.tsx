import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/http'
import { login } from '../../api/session'
import { cn } from '../../lib/cn'

/**
 * 登录页。沿用整份报表的纸面语言：一张纸、三种字体、同一套字号音阶。
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
      <form className="sheet w-full max-w-[380px] px-9 pb-9 pt-10" onSubmit={submit}>
        <div className="flex items-center gap-2">
          <svg aria-hidden="true" className="text-ink" height="15" viewBox="0 0 20 20" width="15">
            <path d="M2 16.5 L8.2 3.5 L11 9.4 L13.4 5.1 L18 16.5" fill="none"
                  stroke="currentColor" strokeLinecap="square" strokeWidth="1.5" />
            <circle cx="13.4" cy="5.1" fill="var(--accent)" r="1.9" />
          </svg>
          <span className="text-xs font-semibold tracking-tight text-ink">FANISL</span>
          <span className="label">Console</span>
        </div>

        <h1 className="mt-7 font-display text-xl font-medium tracking-[-0.015em] text-ink">
          登录
        </h1>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-3">
          账户资产台。账号由管理员开设。
        </p>

        {error && (
          <p
            className="mt-5 rounded-[var(--radius-control)] border-l-2 border-loss bg-loss/[0.07] px-3 py-2.5 text-xs leading-relaxed text-loss"
            role="alert"
          >
            {error}
          </p>
        )}

        <div className="mt-6 space-y-4">
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
            'mt-7 w-full rounded-[var(--radius-control)] py-2.5 text-sm transition-all duration-200',
            'bg-ink text-sheet hover:opacity-88 active:translate-y-px',
            'disabled:cursor-default disabled:opacity-35 disabled:active:translate-y-0',
          )}
          disabled={busy || !username || !password}
          type="submit"
        >
          {busy ? '正在登录…' : '登录'}
        </button>

        <p className="mt-5 text-micro leading-relaxed text-ink-3">
          口令忘了找管理员重置。
        </p>
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
      <input
        autoCapitalize="none"
        autoComplete={autoComplete}
        autoCorrect="off"
        className={cn(
          'mt-2 w-full rounded-[var(--radius-control)] border border-rule bg-sheet-2/50',
          'px-3 py-2 text-sm text-ink outline-none transition-colors duration-200',
          'hover:border-rule-strong focus-visible:border-accent disabled:opacity-50',
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
