export type AppRoute = 'home' | 'asset' | 'knowledge' | 'verification' | 'discovery' | 'archive'

export function routeFromHash(hash: string): AppRoute {
  if (hash.startsWith('#/asset')) return 'asset'
  if (hash.startsWith('#/knowledge')) return 'knowledge'
  if (hash.startsWith('#/verification')) return 'verification'
  if (hash.startsWith('#/discovery')) return 'discovery'
  if (hash.startsWith('#/archive')) return 'archive'
  return 'home'
}

export function titleForRoute(route: AppRoute) {
  if (route === 'asset') return '标的 · FANISL'
  if (route === 'knowledge') return '知识库 · FANISL'
  if (route === 'verification') return '验证中心 · FANISL'
  if (route === 'discovery') return '发现 · FANISL'
  if (route === 'archive') return '研究档案 · FANISL'
  return 'FANISL · 个人投资知识引擎'
}
