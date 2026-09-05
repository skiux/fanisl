import { useEffect, useState, useSyncExternalStore } from 'react'
import { getSession, subscribe } from './api/session'
import { AccountPage } from './features/auth/AccountPage'
import { AdminPage } from './features/auth/AdminPage'
import { AuthGate } from './features/auth/AuthGate'
import { canView, hrefOf, onRouteChange, readRoute, titleOf } from './lib/router'
import { LedgerPage } from './features/ledger/LedgerPage'
import { OrdersPage } from './features/orders/OrdersPage'
import { CostBasisPage } from './features/portfolio/CostBasisPage'
import { StatementPage } from './features/portfolio/StatementPage'

export default function App() {
  const [page, setPage] = useState(() => readRoute().page)
  const session = useSyncExternalStore(subscribe, getSession)
  useEffect(() => onRouteChange(() => setPage(readRoute().page)), [])

  // 成员进不了用户管理与现货成本。后端本来就会 403，但让成员先看见标题
  // 再看见一屏错误，是把权限问题讲成了故障——直接退回资产页。
  // 用 replace：这个地址不该留在历史里，否则后退键会把人弹回来。
  const denied = session.status === 'authenticated'
    && !canView(page, session.user.role)
  useEffect(() => {
    if (!denied) return
    window.history.replaceState(null, '', hrefOf('assets'))
    setPage('assets')
  }, [denied])

  // 浏览器标签页得跟着换，不然停在"资产"上，多开几个标签就分不清了
  useEffect(() => { document.title = titleOf(page) }, [page])

  // 换页要整块重建：三页各自持有自己的取数与分节状态，复用同一棵树只会串味
  const view = denied ? null
    : page === 'orders' ? <OrdersPage key="orders" />
      : page === 'ledger' ? <LedgerPage key="ledger" />
        : page === 'account' ? <AccountPage key="account" />
          : page === 'admin' ? <AdminPage key="admin" />
            : page === 'costbasis' ? <CostBasisPage key="costbasis" />
              : <StatementPage key="assets" />
  return <AuthGate>{view}</AuthGate>
}
