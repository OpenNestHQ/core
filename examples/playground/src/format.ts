import type {
  VMResult,
  ExecutedStatement,
  StateChange,
  VMError,
  Device,
  Session,
  UserInteraction,
  DeviceSelectionInteraction,
} from '@opennest/sdk'

const G = '\x1b[32m'
const Y = '\x1b[33m'
const R = '\x1b[31m'
const C = '\x1b[36m'
const B = '\x1b[1m'
export const D = '\x1b[2m'
export const N = '\x1b[0m'
export const Rcol = '\x1b[31m'
const M = '\x1b[35m'

function fmt(val: unknown): string {
  if (val === null || val === undefined) return `${D}—${N}`
  if (typeof val === 'boolean') return val ? `${G}on${N}` : `${R}off${N}`
  if (typeof val === 'number') return `${Y}${val}${N}`
  return `${C}"${String(val)}"${N}`
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function changeLine(change: StateChange, resolved: Device[]): string {
  const prop = `${B}${change.property}${N}`
  const oldV = fmt(change.oldValue)
  const newV = fmt(change.newValue)
  return `    ${change.deviceId}.${prop} = ${newV} ${D}(was ${oldV})${N}`
}

function filterLine(filter: NonNullable<ExecutedStatement['filter']>): string {
  const parts = [
    `${D}filter:${N} ${filter.matched}/${filter.candidates} matched`,
  ]
  for (const exc of filter.excluded) {
    parts.push(
      `${D}\u2717${N} ${exc.deviceName} ${D}(${exc.reason}: ${exc.details})${N}`,
    )
  }
  return `    ${parts.join(' | ')}`
}

export function formatSuccess(result: VMResult, since: number = 0): string {
  const lines: string[] = []
  const entries = result.executed.slice(since)
  if (entries.length === 0) return ''

  const count = entries.length
  lines.push(
    `\n${G}${B}\u2713${N} ${G}Executed ${count} statement${count !== 1 ? 's' : ''}${N}`,
  )

  for (const exec of entries) {
    if (exec.changes.length > 0) {
      for (const change of exec.changes) {
        lines.push(changeLine(change, exec.resolvedDevices))
      }
    } else {
      const names = exec.resolvedDevices.map(d => d.name).join(', ')
      lines.push(`    ${D}${names} (no state changes)${N}`)
    }
    if (exec.filter) {
      lines.push(filterLine(exec.filter))
    }
  }
  return lines.join('\n')
}

export function formatInteraction(interaction: UserInteraction): string {
  const lines: string[] = []

  switch (interaction.type) {
    case 'device_selection':
      return formatDeviceSelection(interaction)
    case 'confirmation':
      lines.push(`\n${Y}${B}?${N} ${Y}${interaction.message}${N}`)
      lines.push(`  ${D}(y/n or :cancel)${N}`)
      return lines.join('\n')
    case 'text_input':
      lines.push(`\n${Y}${B}?${N} ${Y}${interaction.message}${N}`)
      return lines.join('\n')
    case 'number_input':
      lines.push(`\n${Y}${B}#${N} ${Y}${interaction.message}${N}`)
      return lines.join('\n')
    case 'choice':
      lines.push(`\n${Y}${B}?${N} ${Y}${interaction.message}${N}`)
      for (const opt of interaction.options) {
        lines.push(`  ${G}[${opt.value}]${N} ${opt.label}`)
      }
      return lines.join('\n')
    case 'action_parameter':
      lines.push(`\n${Y}${B}?${N} ${Y}${interaction.message}${N}`)
      for (const param of interaction.missing) {
        const hint =
          param.type === 'enum' && param.values
            ? ` ${D}(${param.values.join('/')})${N}`
            : ` ${D}(${param.type})${N}`
        lines.push(`  ${B}${param.name}${N}${hint}:`)
      }
      return lines.join('\n')
  }
}

function formatDeviceSelection(info: DeviceSelectionInteraction): string {
  const lines: string[] = []
  lines.push(`\n${Y}${B}\u26a0${N} ${Y}${info.message}${N}`)

  // Group by room for display
  const byRoom = new Map<string, typeof info.devices>()
  for (const d of info.devices) {
    const list = byRoom.get(d.room) ?? []
    list.push(d)
    byRoom.set(d.room, list)
  }

  let idx = 0
  for (const [room, devs] of byRoom) {
    for (const dev of devs) {
      const pad = String(++idx).padStart(2)
      lines.push(
        `  ${G}[${pad}]${N} ${C}${room.padEnd(10)}${N} \u2192 ${B}${dev.id}${N} ${D}(${dev.name})${N}`,
      )
    }
  }
  return lines.join('\n')
}

export function formatErrors(errors: VMError[]): string {
  const lines: string[] = []
  lines.push(
    `\n${R}${B}\u2717${N} ${R}Error${errors.length > 1 ? 's' : ''}:${N}`,
  )
  for (const err of errors) {
    lines.push(`  ${R}\u2022${N} ${err.message}`)
  }
  return lines.join('\n')
}

export function formatParseErrors(messages: string[]): string {
  const lines: string[] = []
  lines.push(
    `\n${R}${B}\u2717${N} ${R}Parse error${messages.length > 1 ? 's' : ''}:${N}`,
  )
  for (const msg of messages) {
    lines.push(`  ${R}\u2022${N} ${msg}`)
  }
  return lines.join('\n')
}

export function formatDevices(devices: Device[]): string {
  const byType = new Map<string, Device[]>()
  for (const d of devices) {
    const list = byType.get(d.type) ?? []
    list.push(d)
    byType.set(d.type, list)
  }

  const lines: string[] = []
  lines.push(`\n${B}Devices (${devices.length}):${N}`)

  for (const [type, devs] of [...byType.entries()].sort()) {
    const parts = devs.map(
      d => `${C}${d.room}${N} \u2192 ${d.id} ${D}(${d.name})${N}`,
    )
    lines.push(
      `  ${B}${type}${N} ${D}(${devs.length})${N}: ${parts.join(' | ')}`,
    )
  }
  return lines.join('\n')
}

export function formatSession(session: Session): string {
  const lines: string[] = []
  lines.push(`\n${B}Session:${N}`)

  const vars = Object.keys(session.variables)
  lines.push(
    `  ${B}Variables:${N} ${vars.length > 0 ? vars.join(', ') : `${D}(none)${N}`}`,
  )

  const itDesc = session.it
    ? `${session.it.name} (${session.it.id})`
    : `${D}null${N}`
  lines.push(`  ${B}It:${N} ${itDesc}`)

  const resolved = Object.entries(session.resolvedIds)
  if (resolved.length > 0) {
    const parts = resolved.map(([k, v]) => `${k} \u2192 ${v}`)
    lines.push(`  ${B}Resolved:${N} ${parts.join(', ')}`)
  } else {
    lines.push(`  ${B}Resolved:${N} ${D}(none)${N}`)
  }

  const resolvedVars = Object.entries(session.variableResolvedIds)
  if (resolvedVars.length > 0) {
    const parts = resolvedVars.map(([k, v]) => `${k} \u2192 ${v}`)
    lines.push(`  ${B}Variable Resolved:${N} ${parts.join(', ')}`)
  } else {
    lines.push(`  ${B}Variable Resolved:${N} ${D}(none)${N}`)
  }

  const mods = Object.entries(session.variableModifiers)
  if (mods.length > 0) {
    const parts = mods.map(([k, v]) => `${k} \u2192 ${v}`)
    lines.push(`  ${B}Modifiers:${N} ${parts.join(', ')}`)
  }

  lines.push(`  ${B}Cursor:${N} ${session.cursor}`)

  lines.push(
    `  ${B}History:${N} ${session.history.length} entr${session.history.length !== 1 ? 'ies' : 'y'}`,
  )
  return lines.join('\n')
}

export function banner(devices: Device[]): string {
  const types = [...new Set(devices.map(d => d.type))].sort()
  const typeList =
    types.length <= 4 ? types.join(', ') : types.slice(0, 3).join(', ') + '...'
  const line = `  ${devices.length} devices loaded (${typeList})`
  return `${C}${B}
\u2554${'\u2550'.repeat(48)}\u2557
\u2551${'              OpenNest Playground'.padEnd(48)}\u2551
\u2551${'  Type HomeDSL commands. :help for help.'.padEnd(48)}\u2551
\u2551${line.padEnd(48)}\u2551
\u255a${'\u2550'.repeat(48)}\u255d
${N}`
}

export function formatNlAttempt(attempt: number, dsl: string): string {
  return `\n${M}${B}\u{1f916} Attempt ${attempt}:${N}\n  ${C}${dsl}${N}`
}

export function formatNlRetry(
  attempt: number,
  dsl: string,
  errors: string[],
): string {
  const lines: string[] = []
  lines.push(`\n${M}${B}\u{1f916} Attempt ${attempt}:${N}`)
  lines.push(`  ${C}${dsl}${N}`)
  lines.push(`  ${R}\u2717 Parse errors:${N}`)
  for (const msg of errors) {
    lines.push(`    ${R}\u2022${N} ${msg}`)
  }
  lines.push(`  ${D}Retrying...${N}`)
  return lines.join('\n')
}

export function formatNlSuccess(dsl: string): string {
  return `\n${G}${B}\u{1f916} Translated to HomeDSL:${N}\n  ${C}${dsl}${N}`
}

export function formatNlFailed(attempts: number): string {
  return `\n${R}${B}\u2717${N} ${R}Translation failed after ${attempts} attempts.${N}\n  ${D}The LLM could not generate valid HomeDSL for this request.${N}`
}

export function help(): string {
  return `${B}
Commands:${N}
  ${G}HomeDSL${N} input        Execute HomeDSL statements (e.g. tv.power = on)
  ${C}:nl${N}               Switch to natural language mode
  ${C}:dsl${N}              Switch to HomeDSL mode
  ${C}:{${N}                Start multi-line input (blank line to execute)
  ${C}:}${N}                Execute accumulated multi-line input
  ${C}:h${N}, ${C}:help${N}        Show this help
  ${C}:d${N}, ${C}:devices${N}     List all registered devices
  ${C}:s${N}, ${C}:session${N}     Show session state (variables, history, etc.)
  ${C}:r${N}, ${C}:reset${N}      Reset the session
  ${C}:q${N}, ${C}:quit${N}       Exit the playground

${B}NL Mode:${N}
  Type natural language commands in NL mode (${C}:nl${N}).
  Requires ${G}OPENAI_API_KEY${N} in ${C}.env${N} file.
  Set ${C}OPENNEST_MODEL${N} to override the default model (openai/gpt-4o-mini).

${B}Tips:${N}
  - Multiple statements as one program: use ${C}:{${N}\u2026${C}:}${N} or paste
  - Use ${G}@all${N} and ${G}@first${N} modifiers: ${D}all_lights = @all(light[${N}*${D}])${N}
  - Use ${G}$it${N} to reference the last resolved device
  - When ambiguous, a numbered list will appear \u2014 type the number to choose
`
}
