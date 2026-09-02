import { useEffect, useRef, useState } from 'react'
import './login.css'

/**
 * 登录页。**两个应用共用这一份。**
 *
 * 原先控制台与知识引擎各写了一个，长得还不一样——一套账号、一个域名，却有两扇
 * 不同的门。哪一扇都不算错，"有两扇"才是错的。
 *
 * 组件不认识任何一个应用的 session 模块：登录动作与错误取文都由调用方注入，
 * 否则这份共享代码就得同时依赖两套 API 客户端。
 *
 * 两条刻意的克制（与后端对齐，别在这里放松）：
 * - **不提示"用户名不存在"还是"口令错误"**。后端两种情况返回同一句话、耗时也一致，
 *   前端要是自作聪明拆开显示，就把后端特意堵上的用户名枚举信道又打开了。
 * - **没有"注册"和"忘记口令"**。用户由管理员在控制台里建；口令忘了找管理员重置。
 *   三五个人的工具，邮件找回通道是纯负担。
 */
export type LoginPageProps = {
  /** 成功即可，返回值不用；失败抛错 */
  onLogin: (username: string, password: string) => Promise<unknown>
  /** 把异常翻成给人看的一句话；返回 null 表示"不是接口错误"，走兜底文案 */
  messageOf: (error: unknown) => string | null
}

export function LoginPage({ onLogin, messageOf }: LoginPageProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const usernameRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  useEffect(() => { usernameRef.current?.focus() }, [])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    setError(null)
    setBusy(true)
    try {
      await onLogin(username, password)
      // 成功后不用跳转：两边的闸门都订阅了会话状态，会把整棵树换成应用本体，
      // 而地址栏里的 hash 从头到尾没变——登录前想去哪，登录后还在哪。
    } catch (err) {
      setError(messageOf(err) ?? '连不上服务器，请检查网络后重试')
      // 口令清空、用户名留着——十有八九是口令打错了，让人接着往下打。
      // 焦点也要跟过去：按钮此刻已经禁用（口令空了），焦点会掉进虚空。
      setPassword('')
      setBusy(false)
      passwordRef.current?.focus()
    }
  }

  return (
    <main className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
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
              ref={passwordRef}
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
