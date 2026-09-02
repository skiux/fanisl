import { useEffect, useState } from 'react'
import { AccountPage } from './features/auth/AccountPage'
import { AdminPage } from './features/auth/AdminPage'
import { AuthGate } from './features/auth/AuthGate'
import { onRouteChange, readRoute, titleOf } from './lib/router'
import { LedgerPage } from './features/ledger/LedgerPage'
import { OrdersPage } from './features/orders/OrdersPage'
import { StatementPage } from './features/portfolio/StatementPage'

export default function App() {
  const [page, setPage] = useState(() => readRoute().page)
  useEffect(() => onRouteChange(() => setPage(readRoute().page)), [])
  // 浏览器标签页得跟着换，不然停在"资产"上，多开几个标签就分不清了
  useEffect(() => { document.title = titleOf(page) }, [page])

  // 换页要整块重建：三页各自持有自己的取数与分节状态，复用同一棵树只会串味
  const view = page === 'orders' ? <OrdersPage key="orders" />
    : page === 'ledger' ? <LedgerPage key="ledger" />
      : page === 'account' ? <AccountPage key="account" />
        : page === 'admin' ? <AdminPage key="admin" />
          : <StatementPage key="assets" />
  return <AuthGate>{view}</AuthGate>
}
