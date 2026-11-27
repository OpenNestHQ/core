'use client'

import { createContext, useContext, useState } from 'react'
import { newId } from '@/lib/shared/id'

interface ThreadValue {
  /** One thread = one conversation = one simulated house on the server. */
  threadId: string
  newConversation: () => void
}

const ThreadContext = createContext<ThreadValue | null>(null)

export function ThreadProvider({ children }: { children: React.ReactNode }) {
  const [threadId, setThreadId] = useState(() => newId())
  return (
    <ThreadContext.Provider
      value={{
        threadId,
        newConversation: () => setThreadId(newId()),
      }}
    >
      {children}
    </ThreadContext.Provider>
  )
}

export function useThread(): ThreadValue {
  const value = useContext(ThreadContext)
  if (value === null) throw new Error('useThread needs a ThreadProvider')
  return value
}
