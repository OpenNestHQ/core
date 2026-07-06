import type { Session } from "./types.js";

export function createSession(): Session {
  return {
    variables: {},
    it: null,
    history: [],
  };
}
