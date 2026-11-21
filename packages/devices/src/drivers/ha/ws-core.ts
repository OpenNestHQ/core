/**
 * Effect implementation of the Home Assistant websocket client.
 *
 * Shape of the runtime:
 * - one long-lived fiber (`connectionLoop`) owns the socket: open, auth,
 *   serve with a heartbeat until it drops, back off, repeat. An auth refusal
 *   ends the loop for good.
 * - every command is a short fiber waiting on a `Deferred` that the socket
 *   `onmessage` callback completes (`pending` / `subscriptions`), or, while
 *   disconnected, on its turn in `queue`.
 * - `phase`, `socket` and the registries are plain mutable state, so
 *   `isReady()` stays synchronous and the socket callbacks never wait for a
 *   scheduler tick.
 *
 * Timing relies on two Effect v4 properties: `runFork` / `runPromise`
 * evaluate synchronously up to the first suspension (a command is sent
 * before `callService` returns), and completing a `Deferred` resumes its
 * waiters synchronously (the queue is flushed inside the `auth_ok` callback).
 */
import {
  Clock,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  Schedule,
} from 'effect'
import {
  HAWsAbortedError,
  HAWsAuthError,
  HAWsClosedError,
  HAWsCommandError,
  HAWsConnectionError,
  HAWsTimeoutError,
} from './ws-errors.js'
import type { HAWsError } from './ws-errors.js'

export interface HAIncomingMessage {
  type: string
  id?: number
  success?: boolean
  result?: unknown
  error?: { code: string; message: string }
  message?: string
  event?: unknown
}

export interface HAWsCoreConfig {
  readonly url: string
  readonly token: string
  readonly commandTimeoutMs: number
  readonly heartbeatIntervalMs: number
  readonly reconnectBaseMs: number
  readonly reconnectMaxMs: number
}

export interface HAWsCore {
  /** Forks the connection loop. No-op if it already runs. */
  readonly start: () => void
  /** Rejects everything outstanding, stops the loop and waits for it. */
  readonly close: () => Promise<void>
  readonly isReady: () => boolean
  readonly onReady: (callback: () => void) => void
  readonly whenReady: Effect.Effect<void, HAWsError>
  /** Sends now if ready, otherwise waits for the next connection. */
  readonly command: (
    message: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Effect.Effect<unknown, HAWsError>
  /** Requires a ready connection; resolves on the subscription ack. */
  readonly subscribe: (
    message: Record<string, unknown>,
    onEvent: (message: HAIncomingMessage) => void,
  ) => Effect.Effect<void, HAWsError>
}

type Phase = 'idle' | 'connecting' | 'ready' | 'stopped'

/** One socket lifetime, from `new WebSocket` to its close. */
interface Connection {
  readonly socket: WebSocket
  readonly authenticated: Deferred.Deferred<
    void,
    HAWsAuthError | HAWsConnectionError
  >
  readonly closed: Deferred.Deferred<void>
}

interface Subscription {
  readonly onEvent: (message: HAIncomingMessage) => void
  readonly ack: Deferred.Deferred<void, HAWsError>
}

/** Runs a client effect with the timers the client expects (unref'd). */
export function runPromise<A>(effect: Effect.Effect<A, HAWsError>): Promise<A> {
  return Effect.runPromise(withClientClock(effect))
}

export function makeHAWsCore(config: HAWsCoreConfig): HAWsCore {
  let phase: Phase = 'idle'
  let socket: WebSocket | null = null
  let fatal: HAWsAuthError | null = null
  let nextId = 1
  let loop: Fiber.Fiber<void> | null = null
  /** Succeeds on `auth_ok`; replaced by a fresh one when the socket drops. */
  let ready = Deferred.makeUnsafe<void, HAWsError>()

  const pending = new Map<number, Deferred.Deferred<unknown, HAWsError>>()
  const subscriptions = new Map<number, Subscription>()
  /** Commands issued while disconnected, released in order on `auth_ok`. */
  const queue: Array<Deferred.Deferred<void, HAWsError>> = []
  const readyCallbacks: Array<() => void> = []

  // --- outstanding work --------------------------------------------------

  const failInFlight = (error: HAWsError): void => {
    const responses = [...pending.values()]
    const acks = [...subscriptions.values()].map(s => s.ack)
    pending.clear()
    subscriptions.clear()
    for (const response of responses) {
      Deferred.doneUnsafe(response, Exit.fail(error))
    }
    for (const ack of acks) Deferred.doneUnsafe(ack, Exit.fail(error))
  }

  const stop = (reason: HAWsClosedError | HAWsAuthError): void => {
    if (phase === 'stopped') return
    phase = 'stopped'
    if (reason instanceof HAWsAuthError) fatal = reason
    Deferred.doneUnsafe(ready, Exit.fail(reason))
    for (const turn of queue.splice(0)) {
      Deferred.doneUnsafe(turn, Exit.fail(reason))
    }
    failInFlight(reason)
  }

  const markReady = (): void => {
    phase = 'ready'
    // A consumer callback must not take the connection loop down with it.
    for (const callback of readyCallbacks) {
      try {
        callback()
      } catch (error) {
        console.warn('HA websocket onReady callback failed:', error)
      }
    }
    Deferred.doneUnsafe(ready, Exit.void)
    for (const turn of queue.splice(0)) Deferred.doneUnsafe(turn, Exit.void)
  }

  // --- socket callbacks (synchronous) ------------------------------------

  const routeMessage = (data: unknown): void => {
    const message = parseMessage(data)
    if (!message || message.id === undefined) return
    const response = pending.get(message.id)
    if (response) {
      pending.delete(message.id)
      Deferred.doneUnsafe(response, responseExit(message))
      return
    }
    const subscription = subscriptions.get(message.id)
    if (!subscription) return
    if (message.type === 'result') {
      Deferred.doneUnsafe(subscription.ack, Exit.asVoid(responseExit(message)))
    } else {
      subscription.onEvent(message)
    }
  }

  const openSocket = (): Connection => {
    phase = 'connecting'
    const connection: Connection = {
      socket: new WebSocket(config.url),
      authenticated: Deferred.makeUnsafe(),
      closed: Deferred.makeUnsafe(),
    }
    const ws = connection.socket
    socket = ws
    let authenticated = false
    const failHandshake = (error: HAWsAuthError | HAWsConnectionError) =>
      Deferred.doneUnsafe(connection.authenticated, Exit.fail(error))

    ws.onmessage = event => {
      if (authenticated) return routeMessage(event.data)
      const message = parseMessage(event.data)
      if (message?.type === 'auth_required') {
        const failure = trySend(ws, {
          type: 'auth',
          access_token: config.token,
        })
        if (failure) {
          failHandshake(
            connectionError('HA websocket connection lost during auth'),
          )
        }
      } else if (message?.type === 'auth_ok') {
        authenticated = true
        Deferred.doneUnsafe(connection.authenticated, Exit.void)
      } else if (message?.type === 'auth_invalid') {
        failHandshake(
          new HAWsAuthError(
            `HA websocket auth failed (auth_invalid): ${message.message ?? 'no details'}`,
          ),
        )
      }
    }
    ws.onerror = () => {
      failHandshake(
        connectionError(`HA websocket connection failed: ${config.url}`),
      )
    }
    ws.onclose = () => {
      if (socket === ws) socket = null
      if (phase === 'ready') {
        phase = 'connecting'
        ready = Deferred.makeUnsafe()
      }
      failHandshake(
        connectionError('HA websocket connection closed during handshake'),
      )
      failInFlight(connectionError('HA websocket connection lost'))
      Deferred.doneUnsafe(connection.closed, Exit.void)
    }
    return connection
  }

  const closeSocket = ({ socket: ws }: Connection): void => {
    if (socket === ws) socket = null
    ws.onmessage = null
    ws.onerror = null
    ws.onclose = null
    ws.close()
  }

  // --- commands ----------------------------------------------------------

  const withTimeout =
    (message: Record<string, unknown>) =>
    <A>(effect: Effect.Effect<A, HAWsError>): Effect.Effect<A, HAWsError> =>
      Effect.timeoutOrElse(effect, {
        duration: Duration.millis(config.commandTimeoutMs),
        orElse: () =>
          Effect.fail(
            new HAWsTimeoutError(
              String(message['type']),
              config.commandTimeoutMs,
            ),
          ),
      })

  /** Sends one frame with a fresh id and waits for its response. */
  const dispatch = (
    message: Record<string, unknown>,
  ): Effect.Effect<unknown, HAWsError> =>
    Effect.suspend(() => {
      const ws = socket
      if (!ws || phase !== 'ready') {
        return Effect.fail(connectionError('HA websocket is not connected'))
      }
      const id = nextId++
      const response = Deferred.makeUnsafe<unknown, HAWsError>()
      pending.set(id, response)
      const failure = trySend(ws, { ...message, id })
      if (failure) {
        pending.delete(id)
        return Effect.fail(failure)
      }
      return Deferred.await(response).pipe(
        withTimeout(message),
        Effect.ensuring(Effect.sync(() => pending.delete(id))),
      )
    })

  /** Waits until the next `auth_ok`, leaving the queue if interrupted. */
  const waitForTurn: Effect.Effect<void, HAWsError> = Effect.suspend(() => {
    const turn = Deferred.makeUnsafe<void, HAWsError>()
    queue.push(turn)
    return Deferred.await(turn).pipe(
      Effect.onInterrupt(() =>
        Effect.sync(() => {
          const index = queue.indexOf(turn)
          if (index !== -1) queue.splice(index, 1)
        }),
      ),
    )
  })

  const command: HAWsCore['command'] = (message, signal) =>
    Effect.suspend(() => {
      if (phase === 'stopped') {
        return Effect.fail(fatal ?? new HAWsClosedError())
      }
      if (signal?.aborted) return Effect.fail(new HAWsAbortedError())
      const run =
        phase === 'ready'
          ? dispatch(message)
          : Effect.andThen(waitForTurn, dispatch(message))
      return signal ? Effect.raceFirst(run, abortedBy(signal)) : run
    })

  const subscribe: HAWsCore['subscribe'] = (message, onEvent) =>
    Effect.suspend(() => {
      const ws = socket
      if (!ws || phase !== 'ready') {
        return Effect.fail(connectionError('HA websocket is not connected'))
      }
      const id = nextId++
      const ack = Deferred.makeUnsafe<void, HAWsError>()
      subscriptions.set(id, { onEvent, ack })
      const failure = trySend(ws, { ...message, id })
      if (failure) {
        subscriptions.delete(id)
        return Effect.fail(failure)
      }
      return Deferred.await(ack).pipe(
        withTimeout(message),
        Effect.tapError(() => Effect.sync(() => subscriptions.delete(id))),
      )
    })

  // --- connection loop ---------------------------------------------------

  /** A failed ping means the link is dead: closing triggers a reconnect. */
  const heartbeat: Effect.Effect<never> = Effect.sleep(
    Duration.millis(config.heartbeatIntervalMs),
  ).pipe(
    Effect.andThen(dispatch({ type: 'ping' })),
    Effect.catch(() => Effect.sync(() => socket?.close())),
    Effect.forever,
  )

  /**
   * One socket lifetime. Succeeds with whether `auth_ok` was reached (which
   * resets the backoff); fails only on an auth refusal.
   */
  const connectOnce: Effect.Effect<boolean, HAWsAuthError> =
    Effect.acquireUseRelease(
      Effect.try({
        try: openSocket,
        catch: cause =>
          new HAWsConnectionError({ message: errorMessage(cause), cause }),
      }),
      connection =>
        Effect.gen(function* () {
          yield* Deferred.await(connection.authenticated)
          markReady()
          yield* Effect.raceFirst(Deferred.await(connection.closed), heartbeat)
          return true
        }),
      connection => Effect.sync(() => closeSocket(connection)),
    ).pipe(Effect.catchTag('HAWsConnectionError', () => Effect.succeed(false)))

  const reconnectSchedule = Schedule.exponential(
    Duration.millis(config.reconnectBaseMs),
  ).pipe(
    Schedule.modifyDelay(({ duration }) =>
      Effect.succeed(
        Duration.min(duration, Duration.millis(config.reconnectMaxMs)),
      ),
    ),
  )

  const connectionLoop: Effect.Effect<void> = Effect.gen(function* () {
    let backoff = yield* Schedule.toStepWithSleep(reconnectSchedule)
    while (true) {
      if (yield* connectOnce) {
        backoff = yield* Schedule.toStepWithSleep(reconnectSchedule)
      }
      // The schedule never ends, so its `Done` signal cannot occur.
      yield* Effect.orDie(backoff(undefined))
    }
  }).pipe(
    Effect.catchTag('HAWsAuthError', error => Effect.sync(() => stop(error))),
    // Safety net: an unexpected defect must not leave the client looking
    // ready with a dead loop; stop it so every waiter rejects instead.
    Effect.catchDefect(defect =>
      Effect.sync(() => {
        console.warn('HA websocket connection loop crashed:', defect)
        stop(new HAWsClosedError())
      }),
    ),
  )

  return {
    start: () => {
      if (loop) return
      if (phase === 'stopped') {
        phase = 'idle'
        fatal = null
        ready = Deferred.makeUnsafe()
      }
      loop = Effect.runFork(withClientClock(connectionLoop))
    },
    close: async () => {
      stop(new HAWsClosedError())
      if (loop) await Effect.runPromise(Fiber.interrupt(loop))
    },
    isReady: () => phase === 'ready',
    onReady: callback => {
      readyCallbacks.push(callback)
    },
    whenReady: Effect.suspend(() => {
      if (phase === 'ready') return Effect.void
      if (fatal) return Effect.fail(fatal)
      if (phase === 'stopped') return Effect.fail(new HAWsClosedError())
      return Deferred.await(ready)
    }),
    command,
    subscribe,
  }
}

// --- helpers ---------------------------------------------------------------

function abortedBy(
  signal: AbortSignal,
): Effect.Effect<never, HAWsAbortedError> {
  return Effect.callback(resume => {
    const onAbort = () => resume(Effect.fail(new HAWsAbortedError()))
    signal.addEventListener('abort', onAbort, { once: true })
    return Effect.sync(() => signal.removeEventListener('abort', onAbort))
  })
}

/** Returns the send failure instead of throwing it. */
function trySend(
  ws: WebSocket,
  frame: Record<string, unknown>,
): HAWsConnectionError | undefined {
  try {
    ws.send(JSON.stringify(frame))
    return undefined
  } catch (cause) {
    return new HAWsConnectionError({ message: errorMessage(cause), cause })
  }
}

function responseExit(
  message: HAIncomingMessage,
): Exit.Exit<unknown, HAWsCommandError> {
  if (message.type !== 'result') return Exit.succeed(message)
  if (message.success === true) return Exit.succeed(message.result)
  return Exit.fail(
    new HAWsCommandError(
      message.error?.code ?? 'unknown_error',
      message.error?.message ?? 'no details',
    ),
  )
}

function parseMessage(data: unknown): HAIncomingMessage | null {
  if (typeof data !== 'string') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const message = parsed as HAIncomingMessage
  if (typeof message.type !== 'string') return null
  return message
}

function connectionError(message: string): HAWsConnectionError {
  return new HAWsConnectionError({ message })
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * The default `Clock` keeps the process alive while a reconnect delay or a
 * heartbeat is pending; the client must not, so its timers are unref'd.
 * `setTimeout` is looked up at call time, which keeps fake timers working.
 */
const systemClock = Clock.Clock.defaultValue()

const unrefClock: Clock.Clock = {
  currentTimeMillisUnsafe: () => systemClock.currentTimeMillisUnsafe(),
  currentTimeMillis: systemClock.currentTimeMillis,
  currentTimeNanosUnsafe: () => systemClock.currentTimeNanosUnsafe(),
  currentTimeNanos: systemClock.currentTimeNanos,
  monotonicTimeNanosUnsafe: () => systemClock.monotonicTimeNanosUnsafe(),
  monotonicTimeNanos: systemClock.monotonicTimeNanos,
  sleep: duration =>
    Effect.callback<void>(resume => {
      const timer = setTimeout(
        () => resume(Effect.void),
        Duration.toMillis(duration),
      )
      ;(timer as { unref?: () => void }).unref?.()
      return Effect.sync(() => clearTimeout(timer))
    }),
}

function withClientClock<A, E>(
  effect: Effect.Effect<A, E>,
): Effect.Effect<A, E> {
  return Effect.provideService(effect, Clock.Clock, unrefClock)
}
