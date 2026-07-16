import * as readline from "node:readline";
import { parseHomeDSL } from "@opennest/lang-core";
import type { Program } from "@opennest/lang-core";
import {
  interpret_home_dsl,
  resumeWithResponse,
  createSession,
  ConfirmationPolicy,
} from "@opennest/vm";
import type {
  Session,
  Device,
  UserInteraction,
  DeviceSelectionInteraction,
} from "@opennest/vm";
import {
  formatSuccess,
  formatInteraction,
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
} from "./format.js";
import { translateNlToDsl } from "./agent.js";
import type { AttemptCallback } from "./agent.js";

interface State {
  session: Session;
  devices: Device[];
  lastProgram: Program | null;
  nlMode: boolean;
}

function createState(devices: Device[]): State {
  return {
    session: createSession(),
    devices,
    lastProgram: null,
    nlMode: false,
  };
}

async function executeProgram(state: State): Promise<UserInteraction | null> {
  if (!state.lastProgram) return null;

  const prevHistoryLen = state.session.history.length;

  const result = await interpret_home_dsl(state.lastProgram, {
    devices: state.devices,
    session: state.session,
    policies:[
      new ConfirmationPolicy({
        requireConfirmation(action) {
          return action.device.type == "thermostat" && action.kind === "set_property" && action.property === "temperature";
        },
      })
    ]
  });

  state.session = result.session;

  switch (result.status) {
    case "success":
      if (result.executed.length > prevHistoryLen) {
        process.stdout.write(formatSuccess(result, prevHistoryLen) + "\n");
      } else {
        process.stdout.write("  (no-ops)\n\n");
      }
      return null;
    case "awaiting_interaction":
      if (result.executed.length > prevHistoryLen) {
        process.stdout.write(formatSuccess(result, prevHistoryLen) + "\n");
      }
      process.stdout.write(formatInteraction(result.interaction!) + "\n");
      if (result.interaction!.type === "device_selection") {
        const sel = result.interaction as DeviceSelectionInteraction;
        process.stdout.write(
          `  \u2192 Choose a device (1-${sel.devices.length}, or :cancel): `,
        );
      }
      if (result.interaction!.type === "confirmation") {
        process.stdout.write("  \u2192 ");
      }
      return result.interaction;
    case "error":
      process.stdout.write(formatErrors(result.errors) + "\n");
      return null;
  }
}

function processResponse(
  state: State,
  interaction: UserInteraction,
  answer: string,
): boolean {
  const trimmed = answer.trim();
  if (trimmed === ":cancel" || trimmed === ":q") {
    process.stdout.write("  Cancelled.\n\n");
    return false;
  }

  if (interaction.type === "device_selection") {
    const idx = parseInt(trimmed, 10);
    if (isNaN(idx) || idx < 1 || idx > interaction.devices.length) {
      process.stdout.write("  Invalid choice.\n\n");
      return false;
    }

    const chosen = interaction.devices[idx - 1]!;
    resumeWithResponse(state.session, {
      interactionId: interaction.id,
      type: "device_selection",
      deviceId: chosen.id,
    });
    return true;
  }

  if (interaction.type === "confirmation") {
    const lower = trimmed.toLowerCase();
    const confirmed = lower === "y" || lower === "yes";
    if (!confirmed && lower !== "n" && lower !== "no") {
      process.stdout.write("  Invalid answer. Type y/n.\n\n");
      return false;
    }
    resumeWithResponse(state.session, {
      interactionId: interaction.id,
      type: "confirmation",
      confirmed,
    });
    return true;
  }

  process.stdout.write("  Unsupported interaction type.\n\n");
  return false;
}

async function executeSource(state: State, src: string): Promise<UserInteraction | null> {
  const parseResult = parseHomeDSL(src);
  if (parseResult.errors.length > 0) {
    process.stdout.write(
      formatParseErrors(parseResult.errors.map((e) => e.message)) + "\n",
    );
    return null;
  }

  state.lastProgram = parseResult.program;
  return executeProgram(state);
}

async function executeNlSource(
  state: State,
  input: string,
): Promise<UserInteraction | null> {
  process.stdout.write(`  ${D}Translating...${N}\n`);

  const onAttempt: AttemptCallback = (attempt, dsl, errors) => {
    if (errors && errors.length > 0) {
      process.stdout.write(formatNlRetry(attempt, dsl, errors) + "\n");
    }
  };

  try {
    const result = await translateNlToDsl(input, onAttempt);

    if (result.failed || !result.program) {
      process.stdout.write(formatNlFailed(result.attempts) + "\n\n");
      return null;
    }

    process.stdout.write(formatNlSuccess(result.dsl) + "\n");
    state.lastProgram = result.program;
    return executeProgram(state);
  } catch (err: unknown) {
    process.stdout.write(
      `  ${Rcol}\u2717${
        err instanceof Error ? err.message : String(err)
      }\n\n`,
    );
    return null;
  }
}

const COMMANDS = [
  ":h", ":help",
  ":d", ":devices",
  ":s", ":session",
  ":r", ":reset",
  ":q", ":quit",
  ":{", ":}",
  ":cancel",
  ":nl", ":dsl",
];

export async function startRepl(devices: Device[]): Promise<void> {
  const state = createState(devices);

  function deviceTypes(): string[] {
    return [...new Set(state.devices.map((d) => d.type))];
  }

  function rooms(): string[] {
    return [...new Set(state.devices.map((d) => d.room))];
  }

  function completeFromList(line: string, partial: string, prefix: string, candidates: string[], suffix: string = ""): [string[], string] {
    const hits = candidates.filter((c) => c.startsWith(partial));
    const completions = hits.map((c) => prefix + c + suffix);
    return [completions.length ? completions : candidates.map((c) => prefix + c + suffix), line];
  }

  function isDeviceTypeContext(line: string, lastToken: string): boolean {
    if (lastToken === "" || lastToken === "=" || isModifierPrefix(lastToken)) return false;

    const cleanLine = line.trimStart();
    if (cleanLine.startsWith(lastToken)) return true;

    const normalized = line.replace(/\s+/g, " ").trim();
    const eqIdx = normalized.lastIndexOf("=");
    if (eqIdx === -1) return false;

    const afterEq = normalized.slice(eqIdx + 1).trim();
    return afterEq.startsWith(lastToken);
  }

  function extractModifierInner(token: string): { modifier: string; inner: string } | null {
    const match = token.match(/^(@(?:all|first)\()(.*)/);
    if (!match) return null;
    return { modifier: match[1]!, inner: match[2]! };
  }

  function isModifierPrefix(token: string): boolean {
    return /^@(?:all|first)\(/.test(token);
  }

  function completer(line: string): [string[], string] {
    if (line.startsWith(":")) {
      const hits = COMMANDS.filter((c) => c.startsWith(line));
      return [hits.length ? hits : COMMANDS, line];
    }

    const tokens = line.split(/\s+/);
    const lastToken = tokens[tokens.length - 1] ?? "";

    if (lastToken.includes(".")) return [[], lastToken];

    if (lastToken.includes("$")) {
      const dollarIdx = lastToken.lastIndexOf("$");
      const partial = lastToken.slice(dollarIdx + 1);
      const prefix = lastToken.slice(0, dollarIdx + 1);

      const varNames = Object.keys(state.session.variables);
      if (!varNames.includes("it")) varNames.push("it");

      const hits = varNames.filter((name) => name.startsWith(partial));
      const completions = hits.map((name) => prefix + name);
      return [completions.length ? completions : varNames.map((n) => prefix + n), lastToken];
    }

    if (lastToken.includes("[") && !lastToken.includes("]")) {
      const bracketIdx = lastToken.lastIndexOf("[");
      const partial = lastToken.slice(bracketIdx + 1);
      const prefix = lastToken.slice(0, bracketIdx + 1);

      const candidates = [...rooms(), "*"];
      return completeFromList(lastToken, partial, prefix, candidates, "]");
    }

    const modifier = extractModifierInner(lastToken);
    if (modifier) {
      if (modifier.inner.includes("[") && !modifier.inner.includes("]")) {
        const bracketIdx = modifier.inner.lastIndexOf("[");
        const partial = modifier.inner.slice(bracketIdx + 1);
        const prefix = modifier.modifier + modifier.inner.slice(0, bracketIdx + 1);
        const candidates = [...rooms(), "*"];
        return completeFromList(lastToken, partial, prefix, candidates, "]");
      }
      const candidates = deviceTypes();
      return completeFromList(lastToken, modifier.inner, modifier.modifier, candidates);
    }

    if (isDeviceTypeContext(line, lastToken)) {
      const candidates = deviceTypes();
      const hits = candidates.filter((t) => t.startsWith(lastToken));
      return [hits.length ? hits : candidates, lastToken];
    }

    return [[], line];
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    completer,
  });

  let pendingInteraction: UserInteraction | null = null;
  let processing = false;
  const queue: string[] = [];

  // Multi-line input accumulation
  let accumulating = false;
  let buffer: string[] = [];

  process.stdout.write(banner(state.devices) + "\n");

  const prompt = () => {
    if (accumulating) {
      process.stdout.write(".. ");
    } else if (!pendingInteraction) {
      process.stdout.write(state.nlMode ? "[NL] > " : "> ");
    }
  };

  prompt();

  async function processNext(line: string): Promise<void> {
    const trimmed = line.trim();

    // Handle pending interaction
    if (pendingInteraction) {
      const interaction = pendingInteraction;
      pendingInteraction = null;
      if (processResponse(state, interaction, trimmed)) {
        pendingInteraction = await executeProgram(state);
      }
      return;
    }

    // Handle accumulation mode
    if (accumulating) {
      if (trimmed === ":}") {
        accumulating = false;
        if (buffer.length > 0) {
          const src = buffer.join("\n");
          if (state.nlMode) {
            pendingInteraction = await executeNlSource(state, src);
          } else {
            pendingInteraction = await executeSource(state, src);
          }
        }
        buffer = [];
        return;
      }
      if (trimmed === "") {
        accumulating = false;
        if (buffer.length > 0) {
          const src = buffer.join("\n");
          if (state.nlMode) {
            pendingInteraction = await executeNlSource(state, src);
          } else {
            pendingInteraction = await executeSource(state, src);
          }
        }
        buffer = [];
        return;
      }
      buffer.push(trimmed);
      return;
    }

    // Special commands
    if (trimmed === ":q" || trimmed === ":quit") {
      process.stdout.write("Goodbye!\n");
      rl.close();
      return;
    }
    if (trimmed === ":{") {
      accumulating = true;
      buffer = [];
      process.stdout.write("  (multi-line mode \u2014 blank line or :} to execute)\n");
      return;
    }
    if (trimmed.startsWith(":{") && trimmed.length > 2) {
      accumulating = true;
      buffer = [trimmed.slice(2).trim()].filter(Boolean);
      process.stdout.write("  (multi-line mode \u2014 blank line or :} to execute)\n");
      return;
    }
    if (trimmed === ":h" || trimmed === ":help") {
      process.stdout.write(help() + "\n");
      return;
    }
    if (trimmed === ":d" || trimmed === ":devices") {
      process.stdout.write(formatDevices(state.devices) + "\n");
      return;
    }
    if (trimmed === ":s" || trimmed === ":session") {
      process.stdout.write(formatSession(state.session) + "\n");
      return;
    }
    if (trimmed === ":r" || trimmed === ":reset") {
      state.session = createSession();
      state.lastProgram = null;
      process.stdout.write("Session reset.\n\n");
      return;
    }
    if (trimmed === ":nl") {
      if (!process.env["OPENAI_API_KEY"]) {
        process.stdout.write(
          `  ${Rcol}Warning: OPENAI_API_KEY not set. NL mode requires an API key.${N}\n`,
        );
      }
      state.nlMode = true;
      process.stdout.write("  Switched to natural language mode.\n\n");
      return;
    }
    if (trimmed === ":dsl") {
      state.nlMode = false;
      process.stdout.write("  Switched to HomeDSL mode.\n\n");
      return;
    }
    if (trimmed === "") {
      return;
    }

    if (state.nlMode) {
      pendingInteraction = await executeNlSource(state, trimmed);
      return;
    }

    pendingInteraction = await executeSource(state, trimmed);
  }

  rl.on("line", (rawLine: string) => {
    if (processing) {
      queue.push(rawLine);
      return;
    }
    processing = true;
    processNext(rawLine).then(() => {
      if (queue.length > 0) {
        const next = queue.shift()!;
        processNext(next).then(flushQueue);
      } else {
        processing = false;
        prompt();
      }
    });
  });

  function flushQueue(): void {
    if (queue.length > 0) {
      const next = queue.shift()!;
      processNext(next).then(flushQueue);
    } else {
      processing = false;
      prompt();
    }
  }

  rl.on("close", () => {
    process.exit(0);
  });
}
