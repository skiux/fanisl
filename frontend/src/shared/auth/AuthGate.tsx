import { useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { ApiError, setUnauthenticatedHandler } from '../api/client'
import LoginPage from '../../../../shared/login/LoginPage'
import { getSession, login, markAnonymous, refreshSession, subscribe } from './session'
import './auth.css'

// 登录页是两个应用共用的，不认识这边的 ApiError——由这里把异常翻成一句话
const messageOf = (error: unknown) => error instanceof ApiError ? error.message : null

/**
 * 会话闸门：没登录就只渲染登录页，应用本体一行都不挂载。
 *
 * 这样做而不是"渲染应用再在各处判断"，是因为后者会让每个页面各自去处理未登录，
 * 漏一个就是一屏报错。闸门是**默认关**的，与后端那道中间件同一个方向。
 *
 * 地址栏的 hash 从头到尾不动：登录前想去哪一页，登录后还在那一页。
 */
function AuthGate({ children }: { children: ReactNode }) {
  const session = useSyncExternalStore(subscribe, getSession)

  useEffect(() => {
    // 任意接口收到 401（会话过期、被管理员踢掉、改了口令）都切回登录页
    setUnauthenticatedHandler(markAnonymous)
    void refreshSession()
  }, [])

  if (session.status === 'checking') {
    return <div className="auth-checking">正在确认会话</div>
  }
  if (session.status === 'anonymous') {
    return <LoginPage messageOf={messageOf} onLogin={login} />
  }
  return <>{children}</>
}

export default AuthGate
