import { useCallback, useEffect, useState } from 'react'

// 轻量 hash 路由（PRODUCT.md §2 地址模型；无新依赖）。
// "#/knowledge/content/12?x=y" → { path: ['knowledge','content','12'], query }

export interface Route {
  path: string[]
  query: URLSearchParams
}

function parse(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '')
  const [p, q] = raw.split('?')
  const path = p.split('/').filter(Boolean)
  return { path, query: new URLSearchParams(q ?? '') }
}

export function navigate(to: string) {
  window.location.hash = to.startsWith('#') ? to : `#${to}`
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parse)
  const onChange = useCallback(() => setRoute(parse()), [])
  useEffect(() => {
    if (!window.location.hash) window.location.replace('#/today') // 默认落点=今日（PRODUCT.md §1）
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [onChange])
  return route
}
