import { useEffect, useState, useSyncExternalStore } from 'react'
import { getSession, subscribe } from './api/session'
import { BottomNavigation, type MainDestination } from './components/BottomNavigation'
import { AccountPage } from './features/auth/AccountPage'
import { AdminPage } from './features/auth/AdminPage'
import { AuthGate } from './features/auth/AuthGate'
import { canView, hrefOf, onRouteChange, readRoute, titleOf } from './lib/router'
import { useReloadOnNewBuild } from './lib/version'
import { LedgerPage } from './features/ledger/LedgerPage'
import { OrdersPage } from './features/orders/OrdersPage'
import { StatementPage } from './features/portfolio/StatementPage'

export default function App() {
  const [route, setRoute] = useState(readRoute)
  const { page } = route
  const session = useSyncExternalStore(subscribe, getSession)
  useEffect(() => onRouteChange(() => setRoute(readRoute())), [])
  // 服务器上换了新版本，开着的标签页在回到前台时自己换上
  useReloadOnNewBuild()

  // 成员进不了用户管理。后端本来就会 403，但让成员先看见一个"用户管理"的
  // 标题再看见一屏错误，是把权限问题讲成了故障——直接退回资产页。
  // 用 replace：这个地址不该留在历史里，否则后退键会把人弹回来。
  const denied = session.status === 'authenticated'
    && !canView(page, session.user.role)
  useEffect(() => {
    if (!denied) return
    window.history.replaceState(null, '', hrefOf('assets'))
    setRoute({ page: 'assets', section: null })
  }, [denied])

  // 浏览器标签页得跟着换，不然停在"资产"上，多开几个标签就分不清了
  useEffect(() => { document.title = titleOf(page, route.section) }, [page, route.section])

  // 换页要整块重建：三页各自持有自己的取数与分节状态，复用同一棵树只会串味。
  // 重建不等于重新加载：数据留在 usePageData 的缓存里，切回来先显示上一次的
  const view = denied ? null
    : page === 'orders' ? <OrdersPage key="orders" />
      : page === 'ledger' ? <LedgerPage key="ledger" />
        : page === 'account' ? <AccountPage key="account" />
          : page === 'admin' ? <AdminPage key="admin" />
            : <StatementPage key="assets" />
  const destination: MainDestination | null = page === 'ledger' ? 'ledger'
    : page === 'assets' && ['holdings', 'perp', 'risk'].includes(route.section ?? '')
      ? route.section as MainDestination
      : page === 'assets' ? 'overview' : null

  return <AuthGate>
    {view}
    {!denied && page !== 'account' && page !== 'admin' && <BottomNavigation current={destination} />}
  </AuthGate>
}
