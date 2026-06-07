import { useEffect, useRef } from 'react'
import MarkdownRenderer from './MarkdownRenderer'
import type { Message } from '../types'

export default function MessageList({
  messages,
  status,
}: {
  messages: Message[]
  status: string | null
}) {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, status])

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 space-y-5">
      {messages.length === 0 && (
        <div className="mt-24 text-center text-sm text-gray-400">
          输入一个币种问问盘面，例如 “ETH 现在怎么看？”
          <br />
          <span className="text-xs">（仅盘面解读，不构成投资建议）</span>
        </div>
      )}

      {messages.map((m, i) =>
        m.role === 'user' ? (
          <div key={i} className="flex justify-end">
            <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-blue-600 px-4 py-2 text-sm text-white">
              {m.content}
            </div>
          </div>
        ) : (
          <div key={i} className="flex justify-start">
            <div className="max-w-[88%] rounded-2xl border border-gray-200 bg-white px-4 py-3">
              {m.content ? (
                <MarkdownRenderer content={m.content} />
              ) : (
                <span className="flex items-center gap-2 text-sm text-gray-400">
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-gray-400" />
                  {status ?? '思考中…'}
                </span>
              )}
            </div>
          </div>
        ),
      )}
      <div ref={endRef} />
    </div>
  )
}
