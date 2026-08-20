import { useEffect, useState } from 'react'
import { onRouteChange, readRoute, titleOf } from './lib/router'
import { OrdersPage } from './features/orders/OrdersPage'
import { StatementPage } from './features/portfolio/StatementPage'

export default function App() {
  const [page, setPage] = useState(() => readRoute().page)
  useEffect(() => onRouteChange(() => setPage(readRoute().page)), [])
  // 浏览器标签页得跟着换，不然停在"资产"上，多开几个标签就分不清了
  useEffect(() => { document.title = titleOf(page) }, [page])

  // 换页要整块重建：两页各自持有自己的取数与分节状态，复用同一棵树只会串味
  if (page === 'orders') return <OrdersPage key="orders" />
  return <StatementPage key="assets" />
}
