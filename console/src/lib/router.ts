/**
 * 两级 hash 路由：`#/{页}/{分节}`。没有引入路由库——一共三页、每页几节，
 * 一个解析函数加一个 hashchange 监听就够了，装 react-router 反而是净负担。
 */
export type PageKey = 'assets' | 'orders' | 'ledger'

export const PAGES: { key: PageKey; label: string; enabled: boolean }[] = [
  { key: 'assets', label: '资产', enabled: true },
  { key: 'orders', label: '委托', enabled: true },
  { key: 'ledger', label: '流水', enabled: true },
]

export function titleOf(page: PageKey) {
  const label = PAGES.find((item) => item.key === page)?.label ?? '资产'
  return `${label} · FANISL CONSOLE`
}

const PAGE_KEYS = PAGES.map((page) => page.key)

/** 旧地址 `#/overview` 这类直接落在资产页的分节上，不要让收藏的链接失效 */
const LEGACY_ASSET_SECTIONS = ['overview', 'changes', 'holdings', 'perp']

export type Route = { page: PageKey; section: string | null }

export function readRoute(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '')
  const [first = '', second = ''] = raw.split('/')
  if (PAGE_KEYS.includes(first as PageKey)) {
    return { page: first as PageKey, section: second || null }
  }
  if (LEGACY_ASSET_SECTIONS.includes(first)) {
    return { page: 'assets', section: first }
  }
  return { page: 'assets', section: null }
}

export function hrefOf(page: PageKey, section?: string) {
  return section ? `#/${page}/${section}` : `#/${page}`
}

/** 换分节不入历史栈——前进后退应当在"页"之间走，而不是被分节切换灌满 */
export function replaceSection(page: PageKey, section: string) {
  window.history.replaceState(null, '', hrefOf(page, section))
}

export function onRouteChange(handler: () => void) {
  window.addEventListener('hashchange', handler)
  return () => window.removeEventListener('hashchange', handler)
}
