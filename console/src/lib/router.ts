/**
 * 两级 hash 路由：`#/{页}/{分节}`。没有引入路由库——一共三页、每页几节，
 * 一个解析函数加一个 hashchange 监听就够了，装 react-router 反而是净负担。
 */
export type PageKey = 'assets' | 'orders' | 'ledger' | 'account' | 'admin'

export const PAGES: { key: PageKey; label: string; enabled: boolean }[] = [
  { key: 'assets', label: '资产', enabled: true },
  { key: 'orders', label: '委托', enabled: true },
  { key: 'ledger', label: '流水', enabled: true },
]

const EXTRA_TITLES: Partial<Record<PageKey, string>> = { account: '账号', admin: '用户管理' }

export function titleOf(page: PageKey) {
  const label = EXTRA_TITLES[page]
    ?? PAGES.find((item) => item.key === page)?.label
    ?? '资产'
  return `${label} · FANISL CONSOLE`
}

// 账号与用户管理都不在主导航里：前者是自己的事、后者只对管理员可见，
// 两个入口都放在报头右上角（见 Masthead）。把用户管理放进 PAGES 的话，
// 成员登录后会看到一个点进去就 403 的标签。
const PAGE_KEYS: PageKey[] = [...PAGES.map((page) => page.key), 'account', 'admin']

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

/**
 * 这一页这个角色能不能看。
 *
 * 后端才是权威（`/admin/*` 会 403），这里只是不要把人领到一扇打不开的门前：
 * 成员进 `#/admin` 应当直接退回资产页，而不是先看见"用户管理"的标题、
 * 再看见一屏错误——那把权限问题讲成了故障。
 */
export function canView(page: PageKey, role: 'admin' | 'member') {
  return page !== 'admin' || role === 'admin'
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
