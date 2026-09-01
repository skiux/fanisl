import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import { login } from './session'
import './auth.css'

/**
 * 登录页。
 *
 * 两条刻意的克制：
 * - **不提示"用户名不存在"还是"口令错误"**。后端两种情况返回同一句话、耗时也一致，
 *   前端要是自作聪明拆开显示，就把后端特意堵上的用户名枚举信道又打开了。
 * - **没有"注册"和"忘记口令"**。用户由管理员在控制台里建；口令忘了找管理员重置。
 *   三五个人的工具，邮件找回通道是纯负担。
 */
function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const usernameRef = useRef<HTMLInputElement>(null)

  useEffect(() => { usernameRef.current?.focus() }, [])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    setError(null)
    setBusy(true)
    try {
      await login(username, password)
      // 成功后不用跳转：AuthGate 订阅了会话状态，会把整棵树换成应用本体，
      // 而地址栏里的 hash 从头到尾没变——登录前想去哪，登录后还在哪。
    } catch (err) {
      setError(err instanceof ApiError
        ? err.message
        : '连不上服务器，请检查网络后重试')
      setPassword('')
      setBusy(false)
    }
  }

  return (
    <main className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        {/* 用的是顶栏那个真标记（角线 + 斜杠 + 圆点），不是随手一个圆点 */}
        <span className="brand"><i aria-hidden="true" /><strong>FANISL</strong></span>

        <p className="auth-eyebrow">ACCESS</p>
        <h1>个人投资知识引擎</h1>
        <p className="auth-lede">
          持续学习、持续验证、持续沉淀。账号由管理员开设。
        </p>

        <div className="auth-form">
        {error && <p className="auth-error" role="alert">{error}</p>}

        <div className="auth-field">
          <label htmlFor="auth-username">用户名</label>
          <input
            autoCapitalize="none"
            autoComplete="username"
            autoCorrect="off"
            disabled={busy}
            id="auth-username"
            name="username"
            onChange={(e) => setUsername(e.target.value)}
            ref={usernameRef}
            required
            value={username}
          />
        </div>

        <div className="auth-field">
          <label htmlFor="auth-password">口令</label>
          <input
            autoComplete="current-password"
            disabled={busy}
            id="auth-password"
            name="password"
            onChange={(e) => setPassword(e.target.value)}
            required
            type="password"
            value={password}
          />
        </div>

        <button className="auth-submit" disabled={busy || !username || !password} type="submit">
          {busy ? '正在登录…' : '进入'}
        </button>

        <p className="auth-note">口令忘了找管理员重置。</p>
        </div>
      </form>
    </main>
  )
}

export default LoginPage
