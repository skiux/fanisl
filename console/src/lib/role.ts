import { useSyncExternalStore } from 'react'
import { getSession, subscribe } from '../api/session'

/**
 * 当前用户是不是管理员。
 *
 * 用来决定**要不要把口径与取数状态摆出来**：接口权重、来源健康、窗口上限、
 * "已剔除充提"这类口径说明，都是给维护这套东西的人看的。成员看资产台是为了
 * 知道自己的钱怎么样，这些东西对他只是噪音——而且它们泄露的是系统内部构造。
 *
 * 这不是权限边界：真正的边界在后端（`/admin/*` 会 403）。这里只管显示。
 */
export function useIsAdmin() {
  const session = useSyncExternalStore(subscribe, getSession)
  return session.status === 'authenticated' && session.user.role === 'admin'
}
