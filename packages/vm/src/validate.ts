import type {
  Program,
  Statement,
  Assignment,
  Query,
  Increment,
  Action,
  VariableAssignment,
  SimpleCondition,
  ConditionExpr,
  Selector,
  Segment,
} from '@opennest/lang-core'
import { getRoomSelector } from '@opennest/lang-core'
import type { Device, Session, VMError } from './types.js'
import type { ResolutionIntent } from './types.js'
import { createSession } from './state.js'
import { resolveDevices } from './resolver.js'
import type { CollectionModifier } from '@opennest/lang-core'

interface ShadowVar {
  deviceType: string
  selectors: Selector[]
  modifier?: CollectionModifier
}

function error(stmt: Statement, message: string): VMError {
  return { statement: stmt, message }
}

function makeTempSession(
  shadowVars: Map<string, ShadowVar>,
  itRef: Device | null,
): Session {
  const variables: Record<
    string,
    {
      kind: 'device_ref'
      deviceType: string
      selectors: Selector[]
    }
  > = {}
  const variableModifiers: Record<string, CollectionModifier> = {}

  for (const [name, def] of shadowVars) {
    variables[name] = {
      kind: 'device_ref',
      deviceType: def.deviceType,
      selectors: def.selectors,
    }
    if (def.modifier) {
      variableModifiers[name] = def.modifier
    }
  }

  return {
    ...createSession(),
    variables,
    variableModifiers,
    it: itRef,
  }
}

function getIntent(
  stmt: Assignment | Query | Increment | Action,
): ResolutionIntent | null {
  const lastSeg = stmt.path[stmt.path.length - 1]
  if (!lastSeg) return null
  const name = lastSeg.identifier
  if (stmt.kind === 'action') return { kind: 'action', name }
  return { kind: 'property', name }
}

function extractDeviceInfo(
  firstSeg: Segment,
  shadowVars: Map<string, ShadowVar>,
  itRef: Device | null,
): { deviceType: string; selectors: Selector[] } | null {
  if (firstSeg.isVariable) {
    if (firstSeg.identifier === 'it') {
      if (!itRef) return null
      return {
        deviceType: itRef.type,
        selectors: [{ kind: 'room', name: itRef.room }],
      }
    }
    const varDef = shadowVars.get(firstSeg.identifier)
    if (!varDef) return null
    return {
      deviceType: varDef.deviceType,
      selectors: varDef.selectors,
    }
  }
  return {
    deviceType: firstSeg.identifier,
    selectors: firstSeg.selectors,
  }
}

function checkDeviceAndRoom(
  stmt: Statement,
  deviceType: string,
  selectors: Selector[],
  devices: Device[],
): VMError | null {
  const allOfType = devices.filter(d => d.type === deviceType)

  if (allOfType.length === 0) {
    return error(stmt, `No device of type '${deviceType}' found`)
  }

  const roomSelector = getRoomSelector(selectors)
  if (roomSelector?.kind === 'room') {
    const inRoom = allOfType.some(d => d.room === roomSelector.name)
    if (!inRoom) {
      return error(
        stmt,
        `No device '${deviceType}' found in room '${roomSelector.name}'`,
      )
    }
  }

  return null
}

function checkCapability(
  stmt: Statement,
  path: Segment[],
  devices: Device[],
  shadowVars: Map<string, ShadowVar>,
  itRef: Device | null,
  intent: ResolutionIntent,
): VMError | null {
  const tempSession = makeTempSession(shadowVars, itRef)
  const result = resolveDevices(path, devices, tempSession, intent)

  if (result.devices.length > 0) return null
  if (!result.filter?.excluded?.length) return null

  const ex = result.filter.excluded[0]!
  return error(stmt, ex.details)
}

function updateItRef(
  deviceType: string,
  selectors: Selector[],
  devices: Device[],
  itRef: Device | null,
): Device | null {
  let candidates = devices.filter(d => d.type === deviceType)
  const roomSelector = getRoomSelector(selectors)
  if (roomSelector?.kind === 'room') {
    candidates = candidates.filter(d => d.room === roomSelector.name)
  }
  // Only update itRef if we can uniquely determine the device
  if (candidates.length === 1) return candidates[0]!
  // If multiple matches but we have a room selector with wildcard, pick first
  if (candidates.length > 1 && roomSelector?.kind === 'wildcard')
    return candidates[0]!
  // If room selector restricts to one room and there's exactly one, pick it
  if (candidates.length === 1) return candidates[0]!
  // For multiple matches without disambiguation, don't update itRef
  return itRef
}

function validateDevicePath(
  stmt: Assignment | Query | Increment | Action,
  devices: Device[],
  shadowVars: Map<string, ShadowVar>,
  itRef: Device | null,
): { errors: VMError[]; newItRef: Device | null } {
  const firstSeg = stmt.path[0]
  if (!firstSeg) {
    return {
      errors: [error(stmt, 'Invalid statement: empty path')],
      newItRef: itRef,
    }
  }

  if (firstSeg.isVariable && firstSeg.identifier === 'it' && !itRef) {
    return {
      errors: [error(stmt, '$it is not set — no previous device referenced')],
      newItRef: itRef,
    }
  }

  if (firstSeg.isVariable && firstSeg.identifier !== 'it') {
    const varDef = shadowVars.get(firstSeg.identifier)
    if (!varDef) {
      return {
        errors: [
          error(stmt, `Variable '$${firstSeg.identifier}' is not defined`),
        ],
        newItRef: itRef,
      }
    }
  }

  const info = extractDeviceInfo(firstSeg, shadowVars, itRef)
  if (!info) {
    return {
      errors: [error(stmt, '$it is not set — no previous device referenced')],
      newItRef: itRef,
    }
  }

  const existenceErr = checkDeviceAndRoom(
    stmt,
    info.deviceType,
    info.selectors,
    devices,
  )
  if (existenceErr) {
    return { errors: [existenceErr], newItRef: itRef }
  }

  const intent = getIntent(stmt)
  if (intent) {
    const capErr = checkCapability(
      stmt,
      stmt.path,
      devices,
      shadowVars,
      itRef,
      intent,
    )
    if (capErr) {
      return { errors: [capErr], newItRef: itRef }
    }
  }

  const newItRef = updateItRef(info.deviceType, info.selectors, devices, itRef)
  return { errors: [], newItRef }
}

function validateVariableAssignment(
  stmt: VariableAssignment,
  devices: Device[],
  shadowVars: Map<string, ShadowVar>,
): VMError[] {
  if (stmt.value.kind === 'device_ref') {
    const ref = stmt.value
    const exists = devices.some(d => d.type === ref.deviceType)
    if (!exists) {
      return [error(stmt, `No device of type '${ref.deviceType}' found`)]
    }
    shadowVars.set(stmt.name, {
      deviceType: ref.deviceType,
      selectors: ref.selectors,
    })
    return []
  }

  if (stmt.value.kind === 'collection') {
    const col = stmt.value
    const devicesOfType = devices.filter(d => d.type === col.device.deviceType)

    if (devicesOfType.length === 0) {
      return [error(stmt, `No device of type '${col.device.deviceType}' found`)]
    }

    const roomSelector = getRoomSelector(col.device.selectors)
    if (roomSelector?.kind === 'room') {
      const inRoom = devicesOfType.some(d => d.room === roomSelector.name)
      if (!inRoom) {
        return [
          error(
            stmt,
            `No device '${col.device.deviceType}' found in room '${roomSelector.name}'`,
          ),
        ]
      }
    }

    shadowVars.set(stmt.name, {
      deviceType: col.device.deviceType,
      selectors: col.device.selectors,
      modifier: col.modifier,
    })
    return []
  }

  shadowVars.set(stmt.name, { deviceType: 'unknown', selectors: [] })
  return []
}

function validateSimpleCondition(
  cond: SimpleCondition,
  devices: Device[],
  shadowVars: Map<string, ShadowVar>,
  itRef: Device | null,
  parentStmt: Statement,
): { errors: VMError[]; newItRef: Device | null } {
  const firstSeg = cond.path[0]
  if (!firstSeg) return { errors: [], newItRef: itRef }

  if (firstSeg.isVariable && firstSeg.identifier === 'it' && !itRef) {
    return {
      errors: [
        error(
          parentStmt,
          '$it is not set — no previous device referenced in @if condition',
        ),
      ],
      newItRef: itRef,
    }
  }

  if (firstSeg.isVariable && firstSeg.identifier !== 'it') {
    if (!shadowVars.has(firstSeg.identifier)) {
      return {
        errors: [
          error(
            parentStmt,
            `Variable '$${firstSeg.identifier}' is not defined`,
          ),
        ],
        newItRef: itRef,
      }
    }
  }

  const info = extractDeviceInfo(firstSeg, shadowVars, itRef)
  if (!info) {
    return {
      errors: [
        error(
          parentStmt,
          '$it is not set — no previous device referenced in @if condition',
        ),
      ],
      newItRef: itRef,
    }
  }

  const existenceErr = checkDeviceAndRoom(
    parentStmt,
    info.deviceType,
    info.selectors,
    devices,
  )
  if (existenceErr) {
    return { errors: [existenceErr], newItRef: itRef }
  }

  // For @if conditions, ambiguity is treated as an error
  // BUT skip if the variable was assigned with @oneof (interaction will resolve it)
  const isOneof =
    firstSeg.isVariable &&
    firstSeg.identifier !== 'it' &&
    shadowVars.get(firstSeg.identifier)?.modifier === '@oneof'

  if (!isOneof) {
    const matches = devices.filter(d => d.type === info.deviceType)
    const roomSelector = getRoomSelector(info.selectors)
    if (roomSelector?.kind === 'room') {
      const inRoom = matches.filter(d => d.room === roomSelector.name)
      if (inRoom.length > 1) {
        return {
          errors: [
            error(
              parentStmt,
              `Multiple devices matched in @if condition: '${info.deviceType}[${roomSelector.name}]' matches ${inRoom.length} devices. Use @oneof to pre-resolve`,
            ),
          ],
          newItRef: itRef,
        }
      }
    } else if (!roomSelector && matches.length > 1) {
      return {
        errors: [
          error(
            parentStmt,
            `Ambiguous device in @if condition: '${info.deviceType}' matches ${matches.length} devices. Use @oneof to pre-resolve or specify a room`,
          ),
        ],
        newItRef: itRef,
      }
    }
  }

  const newItRef = updateItRef(info.deviceType, info.selectors, devices, itRef)
  return { errors: [], newItRef }
}

function validateConditionExpr(
  cond: ConditionExpr,
  devices: Device[],
  shadowVars: Map<string, ShadowVar>,
  itRef: Device | null,
  parentStmt: Statement,
): { errors: VMError[]; newItRef: Device | null } {
  if (cond.kind === 'condition') {
    return validateSimpleCondition(cond, devices, shadowVars, itRef, parentStmt)
  }
  const left = validateConditionExpr(
    cond.left,
    devices,
    shadowVars,
    itRef,
    parentStmt,
  )
  const right = validateConditionExpr(
    cond.right,
    devices,
    shadowVars,
    left.newItRef,
    parentStmt,
  )
  return {
    errors: [...left.errors, ...right.errors],
    newItRef: right.newItRef,
  }
}

function validateStatements(
  stmts: Statement[],
  devices: Device[],
  shadowVars: Map<string, ShadowVar>,
  itRef: Device | null,
): { errors: VMError[]; itRef: Device | null } {
  const errors: VMError[] = []

  for (const stmt of stmts) {
    switch (stmt.kind) {
      case 'assignment':
      case 'query':
      case 'increment':
      case 'action': {
        const result = validateDevicePath(stmt, devices, shadowVars, itRef)
        errors.push(...result.errors)
        if (result.newItRef) itRef = result.newItRef
        break
      }
      case 'variable_assignment': {
        errors.push(...validateVariableAssignment(stmt, devices, shadowVars))
        break
      }
      case 'if': {
        const condResult = validateConditionExpr(
          stmt.condition,
          devices,
          shadowVars,
          itRef,
          stmt,
        )
        errors.push(...condResult.errors)

        if (condResult.errors.length === 0) {
          const bodyItRef = condResult.newItRef ?? itRef
          const bodyVars = new Map(shadowVars)
          const bodyResult = validateStatements(
            stmt.body,
            devices,
            bodyVars,
            bodyItRef,
          )
          errors.push(...bodyResult.errors)

          if (stmt.elseBody) {
            const elseVars = new Map(shadowVars)
            const elseResult = validateStatements(
              stmt.elseBody,
              devices,
              elseVars,
              bodyItRef,
            )
            errors.push(...elseResult.errors)
          }
        }
        break
      }
    }
  }

  return { errors, itRef }
}

export function validateProgram(
  program: Program,
  devices: Device[],
  existingSession?: Session,
): VMError[] {
  const shadowVars = new Map<string, ShadowVar>()
  let itRef: Device | null = null

  if (existingSession) {
    itRef = existingSession.it
    for (const [name, ref] of Object.entries(existingSession.variables)) {
      const modifier = existingSession.variableModifiers[name]
      const entry: ShadowVar = {
        deviceType: ref.deviceType,
        selectors: ref.selectors,
      }
      if (modifier) {
        entry.modifier = modifier
      }
      shadowVars.set(name, entry)
    }
  }

  const result = validateStatements(
    program.statements,
    devices,
    shadowVars,
    itRef,
  )
  return result.errors
}
