import { useEffect, useState } from 'react'
import AccountMenu from '../auth/AccountMenu'

export type PrimaryRoute = 'asset' | 'knowledge' | 'verification' | 'discovery' | 'evaluation' | 'chat' | 'archive' | 'console'

type AppHeaderProps = {
  current?: PrimaryRoute
  onHomeClick?: () => void
  onSearch: () => void
}

// 标的排在最前：日常使用的姿态是"我在看某个标的"，知识库是它背后的证据层（PRODUCT.md §5）。
const primaryItems = [
  { key: 'asset', label: '标的', href: '#/asset', enabled: true },
  { key: 'knowledge', label: '知识库', href: '#/knowledge', enabled: true },
  { key: 'verification', label: '验证', href: '#/verification', enabled: true },
  { key: 'discovery', label: '发现', href: '#/discovery', enabled: true },
] as const

// 资产台是**另一个应用**，但对使用者而言它就是一件研究工具，放在这一组最自然——
// 比在右侧控件堆里再挤一个链接好。它是整行里唯一一个离开本应用的入口。
const toolItems = [
  { key: 'evaluation', label: '评测', href: '#/evaluation', enabled: false },
  { key: 'chat', label: '对话', href: '#/chat', enabled: false },
  { key: 'archive', label: '档案', href: '#/archive', enabled: true },
  { key: 'console', label: '资产', href: '/console/', enabled: true },
] as const

function AppHeader({ current, onHomeClick, onSearch }: AppHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [])

  const brandClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!onHomeClick) return
    event.preventDefault()
    onHomeClick()
    setMenuOpen(false)
  }

  const renderItem = (item: (typeof primaryItems)[number] | (typeof toolItems)[number]) => {
    if (!item.enabled) {
      return <span aria-disabled="true" key={item.key}>{item.label}</span>
    }
    return (
      <a
        aria-current={current === item.key ? 'page' : undefined}
        href={item.href}
        key={item.key}
        onClick={() => setMenuOpen(false)}
      >
        {item.label}
      </a>
    )
  }

  return (
    <header className="spatial-nav">
      <a aria-label="FANISL 首页" className="brand" href="#entry" onClick={brandClick}>
        <i aria-hidden="true" /><strong>FANISL</strong>
      </a>
      <nav aria-label="主要导航" className={menuOpen ? 'open' : ''}>
        <div aria-label="知识引擎" className="nav-group nav-group-primary" role="group">
          {primaryItems.map(renderItem)}
        </div>
        <i aria-hidden="true" className="nav-divider" />
        <div aria-label="研究工具" className="nav-group nav-group-tools" role="group">
          {toolItems.map(renderItem)}
        </div>
      </nav>
      <div className="nav-actions">
        <AccountMenu />
        <button aria-label="搜索知识" className="search-trigger" onClick={onSearch} type="button">
          <span>⌕</span><em>搜索知识</em><kbd>⌘K</kbd>
        </button>
        <button
          aria-expanded={menuOpen}
          aria-label={menuOpen ? '关闭导航' : '打开导航'}
          className="menu-trigger"
          onClick={() => setMenuOpen(!menuOpen)}
          type="button"
        >
          <i /><i />
        </button>
      </div>
    </header>
  )
}


export default AppHeader
