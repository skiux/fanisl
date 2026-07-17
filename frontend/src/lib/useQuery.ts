import { useCallback, useEffect, useRef, useState } from 'react'

// 取数四态（DESIGN.md R11）：loading / error / empty(由页面判断 data) / stale。
// 关键约定：失败不吞——error 必须区分于"真无数据"；轮询失败保留旧数据但暴露 error 与 asOf。
export interface Query<T> {
  data: T | null
  error: string | null
  loading: boolean // 仅首次（无数据时）为 true
  asOf: Date | null // 最近一次成功取数时刻
  refetch: () => void
}

export function useQuery<T>(
  fn: () => Promise<T>,
  deps: unknown[],
  opts?: { pollMs?: number },
): Query<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [asOf, setAsOf] = useState<Date | null>(null)
  const fnRef = useRef(fn)
  fnRef.current = fn

  const load = useCallback(async (first: boolean) => {
    if (first) setLoading(true)
    try {
      const d = await fnRef.current()
      setData(d)
      setAsOf(new Date())
      setError(null)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      if (first) setLoading(false)
    }
  }, [])

  useEffect(() => {
    setData(null)
    setError(null)
    setAsOf(null)
    load(true)
    if (!opts?.pollMs) return
    const id = setInterval(() => load(false), opts.pollMs)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  const refetch = useCallback(() => load(data == null), [load, data])
  return { data, error, loading, asOf, refetch }
}
