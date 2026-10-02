import { useEffect, useRef } from 'react'

/**
 * 页面在前台时定期静默重取；切回标签页、窗口重新获得焦点、网络恢复时，
 * 手上的数据若已超过一个周期就立刻补一次。标签页在后台时完全停掉。
 *
 * 原先三个页面都只在打开时取一次：放着不动 20 分钟就出「已过期」横幅，而成员连
 * 「重新取数」都没有（那是管理员才有的强制取数），除了刷新整个网页别无办法。
 *
 * **这里只管什么时候取，不管怎么取。** 回调里由页面发一个不强制的请求
 * （`force=false`），打不打 Binance 由后端的缓存时长决定（价格 30 秒、余额 60 秒、
 * 理财与合约收支 5 分钟……），所有人共用同一份缓存——多开几个标签页也不会成倍消耗
 * 交易所的权重。所以周期可以短，报头时间正常情况下一直落在 5 分钟以内。
 *
 * 用 setTimeout 链而不是 setInterval：每次都按"上一次请求 + 周期"排下一次，
 * 切回前台补过一次之后不会紧跟着再来一次。
 */
export function useAutoRefresh(onTick: () => void, everyMs: number, enabled: boolean) {
  // 永远调最新的那个回调：页面每次渲染都会给一个新闭包（带着当前的筛选条件）
  const tick = useRef(onTick)
  useEffect(() => {
    tick.current = onTick
  })

  useEffect(() => {
    if (!enabled) return
    // 挂载时页面自己已经发过首次请求，从现在起算
    let last = Date.now()
    let timer: ReturnType<typeof setTimeout> | undefined

    const visible = () => document.visibilityState === 'visible'
    const clear = () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    }
    const fire = () => {
      last = Date.now()
      tick.current()
    }
    const schedule = () => {
      clear()
      timer = setTimeout(() => {
        fire()
        schedule()
      }, Math.max(0, last + everyMs - Date.now()))
    }
    // 回到前台：数据比一个周期还旧就先补一次，再按新的起点排下一次
    const resume = () => {
      if (!visible()) return
      if (Date.now() - last >= everyMs) fire()
      schedule()
    }
    const onVisibility = () => (visible() ? resume() : clear())

    if (visible()) schedule()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', resume)
    window.addEventListener('online', resume)
    return () => {
      clear()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', resume)
      window.removeEventListener('online', resume)
    }
  }, [enabled, everyMs])
}
