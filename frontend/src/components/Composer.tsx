import { useState, type KeyboardEvent } from 'react'

export default function Composer({
  onSend,
  onStop,
  streaming,
}: {
  onSend: (text: string) => void
  onStop: () => void
  streaming: boolean
}) {
  const [text, setText] = useState('')

  const send = () => {
    const t = text.trim()
    if (!t || streaming) return
    onSend(t)
    setText('')
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="flex items-end gap-2 border-t border-gray-200 bg-white p-4">
      <textarea
        className="max-h-40 flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-400"
        rows={1}
        placeholder="问点什么，例如：BTC 现在多周期怎么看？（Enter 发送，生成时 Esc 停止）"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        disabled={streaming}
      />
      {streaming ? (
        <button
          onClick={onStop}
          className="shrink-0 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
          title="停止生成（Esc）"
        >
          停止
        </button>
      ) : (
        <button
          onClick={send}
          disabled={!text.trim()}
          className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-40"
        >
          发送
        </button>
      )}
    </div>
  )
}
