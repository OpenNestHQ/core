import type {
  Program,
  Statement,
  Segment,
  Selector,
  Value,
  Expr,
  CollectionModifier,
  ComparisonOp,
  SimpleCondition,
  ConditionExpr,
} from '../ast/types.js'

export interface ParseErrorInfo {
  message: string
  line: number
  column: number
}

export interface ParseResult {
  program: Program
  errors: ParseErrorInfo[]
}

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly column: number,
  ) {
    super(message)
    this.name = 'ParseError'
  }
}

function toErrorInfo(err: ParseError): ParseErrorInfo {
  return { message: err.message, line: err.line, column: err.column }
}

function parseSegment(raw: string, line: number, col: number): Segment {
  let identifier = raw
  let isVariable = false

  if (identifier.startsWith('$')) {
    identifier = identifier.slice(1)
    isVariable = true
  }

  const idMatch = identifier.match(/^([a-zA-Z_]\w*)(.*)$/)
  if (!idMatch) {
    throw new ParseError(
      `Invalid path segment: "${raw}"`,
      line,
      col + raw.indexOf('.') + 1,
    )
  }

  const name = idMatch[1]!
  let remaining = idMatch[2]!

  const selectors: Selector[] = []
  while (remaining) {
    const bMatch = remaining.match(/^\[([^\]]+)\]/)
    if (!bMatch) {
      throw new ParseError(`Invalid path segment: "${raw}"`, line, col)
    }
    const content = bMatch[1]!
    remaining = remaining.slice(bMatch[0].length)

    if (content === '*') {
      selectors.push({ kind: 'wildcard' })
    } else if (content.startsWith('owner:')) {
      const ownerName = content.slice(6)
      if (!/^[a-zA-Z_]\w*$/.test(ownerName)) {
        throw new ParseError(
          `Invalid owner name "${ownerName}" in segment: "${raw}"`,
          line,
          col,
        )
      }
      selectors.push({ kind: 'owner', name: ownerName })
    } else if (content.startsWith('tag:')) {
      const tagName = content.slice(4)
      if (!/^[a-zA-Z_]\w*$/.test(tagName)) {
        throw new ParseError(
          `Invalid tag name "${tagName}" in segment: "${raw}"`,
          line,
          col,
        )
      }
      selectors.push({ kind: 'tag', name: tagName })
    } else if (/^[a-zA-Z_]\w*$/.test(content)) {
      selectors.push({ kind: 'room', name: content })
    } else {
      throw new ParseError(
        `Invalid bracket content "[${content}]" in segment: "${raw}"`,
        line,
        col,
      )
    }
  }

  if (isVariable && selectors.length > 0) {
    throw new ParseError(
      `Variable references cannot have a room selector: "${raw}"`,
      line,
      col,
    )
  }

  if (name === 'it' && !isVariable) {
    throw new ParseError(
      `Bare "it" is not a device type — use $it for the context reference: "${raw}"`,
      line,
      col,
    )
  }

  return {
    identifier: name,
    selectors,
    ...(isVariable ? { isVariable: true } : {}),
  }
}

function parsePath(raw: string, line: number): Segment[] {
  const col = raw.length - raw.trimStart().length + 1
  return raw.split('.').map(seg => parseSegment(seg.trim(), line, col))
}

function parseValue(raw: string, line: number, col: number): Value {
  const trimmed = raw.trim()

  if (trimmed === 'on' || trimmed === 'off') {
    return { kind: 'power', value: trimmed }
  }

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return { kind: 'number', value: Number(trimmed) }
  }

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return { kind: 'string', value: trimmed.slice(1, -1) }
  }

  if (/^[a-zA-Z_]\w*$/.test(trimmed)) {
    return { kind: 'identifier', value: trimmed }
  }

  throw new ParseError(`Invalid value: "${trimmed}"`, line, col)
}

function parseDeviceRef(
  raw: string,
  line: number,
  col: number,
): { deviceType: string; selectors: Selector[] } {
  const idMatch = raw.match(/^([a-zA-Z_]\w*)(.*)$/)
  if (!idMatch) {
    throw new ParseError(`Invalid device reference: "${raw}"`, line, col)
  }

  const deviceType = idMatch[1]!
  let remaining = idMatch[2]!

  const selectors: Selector[] = []
  while (remaining) {
    const bMatch = remaining.match(/^\[([^\]]+)\]/)
    if (!bMatch) {
      throw new ParseError(`Invalid device reference: "${raw}"`, line, col)
    }
    const content = bMatch[1]!
    remaining = remaining.slice(bMatch[0].length)

    if (content === '*') {
      selectors.push({ kind: 'wildcard' })
    } else if (content.startsWith('owner:')) {
      const ownerName = content.slice(6)
      if (!/^[a-zA-Z_]\w*$/.test(ownerName)) {
        throw new ParseError(
          `Invalid owner name "${ownerName}" in reference: "${raw}"`,
          line,
          col,
        )
      }
      selectors.push({ kind: 'owner', name: ownerName })
    } else if (content.startsWith('tag:')) {
      const tagName = content.slice(4)
      if (!/^[a-zA-Z_]\w*$/.test(tagName)) {
        throw new ParseError(
          `Invalid tag name "${tagName}" in reference: "${raw}"`,
          line,
          col,
        )
      }
      selectors.push({ kind: 'tag', name: tagName })
    } else if (/^[a-zA-Z_]\w*$/.test(content)) {
      selectors.push({ kind: 'room', name: content })
    } else {
      throw new ParseError(
        `Invalid bracket content "[${content}]" in reference: "${raw}"`,
        line,
        col,
      )
    }
  }

  return { deviceType, selectors }
}

function parseExpr(raw: string, line: number, col: number): Expr {
  const trimmed = raw.trim()

  const collectionMatch = trimmed.match(/^@(all|first|oneof)\((.+)\)$/)
  if (collectionMatch) {
    const modifier = `@${collectionMatch[1]}` as CollectionModifier
    const device = parseDeviceRef(
      collectionMatch[2]!.trim(),
      line,
      col + collectionMatch[1]!.length + 2,
    )
    return { kind: 'collection', modifier, device }
  }

  if (trimmed === 'on' || trimmed === 'off') {
    return { kind: 'power', value: trimmed }
  }

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return { kind: 'number', value: Number(trimmed) }
  }

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return { kind: 'string', value: trimmed.slice(1, -1) }
  }

  const deviceMatch = trimmed.match(/^([a-zA-Z_]\w*)(.*)$/)
  if (deviceMatch) {
    const deviceRef = parseDeviceRef(trimmed, line, col)
    return {
      kind: 'device_ref',
      deviceType: deviceRef.deviceType,
      selectors: deviceRef.selectors,
    }
  }

  throw new ParseError(`Invalid expression: "${trimmed}"`, line, col)
}

function parseStatement(raw: string, lineNumber: number): Statement {
  const trimmed = raw.trim()
  const col = raw.length - trimmed.length + 1

  if (trimmed.length === 0) {
    throw new ParseError('Empty statement', lineNumber, 1)
  }

  const actionMatch = trimmed.match(/^(.+)\.([a-zA-Z_]\w*)\s*\(\s*\)$/)
  if (actionMatch) {
    const path = parsePath(actionMatch[1]!.trim(), lineNumber)
    path.push(
      parseSegment(
        actionMatch[2]!,
        lineNumber,
        col + actionMatch[1]!.length + 1,
      ),
    )
    return { kind: 'action', path }
  }

  const queryMatch = trimmed.match(/^(.+)\.([a-zA-Z_]\w*)\s*\?$/)
  if (queryMatch) {
    const path = parsePath(queryMatch[1]!.trim(), lineNumber)
    path.push(
      parseSegment(queryMatch[2]!, lineNumber, col + queryMatch[1]!.length + 1),
    )
    return { kind: 'query', path }
  }

  const incrMatch = trimmed.match(/^(.+)\.([a-zA-Z_]\w*)\s*\+=\s*(.+)$/)
  if (incrMatch) {
    const path = parsePath(incrMatch[1]!.trim(), lineNumber)
    path.push(
      parseSegment(incrMatch[2]!, lineNumber, col + incrMatch[1]!.length + 1),
    )
    const value = parseValue(
      incrMatch[3]!,
      lineNumber,
      col + incrMatch[0]!.indexOf('+=') + 2,
    )
    return { kind: 'increment', path, value }
  }

  const eqIndex = trimmed.indexOf('=')
  if (eqIndex !== -1) {
    const left = trimmed.slice(0, eqIndex).trim()
    const right = trimmed.slice(eqIndex + 1).trim()

    if (left.includes('.')) {
      const dotMatch = left.match(/^(.+)\.([a-zA-Z_]\w*)$/)
      if (!dotMatch) {
        throw new ParseError(
          `Invalid assignment target: "${left}"`,
          lineNumber,
          col,
        )
      }
      const path = parsePath(dotMatch[1]!, lineNumber)
      path.push(
        parseSegment(dotMatch[2]!, lineNumber, col + dotMatch[1]!.length + 1),
      )
      const value = parseValue(right, lineNumber, col + eqIndex + 1)
      return { kind: 'assignment', path, value }
    }

    if (left.startsWith('$')) {
      const name = left.slice(1).trim()
      if (name.length === 0) {
        throw new ParseError(
          `Invalid variable name: "${left}"`,
          lineNumber,
          col,
        )
      }
      if (!/^[a-zA-Z_]\w*$/.test(name)) {
        throw new ParseError(
          `Invalid variable name: "${left}"`,
          lineNumber,
          col,
        )
      }
      if (name === 'it') {
        throw new ParseError(
          `$it is reserved — "it" is the built-in context reference`,
          lineNumber,
          col,
        )
      }
      const exprCol = raw.length - trimmed.length + 1
      const value = parseExpr(right, lineNumber, exprCol + eqIndex + 1)
      return { kind: 'variable_assignment', name, value }
    }

    if (/^[a-zA-Z_]\w*$/.test(left)) {
      throw new ParseError(
        `Missing "$" prefix for variable assignment: "${left}" — did you forget "$"?`,
        lineNumber,
        col,
      )
    }

    throw new ParseError(`Invalid variable name: "${left}"`, lineNumber, col)
  }

  throw new ParseError(`Unrecognized statement: "${trimmed}"`, lineNumber, col)
}

function parseSimpleCondition(
  raw: string,
  line: number,
  col: number,
): SimpleCondition {
  const trimmed = raw.trim()
  const match = trimmed.match(/^(.+?)\?\s*(==|!=)\s*(.+)$/)
  if (!match) {
    throw new ParseError(
      `Invalid condition: "${trimmed}" — expected "<path>? == <value>"`,
      line,
      1,
    )
  }

  const pathRaw = match[1]!.trim()
  const op = match[2] as ComparisonOp
  const valueRaw = match[3]!.trim()

  const path = parsePath(pathRaw, line)
  const value = parseValue(valueRaw, line, col + match[0].indexOf(match[3]!))

  return { kind: 'condition', path, op, value }
}

function splitByTopLevel(body: string, operator: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''

  for (let i = 0; i < body.length; i++) {
    if (body[i] === '(') {
      depth++
      current += body[i]
      continue
    }
    if (body[i] === ')') {
      depth--
      current += body[i]
      continue
    }

    if (depth === 0 && operator === '&') {
      const rest = body.slice(i)
      if (rest[0] === '&') {
        parts.push(current.trim())
        current = ''
        i += 1
        continue
      }
    }

    if (depth === 0 && operator === '|') {
      const rest = body.slice(i)
      if (rest[0] === '|') {
        parts.push(current.trim())
        current = ''
        i += 1
        continue
      }
    }

    current += body[i]
  }

  const trimmed = current.trim()
  if (trimmed.length > 0) parts.push(trimmed)

  return parts.filter(p => p.length > 0)
}

function parseAtom(body: string, line: number, col: number): ConditionExpr {
  const trimmed = body.trim()

  if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    return parseOrExpr(trimmed.slice(1, -1).trim(), line, col)
  }

  return parseSimpleCondition(trimmed, line, col)
}

function parseAndExpr(body: string, line: number, col: number): ConditionExpr {
  const parts = splitByTopLevel(body, '&')
  if (parts.length === 1) return parseAtom(parts[0]!, line, col)

  let expr = parseAtom(parts[0]!, line, col)
  for (let i = 1; i < parts.length; i++) {
    expr = {
      kind: 'compound_condition',
      left: expr,
      operator: '&',
      right: parseAtom(parts[i]!, line, col),
    }
  }
  return expr
}

function parseOrExpr(body: string, line: number, col: number): ConditionExpr {
  const parts = splitByTopLevel(body, '|')
  if (parts.length === 1) return parseAndExpr(parts[0]!, line, col)

  let expr = parseAndExpr(parts[0]!, line, col)
  for (let i = 1; i < parts.length; i++) {
    expr = {
      kind: 'compound_condition',
      left: expr,
      operator: '|',
      right: parseAndExpr(parts[i]!, line, col),
    }
  }
  return expr
}

function parseConditionExpr(
  raw: string,
  line: number,
  col: number,
): ConditionExpr {
  const trimmed = raw.trim()
  const body = trimmed.replace(/^@if\s+/, '').trim()

  if (body.length === 0) {
    throw new ParseError('Missing condition after @if', line, 1)
  }

  return parseOrExpr(body, line, col)
}

function parseStatements(
  lines: string[],
  startIndex: number,
  errors: ParseErrorInfo[],
  insideIf: boolean,
): { statements: Statement[]; endIndex: number; elseSeen: boolean } {
  const statements: Statement[] = []
  let i = startIndex

  while (i < lines.length) {
    const line = lines[i]!
    const trimmed = line.trim()
    const col = line.length - trimmed.length + 1

    if (trimmed.length === 0) {
      i++
      continue
    }

    if (trimmed === '@endif') {
      if (!insideIf) {
        errors.push({
          message: '@endif outside of @if block',
          line: i + 1,
          column: 1,
        })
        i++
        continue
      }
      return { statements, endIndex: i + 1, elseSeen: false }
    }

    if (trimmed === '@else') {
      if (!insideIf) {
        errors.push({
          message: '@else outside of @if block',
          line: i + 1,
          column: 1,
        })
        i++
        continue
      }
      return { statements, endIndex: i + 1, elseSeen: true }
    }

    if (trimmed.startsWith('@if ')) {
      try {
        const condition = parseConditionExpr(trimmed, i + 1, col)
        const thenBlock = parseStatements(lines, i + 1, errors, true)
        i = thenBlock.endIndex

        let elseBody: Statement[] | undefined
        if (thenBlock.elseSeen) {
          const elseBlock = parseStatements(lines, i, errors, true)
          i = elseBlock.endIndex
          elseBody = elseBlock.statements
        }

        if (i > thenBlock.endIndex || i > 0) {
          const endLine = i > 0 ? lines[i - 1]?.trim() : ''
          if (endLine !== '@endif') {
            errors.push({
              message: `Missing @endif for @if starting at line ${i > 0 ? i : 1}`,
              line: i > 0 ? i : 1,
              column: 1,
            })
          }
        }

        statements.push({
          kind: 'if',
          condition,
          body: thenBlock.statements,
          ...(elseBody ? { elseBody } : {}),
        })
      } catch (err) {
        if (err instanceof ParseError) {
          errors.push(toErrorInfo(err))
        } else {
          errors.push({
            message: err instanceof Error ? err.message : String(err),
            line: i + 1,
            column: 1,
          })
        }
        i++
        let depth = 1
        while (i < lines.length && depth > 0) {
          const t = lines[i]!.trim()
          if (t.startsWith('@if ')) depth++
          if (t === '@endif') depth--
          i++
        }
      }
      continue
    }

    if (trimmed === '@if') {
      errors.push({
        message: `Missing condition after @if`,
        line: i + 1,
        column: 1,
      })
      i++
      continue
    }

    try {
      statements.push(parseStatement(line, i + 1))
    } catch (err) {
      if (err instanceof ParseError) {
        errors.push(toErrorInfo(err))
      } else {
        errors.push({
          message: err instanceof Error ? err.message : String(err),
          line: i + 1,
          column: 1,
        })
      }
    }
    i++
  }

  if (insideIf) {
    errors.push({
      message: `Missing @endif for @if block`,
      line: startIndex,
      column: 1,
    })
  }

  return { statements, endIndex: i, elseSeen: false }
}

export function parseHomeDSL(input: string): ParseResult {
  const lines = input.split('\n')
  const errors: ParseErrorInfo[] = []

  const { statements } = parseStatements(lines, 0, errors, false)

  return { program: { kind: 'program', statements }, errors }
}
