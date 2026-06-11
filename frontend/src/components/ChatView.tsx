import { useEffect, useRef, useState } from 'react'
import MessageList from './MessageList'
import Composer from './Composer'
import { getConversation, streamChat } from '../api'
import type { Message } from '../types'

export default function ChatView({
  conversationId,
  onCreated,
  onActivity,
}: {
  conversationId: number | null
  onCreated: (id: number) => void
  onActivity: () => void
}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [streaming, setStreaming] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  // 当前视图正在展示/流式的会话 id —— 避免把"自己刚创建的会话"又重新加载冲掉
  const currentIdRef = useRef<number | null>(null)
  // 进行中的请求，用于停止（Esc / 停止按钮）
  const abortRef = useRef<AbortController | null>(null)

  // 切换会话：仅当目标与当前展示的不一致时才加载
  useEffect(() => {
    if (conversationId === currentIdRef.current) return
    currentIdRef.current = conversationId
    if (conversationId === null) {
      setMessages([])
      return
    }
    let alive = true
    getConversation(conversationId)
      .then((c) => {
        if (alive && currentIdRef.current === conversationId) setMessages(c.messages)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [conversationId])

  // Esc 停止生成
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && abortRef.current) abortRef.current.abort()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const stop = () => abortRef.current?.abort()

  const appendToLast = (delta: string) =>
    setMessages((m) => {
      const copy = m.slice()
      const last = copy[copy.length - 1]
      copy[copy.length - 1] = { role: 'assistant', content: last.content + delta }
      return copy
    })

  const send = async (text: string) => {
    setMessages((m) => [
      ...m,
      { role: 'user', content: text },
      { role: 'assistant', content: '' },
    ])
    setStreaming(true)
    setStatus('思考中…')
    const controller = new AbortController()
    abortRef.current = controller
    try {
      await streamChat(
        text,
        currentIdRef.current,
        {
          onStart: (id) => {
            if (currentIdRef.current === null) {
              currentIdRef.current = id
              onCreated(id)
            }
          },
          onStatus: (s) =>
            setStatus(
              s.tool === 'get_market_snapshot'
                ? `正在获取 ${s.input?.symbol ?? ''} 行情…`
                : '处理中…',
            ),
          onDelta: (t) => {
            setStatus(null)
            appendToLast(t)
          },
          onError: (d) => appendToLast(`\n\n**出错了：** ${d}`),
        },
        controller.signal,
      )
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        // 用户主动停止：保留已生成的内容，标注一下
        appendToLast('\n\n（已停止）')
      } else {
        appendToLast(`\n\n**连接失败：** ${e?.message ?? e}`)
      }
    } finally {
      abortRef.current = null
      setStreaming(false)
      setStatus(null)
      onActivity()
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MessageList messages={messages} status={status} />
      <Composer onSend={send} onStop={stop} streaming={streaming} />
    </div>
  )
}
