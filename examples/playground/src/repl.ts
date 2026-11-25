import * as readline from 'node:readline'
import { OpenNestClient } from '@opennest/sdk'
import type {
  Program,
  Device,
  UserInteraction,
  DeviceSelectionInteraction,
  ResumeAnswer,
  RunResult,
  SuggestionResponse,
  SuggestionQuestion,
} from '@opennest/sdk'
import {
  formatSuccess,
  formatInteraction,
  formatSuggestions,
  formatErrors,
  formatParseErrors,
  formatDevices,
  formatSession,
  banner,
  help,
  formatNlRetry,
  formatNlSuccess,
  formatNlFailed,
  D,
  N,
  Rcol,
} from './format.js'
import { getNlConfig, translateNlToDsl } from './agent.js'
import type { AttemptCallback } from './agent.js'
import type { TelemetryHandle } from './telemetry.js'

interface State {
  client: OpenNestClient
  devices: Device[]
  nlMode: boolean
  telemetry: TelemetryHandle | undefined
}

function createState(
  client: OpenNestClient,
  devices: Device[],
  telemetry?: TelemetryHandle,
): State {
  return {
    client,
    devices,
    nlMode: false,
    telemetry: telemetry ?? undefined,
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never

/** Parses a typed answer to a text, number or choice question; null if invalid. */
function parseInputAnswer(
  question: DistributiveOmit<SuggestionQuestion, 'key'>,
  trimmed: string,
): SuggestionResponse | null {
  if (question.type === 'text_input') {
    return { type: 'text_input', text: trimmed }
  }
  if (question.type === 'number_input') {
    const value = Number(trimmed)
    if (trimmed === '' || !Number.isFinite(value)) return null
    return { type: 'number_input', value }
  }
  const byValue = question.options.find(o => o.value === trimmed)
  const byIndex = /^\d+$/.test(trimmed)
    ? question.options[parseInt(trimmed, 10) - 1]
    : undefined
  const chosen = byValue ?? byIndex
  return chosen ? { type: 'choice', value: chosen.value } : null
}

function presentResult(
  result: RunResult,
  prevHistoryLen: number,
): UserInteraction | null {
  if (result.executed.length > prevHistoryLen) {
    process.stdout.write(formatSuccess(result, prevHistoryLen) + '\n')
  } else if (result.status === 'success') {
    process.stdout.write('  (no-ops)\n\n')
  }

  if (result.suggestions && result.suggestions.length > 0) {
    process.stdout.write(formatSuggestions(result.suggestions) + '\n')
  }

  if (result.status === 'awaiting_interaction') {
    process.stdout.write(formatInteraction(result.interaction!) + '\n')
    if (result.interaction!.type === 'device_selection') {
      const sel = result.interaction as DeviceSelectionInteraction
      process.stdout.write(
        `  \u2192 Choose a device (1-${sel.devices.length}, or :cancel): `,
      )
    }
    if (result.interaction!.type === 'confirmation') {
      process.stdout.write('  \u2192 ')
    }
    return result.interaction
  }

  if (result.status === 'error') {
    process.stdout.write(formatErrors(result.errors) + '\n')
  }

  return null
}

async function executeProgram(
  program: Program,
  state: State,
): Promise<UserInteraction | null> {
  const prevHistoryLen = state.client.getSession().history.length

  state.telemetry?.beginCycle()

  const result = await state.client.execute(program)

  state.telemetry?.endCycle(result.status === 'awaiting_interaction')
  return presentResult(result, prevHistoryLen)
}

async function handleInteraction(
  state: State,
  interaction: UserInteraction,
  answer: string,
): Promise<UserInteraction | null> {
  const trimmed = answer.trim()

  if (trimmed === ':cancel' || trimmed === ':q') {
    state.telemetry?.beginCycle()

    await state.client.cancel()

    state.telemetry?.endCycle(false)
    process.stdout.write('  Cancelled.\n\n')
    return null
  }

  let response: ResumeAnswer

  if (interaction.type === 'device_selection') {
    const idx = parseInt(trimmed, 10)
    if (isNaN(idx) || idx < 1 || idx > interaction.devices.length) {
      process.stdout.write('  Invalid choice.\n\n')
      return null
    }
    const chosen = interaction.devices[idx - 1]!
    response = {
      type: 'device_selection',
      deviceId: chosen.id,
    }
  } else if (interaction.type === 'confirmation') {
    const lower = trimmed.toLowerCase()
    const confirmed = lower === 'y' || lower === 'yes'
    if (!confirmed && lower !== 'n' && lower !== 'no') {
      process.stdout.write('  Invalid answer. Type y/n.\n\n')
      return null
    }
    response = {
      type: 'confirmation',
      confirmed,
    }
  } else if (interaction.type === 'action_parameter') {
    const values: Record<string, string> = {}
    for (const part of trimmed
      .split(',')
      .map(p => p.trim())
      .filter(Boolean)) {
      const eq = part.indexOf('=')
      if (eq === -1) {
        const only = interaction.missing[0]
        if (interaction.missing.length === 1 && only) {
          values[only.name] = part
        } else {
          process.stdout.write(
            `  Expected name=value for each missing parameter.\n\n`,
          )
          return null
        }
      } else {
        values[part.slice(0, eq).trim()] = part.slice(eq + 1).trim()
      }
    }
    response = {
      type: 'action_parameter',
      values,
    }
  } else if (
    interaction.type === 'text_input' ||
    interaction.type === 'number_input' ||
    interaction.type === 'choice'
  ) {
    const parsed = parseInputAnswer(interaction, trimmed)
    if (!parsed) {
      process.stdout.write(
        interaction.type === 'number_input'
          ? '  Invalid number.\n\n'
          : '  Invalid choice.\n\n',
      )
      return null
    }
    response = parsed
  } else {
    process.stdout.write('  Unsupported interaction type.\n\n')
    return null
  }

  const prevHistoryLen = state.client.getSession().history.length

  state.telemetry?.beginCycle()

  const result = await state.client.resumePending(response)

  state.telemetry?.endCycle(result.status === 'awaiting_interaction')
  return presentResult(result, prevHistoryLen)
}

async function answerSuggestion(
  state: State,
  n: number,
  answer: string,
): Promise<UserInteraction | null> {
  const open = state.client.getSuggestions()
  const suggestion = open[n - 1]
  if (!suggestion) {
    process.stdout.write('  No such suggestion.\n\n')
    return null
  }
  const response = parseInputAnswer(suggestion.question, answer.trim())
  if (!response) {
    process.stdout.write('  Invalid answer.\n\n')
    return null
  }

  const prevHistoryLen = state.client.getSession().history.length
  state.telemetry?.beginCycle()
  const result = await state.client.answerSuggestion(suggestion.id, response)
  state.telemetry?.endCycle(result.status === 'awaiting_interaction')
  return presentResult(result, prevHistoryLen)
}

async function executeSource(
  state: State,
  src: string,
): Promise<UserInteraction | null> {
  const feedback = state.client.analyze(src)
  if (feedback.parseErrors.length > 0) {
    process.stdout.write(
      formatParseErrors(feedback.parseErrors.map(e => e.message)) + '\n',
    )
    return null
  }

  return executeProgram(feedback.program!, state)
}

async function executeNlSource(
  state: State,
  input: string,
): Promise<UserInteraction | null> {
  process.stdout.write(`  ${D}Translating...${N}\n`)

  const onAttempt: AttemptCallback = (attempt, dsl, errors) => {
    if (errors && errors.length > 0) {
      process.stdout.write(formatNlRetry(attempt, dsl, errors) + '\n')
    }
  }

  try {
    const result = await translateNlToDsl(input, state.client, onAttempt)

    if (result.failed || !result.program) {
      process.stdout.write(formatNlFailed(result.attempts) + '\n\n')
      return null
    }

    process.stdout.write(formatNlSuccess(result.dsl) + '\n')
    return executeProgram(result.program, state)
  } catch (err: unknown) {
    process.stdout.write(
      `  ${Rcol}\u2717${err instanceof Error ? err.message : String(err)}\n\n`,
    )
    return null
  }
}

const COMMANDS = [
  ':h',
  ':help',
  ':d',
  ':devices',
  ':s',
  ':session',
  ':r',
  ':reset',
  ':q',
  ':quit',
  ':{',
  ':}',
  ':cancel',
  ':a',
  ':nl',
  ':dsl',
]

export async function startRepl(
  client: OpenNestClient,
  devices: Device[],
  telemetry?: TelemetryHandle,
): Promise<void> {
  const state = createState(client, devices, telemetry)

  function deviceTypes(): string[] {
    return [...new Set(state.devices.map(d => d.type))]
  }

  function rooms(): string[] {
    return [...new Set(state.devices.map(d => d.room))]
  }

  function completeFromList(
    line: string,
    partial: string,
    prefix: string,
    candidates: string[],
    suffix: string = '',
  ): [string[], string] {
    const hits = candidates.filter(c => c.startsWith(partial))
    const completions = hits.map(c => prefix + c + suffix)
    return [
      completions.length
        ? completions
        : candidates.map(c => prefix + c + suffix),
      line,
    ]
  }

  function isDeviceTypeContext(line: string, lastToken: string): boolean {
    if (lastToken === '' || lastToken === '=' || isModifierPrefix(lastToken))
      return false

    const cleanLine = line.trimStart()
    if (cleanLine.startsWith(lastToken)) return true

    const normalized = line.replace(/\s+/g, ' ').trim()
    const eqIdx = normalized.lastIndexOf('=')
    if (eqIdx === -1) return false

    const afterEq = normalized.slice(eqIdx + 1).trim()
    return afterEq.startsWith(lastToken)
  }

  function extractModifierInner(
    token: string,
  ): { modifier: string; inner: string } | null {
    const match = token.match(/^(@(?:all|first)\()(.*)/)
    if (!match) return null
    return { modifier: match[1]!, inner: match[2]! }
  }

  function isModifierPrefix(token: string): boolean {
    return /^@(?:all|first)\(/.test(token)
  }

  function completer(line: string): [string[], string] {
    if (line.startsWith(':')) {
      const hits = COMMANDS.filter(c => c.startsWith(line))
      return [hits.length ? hits : COMMANDS, line]
    }

    const tokens = line.split(/\s+/)
    const lastToken = tokens[tokens.length - 1] ?? ''

    if (lastToken.includes('.')) return [[], lastToken]

    if (lastToken.includes('$')) {
      const dollarIdx = lastToken.lastIndexOf('$')
      const partial = lastToken.slice(dollarIdx + 1)
      const prefix = lastToken.slice(0, dollarIdx + 1)

      const varNames = Object.keys(state.client.getSession().variables)
      if (!varNames.includes('it')) varNames.push('it')

      const hits = varNames.filter(name => name.startsWith(partial))
      const completions = hits.map(name => prefix + name)
      return [
        completions.length ? completions : varNames.map(n => prefix + n),
        lastToken,
      ]
    }

    if (lastToken.includes('[') && !lastToken.includes(']')) {
      const bracketIdx = lastToken.lastIndexOf('[')
      const partial = lastToken.slice(bracketIdx + 1)
      const prefix = lastToken.slice(0, bracketIdx + 1)

      const candidates = [...rooms(), '*']
      return completeFromList(lastToken, partial, prefix, candidates, ']')
    }

    const modifier = extractModifierInner(lastToken)
    if (modifier) {
      if (modifier.inner.includes('[') && !modifier.inner.includes(']')) {
        const bracketIdx = modifier.inner.lastIndexOf('[')
        const partial = modifier.inner.slice(bracketIdx + 1)
        const prefix =
          modifier.modifier + modifier.inner.slice(0, bracketIdx + 1)
        const candidates = [...rooms(), '*']
        return completeFromList(lastToken, partial, prefix, candidates, ']')
      }
      const candidates = deviceTypes()
      return completeFromList(
        lastToken,
        modifier.inner,
        modifier.modifier,
        candidates,
      )
    }

    if (isDeviceTypeContext(line, lastToken)) {
      const candidates = deviceTypes()
      const hits = candidates.filter(t => t.startsWith(lastToken))
      return [hits.length ? hits : candidates, lastToken]
    }

    return [[], line]
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    completer,
  })

  let pendingInteraction: UserInteraction | null = null
  let processing = false
  const queue: string[] = []

  let accumulating = false
  let buffer: string[] = []

  process.stdout.write(banner(state.devices) + '\n')

  const prompt = () => {
    if (accumulating) {
      process.stdout.write('.. ')
    } else if (!pendingInteraction) {
      process.stdout.write(state.nlMode ? '[NL] > ' : '> ')
    }
  }

  prompt()

  async function processNext(line: string): Promise<void> {
    const trimmed = line.trim()

    if (pendingInteraction) {
      const interaction = pendingInteraction
      pendingInteraction = null
      pendingInteraction = await handleInteraction(state, interaction, trimmed)
      return
    }

    if (accumulating) {
      if (trimmed === ':}') {
        accumulating = false
        if (buffer.length > 0) {
          const src = buffer.join('\n')
          pendingInteraction = state.nlMode
            ? await executeNlSource(state, src)
            : await executeSource(state, src)
        }
        buffer = []
        return
      }
      if (trimmed === '') {
        accumulating = false
        if (buffer.length > 0) {
          const src = buffer.join('\n')
          pendingInteraction = state.nlMode
            ? await executeNlSource(state, src)
            : await executeSource(state, src)
        }
        buffer = []
        return
      }
      buffer.push(trimmed)
      return
    }

    if (trimmed === ':q' || trimmed === ':quit') {
      process.stdout.write('Goodbye!\n')
      rl.close()
      return
    }
    if (trimmed === ':{') {
      accumulating = true
      buffer = []
      process.stdout.write(
        '  (multi-line mode \u2014 blank line or :} to execute)\n',
      )
      return
    }
    if (trimmed.startsWith(':{') && trimmed.length > 2) {
      accumulating = true
      buffer = [trimmed.slice(2).trim()].filter(Boolean)
      process.stdout.write(
        '  (multi-line mode \u2014 blank line or :} to execute)\n',
      )
      return
    }
    if (trimmed === ':h' || trimmed === ':help') {
      process.stdout.write(help() + '\n')
      return
    }
    if (trimmed === ':d' || trimmed === ':devices') {
      process.stdout.write(formatDevices(state.devices) + '\n')
      return
    }
    if (trimmed === ':s' || trimmed === ':session') {
      process.stdout.write(formatSession(state.client.getSession()) + '\n')
      return
    }
    if (trimmed === ':r' || trimmed === ':reset') {
      state.telemetry?.beginCycle()

      await state.client.cancel()

      state.telemetry?.endCycle(false)
      process.stdout.write('Session reset.\n\n')
      return
    }
    const answerMatch = /^:a\s+(\d+)(?:\s+(.*))?$/.exec(trimmed)
    if (answerMatch) {
      pendingInteraction = await answerSuggestion(
        state,
        parseInt(answerMatch[1]!, 10),
        answerMatch[2] ?? '',
      )
      return
    }
    if (trimmed === ':a' || trimmed.startsWith(':a ')) {
      process.stdout.write('  Usage: :a <n> <answer>\n\n')
      return
    }
    if (trimmed === ':nl') {
      if (!getNlConfig()) {
        process.stdout.write(
          `  ${Rcol}Warning: NL mode is not configured. Set OPENAI_API_KEY, or OPENAI_BASE_URL for an OpenAI-compatible provider.${N}\n`,
        )
      }
      state.nlMode = true
      process.stdout.write('  Switched to natural language mode.\n\n')
      return
    }
    if (trimmed === ':dsl') {
      state.nlMode = false
      process.stdout.write('  Switched to HomeDSL mode.\n\n')
      return
    }
    if (trimmed === '') {
      return
    }

    pendingInteraction = state.nlMode
      ? await executeNlSource(state, trimmed)
      : await executeSource(state, trimmed)
  }

  rl.on('line', (rawLine: string) => {
    if (processing) {
      queue.push(rawLine)
      return
    }
    processing = true
    processNext(rawLine).then(() => {
      if (queue.length > 0) {
        const next = queue.shift()!
        processNext(next).then(flushQueue)
      } else {
        processing = false
        prompt()
      }
    })
  })

  function flushQueue(): void {
    if (queue.length > 0) {
      const next = queue.shift()!
      processNext(next).then(flushQueue)
    } else {
      processing = false
      prompt()
    }
  }

  rl.on('close', () => {
    process.exit(0)
  })
}
