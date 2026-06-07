import { useState } from 'react'
import { deleteConversation, renameConversation } from '../api'
import type { Conversation } from '../types'

function relativeTime(iso: string): string {
  const sec = (Date.now() - new Date(iso).getTime()) / 1000
  if (sec < 60) return '刚刚'
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟前`
  if (sec < 86400) return `${Math.floor(sec / 3600)} 小时前`
  return `${Math.floor(sec / 86400)} 天前`
}

export default function Sidebar({
  conversations,
  activeId,
  onNew,
  onSelect,
  onDeleted,
  onRenamed,
}: {
  conversations: Conversation[]
  activeId: number | null
  onNew: () => void
  onSelect: (id: number) => void
  onDeleted: (id: number) => void
  onRenamed: () => void
}) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState('')

  const startEdit = (c: Conversation) => {
    setEditingId(c.id)
    setDraft(c.title)
  }

  const commitEdit = async (id: number) => {
    const t = draft.trim()
    setEditingId(null)
    if (t) {
      try {
        await renameConversation(id, t)
        onRenamed()
      } catch {
        /* 失败则不改 UI */
      }
    }
  }

  const remove = async (id: number) => {
    try {
      await deleteConversation(id)
      onDeleted(id)
    } catch {
      /* 失败则保留 */
    }
  }

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-gray-200 bg-gray-50">
      <div className="p-3">
        <button
          onClick={onNew}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
        >
          ＋ 新建对话
        </button>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-3">
        {conversations.length === 0 && (
          <div className="px-2 py-6 text-center text-xs text-gray-400">还没有对话</div>
        )}
        {conversations.map((c) => {
          const active = c.id === activeId
          return (
            <div
              key={c.id}
              onClick={() => editingId !== c.id && onSelect(c.id)}
              className={`group flex cursor-pointer items-center gap-1 rounded-lg px-2.5 py-2 ${
                active ? 'bg-blue-100' : 'hover:bg-gray-100'
              }`}
            >
              {editingId === c.id ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commitEdit(c.id)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitEdit(c.id)
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  className="min-w-0 flex-1 rounded border border-blue-300 px-1 py-0.5 text-sm focus:outline-none"
                />
              ) : (
                <div
                  className="min-w-0 flex-1"
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    startEdit(c)
                  }}
                  title="双击重命名"
                >
                  <div className="truncate text-sm text-gray-800">{c.title}</div>
                  <div className="text-[11px] text-gray-400">{relativeTime(c.updated_at)}</div>
                </div>
              )}

              {editingId !== c.id && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    remove(c.id)
                  }}
                  className="shrink-0 rounded p-1 text-gray-400 opacity-0 transition hover:bg-gray-200 hover:text-red-600 group-hover:opacity-100"
                  title="删除"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>
              )}
            </div>
          )
        })}
      </div>
    </aside>
  )
}
