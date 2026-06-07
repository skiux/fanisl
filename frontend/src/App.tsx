import { useState, type ReactNode } from 'react'
import { ChartLineUp, ChatCircle, CurrencyBtc, Lightning, Pulse } from '@phosphor-icons/react'
import PriceTicker from './components/PriceTicker'
import Sidebar from './components/Sidebar'
import ChatView from './components/ChatView'
import { useConversations } from './useConversations'
import Derivatives from './market/pages/Derivatives'
import Catalysts from './market/pages/Catalysts'
import Sentiment from './market/pages/Sentiment'
import Onchain from './market/pages/Onchain'

type View = 'chat' | 'derivatives' | 'catalysts' | 'sentiment' | 'onchain'

const NAV: { key: View; label: string; icon: ReactNode }[] = [
  { key: 'chat', label: '对话', icon: <ChatCircle size={16} weight="bold" /> },
  { key: 'derivatives', label: '持仓·衍生品', icon: <ChartLineUp size={16} weight="bold" /> },
  { key: 'catalysts', label: '事件·催化', icon: <Lightning size={16} weight="bold" /> },
  { key: 'sentiment', label: '情绪·注意力', icon: <Pulse size={16} weight="bold" /> },
  { key: 'onchain', label: '链上', icon: <CurrencyBtc size={16} weight="bold" /> },
]

export default function App() {
  const { conversations, refresh } = useConversations()
  const [activeId, setActiveId] = useState<number | null>(null)
  const [view, setView] = useState<View>('chat')

  return (
    <div className="flex h-full">
      {view === 'chat' && (
        <Sidebar
          conversations={conversations}
          activeId={activeId}
          onNew={() => setActiveId(null)}
          onSelect={setActiveId}
          onDeleted={(id) => {
            if (id === activeId) setActiveId(null)
            refresh()
          }}
          onRenamed={refresh}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-5 py-2.5">
          <div className="flex items-center gap-5">
            <h1 className="text-sm font-semibold tracking-tight text-zinc-900">fanisl</h1>
            <nav className="flex gap-0.5">
              {NAV.map((n) => {
                const on = view === n.key
                return (
                  <button
                    key={n.key}
                    onClick={() => setView(n.key)}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors active:translate-y-px ${
                      on ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800'
                    }`}
                  >
                    {n.icon}
                    {n.label}
                  </button>
                )
              })}
            </nav>
          </div>
          <span className="text-xs text-zinc-400">仅盘面解读，非投资建议</span>
        </header>

        {/* 对话视图常驻挂载、仅切换可见性，避免切页后丢失消息（需刷新才回来）*/}
        <div className={`flex min-h-0 flex-1 flex-col ${view === 'chat' ? '' : 'hidden'}`}>
          <PriceTicker />
          <ChatView
            conversationId={activeId}
            onCreated={(id) => {
              setActiveId(id)
              refresh()
            }}
            onActivity={refresh}
          />
        </div>
        {view === 'derivatives' && <Derivatives />}
        {view === 'catalysts' && <Catalysts />}
        {view === 'sentiment' && <Sentiment />}
        {view === 'onchain' && <Onchain />}
      </div>
    </div>
  )
}
