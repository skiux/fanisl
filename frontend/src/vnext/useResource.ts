import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react'

export interface Resource<T> {
  data: T | null
  error: Error | null
  loading: boolean
  updatedAt: Date | null
  reload: () => void
}

export function useResource<T>(loader: () => Promise<T>, deps: DependencyList, pollMs?: number): Resource<T> {
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(true)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((n) => n + 1), [])

  useEffect(() => {
    let active = true
    const run = async () => {
      if (data == null) setLoading(true)
      try {
        const next = await loaderRef.current()
        if (!active) return
        setData(next)
        setError(null)
        setUpdatedAt(new Date())
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause : new Error(String(cause)))
      } finally {
        if (active) setLoading(false)
      }
    }
    run()
    const timer = pollMs ? window.setInterval(run, pollMs) : null
    return () => {
      active = false
      if (timer) window.clearInterval(timer)
    }
  // The caller owns the dependency list, matching React query-hook semantics.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version, pollMs])

  return { data, error, loading, updatedAt, reload }
}
