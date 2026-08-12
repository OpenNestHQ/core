import type {
  Action,
  Assignment,
  Increment,
  Program,
  Query,
  RoomSelector,
  Selector,
  Segment,
  Statement,
  Value,
} from './types.js'

export function buildRoomSelector(room: string): RoomSelector {
  return room === '*' ? { kind: 'wildcard' } : { kind: 'room', name: room }
}

export function buildOwnerSelector(name: string): Selector {
  return { kind: 'owner', name }
}

export function buildTagSelector(name: string): Selector {
  return { kind: 'tag', name }
}

function buildPath(deviceType: string, name: string, room?: string): Segment[] {
  return [
    {
      identifier: deviceType,
      selectors: room === undefined ? [] : [buildRoomSelector(room)],
    },
    { identifier: name, selectors: [] },
  ]
}

export function buildAction(
  deviceType: string,
  method: string,
  room?: string,
): Action {
  return {
    kind: 'action',
    path: buildPath(deviceType, method, room),
  }
}

export function buildAssignment(
  deviceType: string,
  property: string,
  value: Value,
  room?: string,
): Assignment {
  return {
    kind: 'assignment',
    path: buildPath(deviceType, property, room),
    value,
  }
}

export function buildQuery(
  deviceType: string,
  property: string,
  room?: string,
): Query {
  return {
    kind: 'query',
    path: buildPath(deviceType, property, room),
  }
}

export function buildIncrement(
  deviceType: string,
  property: string,
  value: Value,
  room?: string,
): Increment {
  return {
    kind: 'increment',
    path: buildPath(deviceType, property, room),
    value,
  }
}

export function buildProgram(statements: Statement[]): Program {
  return { kind: 'program', statements }
}
