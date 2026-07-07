import type {
  Program,
  Statement,
  Segment,
  RoomSelector,
  Value,
  Expr,
  CollectionModifier,
} from "../ast/types.js";

export interface ParseErrorInfo {
  message: string;
  line: number;
  column: number;
}

export interface ParseResult {
  program: Program;
  errors: ParseErrorInfo[];
}

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly column: number,
  ) {
    super(message);
    this.name = "ParseError";
  }
}

function toErrorInfo(err: ParseError): ParseErrorInfo {
  return { message: err.message, line: err.line, column: err.column };
}

function parseSegment(raw: string, line: number, col: number): Segment {
  let identifier = raw;
  let isVariable = false;

  if (identifier.startsWith("$")) {
    identifier = identifier.slice(1);
    isVariable = true;
  }

  const match = identifier.match(/^([a-zA-Z_]\w*)(?:\[([a-zA-Z_]\w*|\*)\])?$/);
  if (!match) {
    throw new ParseError(`Invalid path segment: "${raw}"`, line, col + raw.indexOf(".") + 1);
  }

  const name = match[1]!;
  const roomPart = match[2] ?? null;

  let roomSelector: RoomSelector | null = null;
  if (roomPart === "*") {
    roomSelector = { kind: "wildcard" };
  } else if (roomPart !== null) {
    roomSelector = { kind: "room", name: roomPart };
  }

  if (isVariable && roomSelector !== null) {
    throw new ParseError(`Variable references cannot have a room selector: "${raw}"`, line, col);
  }

  if (name === "it" && !isVariable) {
    throw new ParseError(`Bare "it" is not a device type — use $it for the context reference: "${raw}"`, line, col);
  }

  return { identifier: name, roomSelector, ...(isVariable ? { isVariable: true } : {}) };
}

function parsePath(raw: string, line: number): Segment[] {
  const col = raw.length - raw.trimStart().length + 1;
  return raw.split(".").map((seg) => parseSegment(seg.trim(), line, col));
}

function parseValue(raw: string, line: number, col: number): Value {
  const trimmed = raw.trim();

  if (trimmed === "on" || trimmed === "off") {
    return { kind: "power", value: trimmed };
  }

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return { kind: "number", value: Number(trimmed) };
  }

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return { kind: "string", value: trimmed.slice(1, -1) };
  }

  if (/^[a-zA-Z_]\w*$/.test(trimmed)) {
    return { kind: "identifier", value: trimmed };
  }

  throw new ParseError(`Invalid value: "${trimmed}"`, line, col);
}

function parseDeviceRef(raw: string, line: number, col: number): { deviceType: string; roomSelector: RoomSelector | null } {
  const match = raw.match(/^([a-zA-Z_]\w*)(?:\[([a-zA-Z_]\w*|\*)\])?$/);
  if (!match) {
    throw new ParseError(`Invalid device reference: "${raw}"`, line, col);
  }

  const deviceType = match[1]!;
  const roomPart = match[2] ?? null;

  let roomSelector: RoomSelector | null = null;
  if (roomPart === "*") {
    roomSelector = { kind: "wildcard" };
  } else if (roomPart !== null) {
    roomSelector = { kind: "room", name: roomPart };
  }

  return { deviceType, roomSelector };
}

function parseExpr(raw: string, line: number, col: number): Expr {
  const trimmed = raw.trim();

  const collectionMatch = trimmed.match(/^@(all|first)\((.+)\)$/);
  if (collectionMatch) {
    const modifier = `@${collectionMatch[1]}` as CollectionModifier;
    const device = parseDeviceRef(collectionMatch[2]!.trim(), line, col + collectionMatch[1]!.length + 2);
    return { kind: "collection", modifier, device };
  }

  if (trimmed === "on" || trimmed === "off") {
    return { kind: "power", value: trimmed };
  }

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return { kind: "number", value: Number(trimmed) };
  }

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return { kind: "string", value: trimmed.slice(1, -1) };
  }

  const deviceMatch = trimmed.match(/^([a-zA-Z_]\w*)(?:\[([a-zA-Z_]\w*|\*)\])?$/);
  if (deviceMatch) {
    return {
      kind: "device_ref",
      deviceType: deviceMatch[1]!,
      roomSelector: deviceMatch[2] === "*"
        ? { kind: "wildcard" }
        : deviceMatch[2]
          ? { kind: "room", name: deviceMatch[2] }
          : null,
    };
  }

  throw new ParseError(`Invalid expression: "${trimmed}"`, line, col);
}

function parseStatement(raw: string, lineNumber: number): Statement {
  const trimmed = raw.trim();
  const col = raw.length - trimmed.length + 1;

  if (trimmed.length === 0) {
    throw new ParseError("Empty statement", lineNumber, 1);
  }

  const actionMatch = trimmed.match(/^(.+)\.([a-zA-Z_]\w*)\s*\(\s*\)$/);
  if (actionMatch) {
    const path = parsePath(actionMatch[1]!.trim(), lineNumber);
    path.push(parseSegment(actionMatch[2]!, lineNumber, col + actionMatch[1]!.length + 1));
    return { kind: "action", path };
  }

  const queryMatch = trimmed.match(/^(.+)\.([a-zA-Z_]\w*)\s*\?$/);
  if (queryMatch) {
    const path = parsePath(queryMatch[1]!.trim(), lineNumber);
    path.push(parseSegment(queryMatch[2]!, lineNumber, col + queryMatch[1]!.length + 1));
    return { kind: "query", path };
  }

  const incrMatch = trimmed.match(/^(.+)\.([a-zA-Z_]\w*)\s*\+=\s*(.+)$/);
  if (incrMatch) {
    const path = parsePath(incrMatch[1]!.trim(), lineNumber);
    path.push(parseSegment(incrMatch[2]!, lineNumber, col + incrMatch[1]!.length + 1));
    const value = parseValue(incrMatch[3]!, lineNumber, col + incrMatch[0]!.indexOf("+=") + 2);
    return { kind: "increment", path, value };
  }

  const eqIndex = trimmed.indexOf("=");
  if (eqIndex !== -1) {
    const left = trimmed.slice(0, eqIndex).trim();
    const right = trimmed.slice(eqIndex + 1).trim();

    if (left.includes(".")) {
      const dotMatch = left.match(/^(.+)\.([a-zA-Z_]\w*)$/);
      if (!dotMatch) {
        throw new ParseError(`Invalid assignment target: "${left}"`, lineNumber, col);
      }
      const path = parsePath(dotMatch[1]!, lineNumber);
      path.push(parseSegment(dotMatch[2]!, lineNumber, col + dotMatch[1]!.length + 1));
      const value = parseValue(right, lineNumber, col + eqIndex + 1);
      return { kind: "assignment", path, value };
    }

    if (left.startsWith("$")) {
      const name = left.slice(1).trim();
      if (name.length === 0) {
        throw new ParseError(`Invalid variable name: "${left}"`, lineNumber, col);
      }
      if (!/^[a-zA-Z_]\w*$/.test(name)) {
        throw new ParseError(`Invalid variable name: "${left}"`, lineNumber, col);
      }
      if (name === "it") {
        throw new ParseError(`$it is reserved — "it" is the built-in context reference`, lineNumber, col);
      }
      const exprCol = raw.length - trimmed.length + 1;
      const value = parseExpr(right, lineNumber, exprCol + eqIndex + 1);
      return { kind: "variable_assignment", name, value };
    }

    if (/^[a-zA-Z_]\w*$/.test(left)) {
      throw new ParseError(`Missing "$" prefix for variable assignment: "${left}" — did you forget "$"?`, lineNumber, col);
    }

    throw new ParseError(`Invalid variable name: "${left}"`, lineNumber, col);
  }

  throw new ParseError(`Unrecognized statement: "${trimmed}"`, lineNumber, col);
}

export function parseHomeDSL(input: string): ParseResult {
  const lines = input.split("\n");
  const statements: Statement[] = [];
  const errors: ParseErrorInfo[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    try {
      statements.push(parseStatement(line, i + 1));
    } catch (err) {
      if (err instanceof ParseError) {
        errors.push(toErrorInfo(err));
      } else {
        errors.push({
          message: err instanceof Error ? err.message : String(err),
          line: i + 1,
          column: 1,
        });
      }
    }
  }

  return { program: { kind: "program", statements }, errors };
}
