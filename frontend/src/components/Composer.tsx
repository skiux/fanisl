import { useRef, useState, type KeyboardEvent } from 'react'
import { ArrowUp, Square } from '@phosphor-icons/react'

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
  const ref = useRef<HTMLTextAreaElement>(null)

  const grow = () => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }

  const send = () => {
    const t = text.trim()
    if (!t || streaming) return
    onSend(t)
    setText('')
    if (ref.current) ref.current.style.height = 'auto'
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="px-5 pb-5 pt-1">
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex items-end gap-2 rounded-[26px] border border-zinc-200/80 bg-white px-2 py-1.5 shadow-[0_1px_2px_rgba(24,24,27,0.04)] transition-shadow focus-within:border-zinc-300 focus-within:shadow-[0_0_0_1px_rgba(24,24,27,0.06),0_4px_16px_rgba(24,24,27,0.06)]">
          <textarea
            ref={ref}
            rows={1}
            value={text}
            onChange={(e) => { setText(e.target.value); grow() }}
            onKeyDown={onKey}
            placeholder="问点什么，例如：BTC 现在多周期怎么看？"
            className="max-h-[200px] flex-1 resize-none bg-transparent px-3 py-2 text-[14px] leading-relaxed text-zinc-800 outline-none placeholder:text-zinc-400"
          />
          {streaming ? (
            <button
              onClick={onStop}
              title="停止生成（Esc）"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-zinc-900 text-white transition-colors hover:bg-zinc-700 active:translate-y-px"
            >
              <Square size={15} weight="fill" />
            </button>
          ) : (
            <button
              onClick={send}
              disabled={!text.trim()}
              title="发送（Enter）"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-600 text-white transition-colors hover:bg-emerald-500 active:translate-y-px disabled:bg-zinc-200 disabled:text-zinc-400"
            >
              <ArrowUp size={17} weight="bold" />
            </button>
          )}
        </div>
        <p className="mt-2 text-center text-[11px] text-zinc-400">
          Enter 发送 · Shift+Enter 换行 · 生成时 Esc 停止
        </p>
      </div>
    </div>
  )
}
