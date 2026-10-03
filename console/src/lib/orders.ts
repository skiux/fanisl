import type { Order } from '../api/types'

/**
 * 委托价（或触发价）离现价还有多远，带方向。这不是盈亏，界面上不染绿红。
 * 原先在单独的「委托」页（features/orders），那一页 2026-10-03 删了，委托改在合约与持仓页看。
 */
export function gapOf(order: Order) {
  const target = order.stop_price ?? order.price ?? order.activate_price
  if (target === null || order.reference_price === null || order.reference_price === 0) return null
  return (target - order.reference_price) / order.reference_price
}

/** 委托价值：名义金额合计。`closePosition` 的保护单没有数量，名义是 null，不计 */
export function orderValue(orders: Order[]) {
  return orders.reduce((sum, order) => sum + (order.notional_usd ?? 0), 0)
}
