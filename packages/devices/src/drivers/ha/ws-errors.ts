import { Data } from 'effect'

/** Home Assistant refused the token. Fatal: the client stops reconnecting. */
export class HAWsAuthError extends Error {
  readonly _tag = 'HAWsAuthError'

  constructor(message: string) {
    super(message)
    this.name = 'HAWsAuthError'
  }
}

/** The socket could not be opened, dropped, or is not usable right now. */
export class HAWsConnectionError extends Data.TaggedError(
  'HAWsConnectionError',
)<{ readonly message: string; readonly cause?: unknown }> {}

export class HAWsTimeoutError extends Data.TaggedError('HAWsTimeoutError')<{
  readonly command: string
  readonly timeoutMs: number
  readonly message: string
}> {
  constructor(command: string, timeoutMs: number) {
    super({
      command,
      timeoutMs,
      message: `HA websocket command "${command}" timed out after ${timeoutMs}ms`,
    })
  }
}

/** Home Assistant answered a command with `success: false`. */
export class HAWsCommandError extends Data.TaggedError('HAWsCommandError')<{
  readonly code: string
  readonly detail: string
  readonly message: string
}> {
  constructor(code: string, detail: string) {
    super({
      code,
      detail,
      message: `HA websocket command failed: ${code} — ${detail}`,
    })
  }
}

export class HAWsClosedError extends Data.TaggedError('HAWsClosedError')<{
  readonly message: string
}> {
  constructor() {
    super({ message: 'HA websocket client is closed' })
  }
}

export class HAWsAbortedError extends Data.TaggedError('HAWsAbortedError')<{
  readonly message: string
}> {
  constructor() {
    super({ message: 'HA websocket command aborted' })
  }
}

export type HAWsError =
  | HAWsAuthError
  | HAWsConnectionError
  | HAWsTimeoutError
  | HAWsCommandError
  | HAWsClosedError
  | HAWsAbortedError
