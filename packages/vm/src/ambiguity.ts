import type { AmbiguityChoice, AmbiguityInfo } from "./types.js";

export function buildAmbiguityInfo(choices: AmbiguityChoice[]): AmbiguityInfo {
  return {
    kind: "target",
    choices,
  };
}

export function createAmbiguityChoice(
  dsl: string,
  label: string,
): AmbiguityChoice {
  return { dsl, label };
}
