import { useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { setUnauthenticatedHandler } from '../../api/http'
import { getSession, markAnonymous, refreshSession, subscribe } from '../../api/session'
import { LoginPage } from './LoginPage'

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
  if (session.status === 'anonymous') return <LoginPage />
  return <>{children}</>
}
