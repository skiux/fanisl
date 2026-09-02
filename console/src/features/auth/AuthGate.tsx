import { useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { ApiError, setUnauthenticatedHandler } from '../../api/http'
import { getSession, login, markAnonymous, refreshSession, subscribe } from '../../api/session'
import { LoginPage } from '../../../../shared/login/LoginPage'

// 登录页是两个应用共用的，不认识这边的 ApiError——由这里把异常翻成一句话
const messageOf = (error: unknown) => error instanceof ApiError ? error.message : null

/**
 * 会话闸门：没登录就只渲染登录页，资产台一行都不挂载。
 *
 * 与后端那道中间件同一个方向——**默认关**。做成"渲染应用再各处判断"的话，
 * 三个页面各自处理未登录，漏一个就是一屏报错。
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const session = useSyncExternalStore(subscribe, getSession)

  useEffect(() => {
    // 任意接口 401（会话过期、被管理员踢掉、改了口令）都切回登录页
    setUnauthenticatedHandler(markAnonymous)
    void refreshSession()
  }, [])

  if (session.status === 'checking') {
    return (
      <div className="grid min-h-[100dvh] place-items-center bg-desk">
        <span className="label text-ink-3">正在确认会话</span>
      </div>
    )
  }
  if (session.status === 'anonymous') return <LoginPage messageOf={messageOf} onLogin={login} />
  return <>{children}</>
}
