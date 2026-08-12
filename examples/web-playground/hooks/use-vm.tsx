'use client'

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useRef,
  type ReactNode,
} from 'react'
import { createSession } from '@opennest/vm'
import type { UserResponse } from '@opennest/vm'
import {
  VMAdapter,
  buildTimelineEntries,
  buildChatMessage,
  formatInteractionMessage,
} from '@/lib/vm/adapter'
import type { VMState, VMAction, VMEventLogEntry } from '@/lib/vm/types'

// ── Reducer ──

function vmReducer(state: VMState, action: VMAction): VMState {
  switch (action.type) {
    case 'SET_DEVICES':
      return { ...state, devices: action.devices }
    case 'SET_SESSION':
      return { ...state, session: action.session }
    case 'SET_STATUS':
      return { ...state, status: action.status }
    case 'SET_DSL':
      return { ...state, dslSource: action.source }
    case 'SET_POLICIES':
      return { ...state, policies: action.policies }
    case 'ADD_EXECUTED':
      return {
        ...state,
        executedStatements: [...state.executedStatements, ...action.statements],
      }
    case 'SET_ERRORS':
      return { ...state, errors: action.errors }
    case 'SET_INTERACTION':
      return { ...state, interaction: action.interaction }
    case 'ADD_EVENT':
      return { ...state, events: [...state.events, action.entry] }
    case 'ADD_MESSAGE':
      return { ...state, messages: [...state.messages, action.message] }
    case 'ADD_TIMELINE_ENTRIES':
      return {
        ...state,
        timeline: [...state.timeline, ...action.entries],
      }
    case 'RESET':
      return {
        ...state,
        session: createSession(),
        status: 'idle',
        dslSource: '',
        executedStatements: [],
        errors: [],
        interaction: null,
        events: [],
        messages: [],
        timeline: [],
      }
    default:
      return state
  }
}

const initialState: VMState = {
  devices: [],
  session: null,
  status: 'idle',
  dslSource: '',
  executedStatements: [],
  errors: [],
  interaction: null,
  policies: [],
  events: [],
  messages: [],
  timeline: [],
}

// ── Context ──

interface VMContextValue {
  state: VMState
  executeDSL: (source: string) => Promise<void>
  respondToInteraction: (response: UserResponse) => Promise<void>
  cancelExecution: () => Promise<void>
  resetAll: () => void
  runDemo: () => Promise<void>
}

const VMContext = createContext<VMContextValue | null>(null)

export function VMProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(vmReducer, initialState)
  const adapterRef = useRef<VMAdapter | null>(null)

  if (!adapterRef.current) {
    const handleEvent = (entry: VMEventLogEntry) => {
      dispatch({ type: 'ADD_EVENT', entry })
    }
    const handleSession = () => {} // handled per-call

    adapterRef.current = new VMAdapter(handleEvent, handleSession)

    dispatch({ type: 'SET_DEVICES', devices: adapterRef.current.getDevices() })
    dispatch({ type: 'SET_SESSION', session: createSession() })
    dispatch({
      type: 'SET_POLICIES',
      policies: adapterRef.current.getPolicies(),
    })
    dispatch({
      type: 'SET_DSL',
      source:
        '# Tapez du HomeDSL ci-dessous\n# Exemple: light[salon].power = on',
    })
    dispatch({
      type: 'ADD_MESSAGE',
      message: buildChatMessage(
        'system',
        '🏠 Bienvenue dans le Playground OpenNest !\n\n' +
          'Tapez du **HomeDSL** dans le chat pour interpréter du code.\n' +
          'Ou cliquez sur **Demo** pour lancer le scénario de démonstration.\n\n' +
          '**Appareils disponibles :**\n' +
          adapterRef.current
            .getDevices()
            .map(d => `• ${d.name} (${d.type}, ${d.room})`)
            .join('\n'),
      ),
    })
    dispatch({
      type: 'ADD_MESSAGE',
      message: buildChatMessage(
        'system',
        '**Middleware actifs :** ' +
          adapterRef.current
            .getPolicies()
            .map(p => p.name)
            .join(', '),
      ),
    })
  }

  const adapter = adapterRef.current

  const executeDSL = useCallback(
    async (source: string) => {
      dispatch({ type: 'SET_STATUS', status: 'running' })
      dispatch({ type: 'SET_DSL', source })

      dispatch({
        type: 'ADD_MESSAGE',
        message: buildChatMessage('user', source, source),
      })

      const prevHistoryLen = state.executedStatements.length
      const result = await adapter.executeDSL(source)

      dispatch({ type: 'SET_SESSION', session: result.session })

      if (result.executed.length > prevHistoryLen) {
        const newStmts = result.executed.slice(prevHistoryLen)
        dispatch({ type: 'ADD_EXECUTED', statements: newStmts })

        const timeline = buildTimelineEntries(result, prevHistoryLen)
        if (timeline.length > 0) {
          dispatch({ type: 'ADD_TIMELINE_ENTRIES', entries: timeline })
        }

        const summary = timeline
          .map(t => `✓ ${t.action} → ${t.deviceName}: ${t.detail}`)
          .join('\n')
        dispatch({
          type: 'ADD_MESSAGE',
          message: buildChatMessage('vm', summary || '(no-ops)'),
        })
      } else if (result.status === 'success') {
        dispatch({
          type: 'ADD_MESSAGE',
          message: buildChatMessage('vm', '(no-ops)'),
        })
      }

      if (result.status === 'awaiting_interaction' && result.interaction) {
        dispatch({ type: 'SET_INTERACTION', interaction: result.interaction })
        dispatch({ type: 'SET_STATUS', status: 'awaiting_interaction' })
        dispatch({
          type: 'ADD_MESSAGE',
          message: buildChatMessage(
            'vm',
            formatInteractionMessage(result.interaction),
          ),
        })
        return
      }

      if (result.status === 'error') {
        dispatch({ type: 'SET_ERRORS', errors: result.errors })
        dispatch({ type: 'SET_STATUS', status: 'error' })
        const errorMsg = result.errors.map(e => `❌ ${e.message}`).join('\n')
        dispatch({
          type: 'ADD_MESSAGE',
          message: buildChatMessage('vm', errorMsg),
        })
        return
      }

      dispatch({ type: 'SET_STATUS', status: 'idle' })
    },
    [adapter, state.executedStatements.length],
  )

  const respondToInteraction = useCallback(
    async (response: UserResponse) => {
      dispatch({ type: 'SET_STATUS', status: 'running' })
      dispatch({ type: 'SET_INTERACTION', interaction: null })

      dispatch({
        type: 'ADD_MESSAGE',
        message: buildChatMessage(
          'user',
          response.type === 'device_selection'
            ? `Selected device: ${response.deviceId}`
            : response.type === 'confirmation'
              ? `Confirmed: ${response.confirmed}`
              : 'Response sent',
        ),
      })

      const prevHistoryLen = state.executedStatements.length
      const result = await adapter.resumeInteraction(response)

      dispatch({ type: 'SET_SESSION', session: result.session })

      if (result.executed.length > prevHistoryLen) {
        const newStmts = result.executed.slice(prevHistoryLen)
        dispatch({ type: 'ADD_EXECUTED', statements: newStmts })

        const timeline = buildTimelineEntries(result, prevHistoryLen)
        if (timeline.length > 0) {
          dispatch({ type: 'ADD_TIMELINE_ENTRIES', entries: timeline })
        }

        const summary = timeline
          .map(t => `✓ ${t.action} → ${t.deviceName}: ${t.detail}`)
          .join('\n')
        dispatch({
          type: 'ADD_MESSAGE',
          message: buildChatMessage('vm', summary || 'Done.'),
        })
      }

      if (result.status === 'awaiting_interaction' && result.interaction) {
        dispatch({ type: 'SET_INTERACTION', interaction: result.interaction })
        dispatch({ type: 'SET_STATUS', status: 'awaiting_interaction' })
        dispatch({
          type: 'ADD_MESSAGE',
          message: buildChatMessage(
            'vm',
            formatInteractionMessage(result.interaction),
          ),
        })
        return
      }

      if (result.status === 'error') {
        dispatch({ type: 'SET_ERRORS', errors: result.errors })
        dispatch({ type: 'SET_STATUS', status: 'error' })
        const errorMsg = result.errors.map(e => `❌ ${e.message}`).join('\n')
        dispatch({
          type: 'ADD_MESSAGE',
          message: buildChatMessage('vm', errorMsg),
        })
        return
      }

      dispatch({ type: 'SET_STATUS', status: 'idle' })
    },
    [adapter, state.executedStatements.length],
  )

  const cancelExecution = useCallback(async () => {
    const result = await adapter.cancelExecution()
    dispatch({ type: 'SET_SESSION', session: result.session })
    dispatch({ type: 'SET_STATUS', status: 'idle' })
    dispatch({ type: 'SET_INTERACTION', interaction: null })
    dispatch({
      type: 'ADD_MESSAGE',
      message: buildChatMessage('system', 'Execution cancelled.'),
    })
  }, [adapter])

  const resetAll = useCallback(() => {
    adapter.resetSession()
    dispatch({ type: 'RESET' })
    dispatch({ type: 'SET_DEVICES', devices: adapter.getDevices() })
    dispatch({
      type: 'ADD_MESSAGE',
      message: buildChatMessage('system', 'Session reset.'),
    })
  }, [adapter])

  const runDemo = useCallback(async () => {
    dispatch({
      type: 'ADD_MESSAGE',
      message: buildChatMessage(
        'system',
        '🚀 Lancement du scénario de démo...',
      ),
    })
    await executeDSL('light[salon].power = on')
  }, [executeDSL])

  return (
    <VMContext.Provider
      value={{
        state,
        executeDSL,
        respondToInteraction,
        cancelExecution,
        resetAll,
        runDemo,
      }}
    >
      {children}
    </VMContext.Provider>
  )
}

export function useVM(): VMContextValue {
  const ctx = useContext(VMContext)
  if (!ctx) throw new Error('useVM must be used within VMProvider')
  return ctx
}
