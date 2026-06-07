import { useEffect, useState } from 'react'
import {
  fetchCollectionStatus,
  fetchMetrics,
  fetchStoredCatalysts,
  fetchWatchlist,
} from '../api'
import type { CatalystItem, CollectionStatus, MetricPoint, Watchlist } from '../types'

type Load<T> = { data: T | null; loading: boolean; error: boolean }

export function useWatchlist(pollMs = 20000) {
  const [state, setState] = useState<Load<Watchlist>>({ data: null, loading: true, error: false })
  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const w = await fetchWatchlist()
        if (alive) setState({ data: w, loading: false, error: false })
      } catch {
        if (alive) setState((s) => ({ data: s.data, loading: false, error: true }))
      }
    }
    tick()
    const id = setInterval(tick, pollMs)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [pollMs])
  return state
}

export function useSeries(symbol: string | null, names: string[], since?: string) {
  const [state, setState] = useState<Load<Record<string, MetricPoint[]>>>({
    data: null,
    loading: true,
    error: false,
  })
  const key = `${symbol}|${names.join(',')}|${since ?? ''}`
  useEffect(() => {
    if (!symbol) return
    let alive = true
    setState((s) => ({ data: s.data, loading: true, error: false }))
    fetchMetrics(symbol, names, since)
      .then((d) => alive && setState({ data: d, loading: false, error: false }))
      .catch(() => alive && setState({ data: null, loading: false, error: true }))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return state
}

export function useCatalysts(symbol: string | null) {
  const [state, setState] = useState<Load<CatalystItem[]>>({ data: null, loading: true, error: false })
  useEffect(() => {
    let alive = true
    setState((s) => ({ data: s.data, loading: true, error: false }))
    fetchStoredCatalysts(symbol ?? undefined)
      .then((d) => alive && setState({ data: d, loading: false, error: false }))
      .catch(() => alive && setState({ data: null, loading: false, error: true }))
    return () => {
      alive = false
    }
  }, [symbol])
  return state
}

export function useCollectionStatus(pollMs = 20000) {
  const [data, setData] = useState<CollectionStatus | null>(null)
  useEffect(() => {
    let alive = true
    const tick = () =>
      fetchCollectionStatus()
        .then((s) => alive && setData(s))
        .catch(() => {})
    tick()
    const id = setInterval(tick, pollMs)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [pollMs])
  return data
}
