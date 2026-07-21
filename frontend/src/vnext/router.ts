import { useCallback, useEffect, useState } from 'react'

export interface Route {
  area: string
  rest: string[]
  query: URLSearchParams
}

const LEGACY: Record<string, string> = {
  today: 'desk', knowledge: 'investigate', data: 'markets', research: 'experiments', chat: 'copilot',
}

function parse(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '')
  const [pathText, queryText] = raw.split('?')
  const parts = pathText.split('/').filter(Boolean)
  const area = LEGACY[parts[0]] ?? parts[0] ?? 'desk'
  return { area, rest: parts.slice(1), query: new URLSearchParams(queryText ?? '') }
}

export function navigate(path: string) {
  window.location.hash = path.startsWith('#') ? path : `#${path.startsWith('/') ? path : `/${path}`}`
}

export function useRoute() {
  const [route, setRoute] = useState(parse)
  const update = useCallback(() => {
    const next = parse()
    const raw = window.location.hash.replace(/^#\/?/, '').split('?')[0].split('/')[0]
    if (raw && LEGACY[raw]) {
      const query = window.location.hash.includes('?') ? `?${window.location.hash.split('?')[1]}` : ''
      window.history.replaceState(null, '', `#/${next.area}${query}`)
    }
    setRoute(next)
  }, [])
  useEffect(() => {
    if (!window.location.hash) window.location.replace('#/desk')
    else update()
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [update])
  return route
}
