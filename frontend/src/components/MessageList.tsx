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

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-zinc-900 text-lg font-bold text-emerald-400">f</div>
        <h2 className="mt-4 text-[19px] font-semibold tracking-tight text-zinc-800">问问盘面</h2>
        <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-zinc-400">
          例如「ETH 现在多周期怎么看？」「BTC 资金费率连续负了多久？」<br />
          Claude 会实时取行情、衍生品、催化剂再作答。仅盘面解读，非投资建议。
        </p>
      </div>
    )
  }

  return (
    <div className="main-scrollbar flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-7 px-5 py-8">
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[82%] whitespace-pre-wrap rounded-2xl bg-zinc-100 px-4 py-2.5 text-[14px] leading-relaxed text-zinc-800">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={i} className="flex gap-3">
              <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-zinc-900 text-[12px] font-bold text-emerald-400">f</div>
              <div className="min-w-0 flex-1 pt-0.5">
                {m.content ? (
                  <MarkdownRenderer content={m.content} />
                ) : (
                  <span className="flex items-center gap-2 text-[13px] text-zinc-400">
                    <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                    {status ?? '思考中…'}
                  </span>
                )}
              </div>
            </div>
          ),
        )}
        <div ref={endRef} />
      </div>
    </div>
  )
}
