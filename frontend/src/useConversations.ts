import { useCallback, useEffect, useState } from 'react'
import { listConversations } from './api'
import type { Conversation } from './types'

/** 会话列表 + 手动刷新。新建/删除/改名/每轮结束后调用 refresh()。 */
export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([])

  const refresh = useCallback(async () => {
    try {
      setConversations(await listConversations())
    } catch {
      /* 后端没起时静默，价格条已会提示 */
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { conversations, refresh }
}
