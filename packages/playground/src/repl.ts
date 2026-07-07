import * as readline from "node:readline";
import { parseHomeDSL } from "@opennest/lang-core";
import type { Program } from "@opennest/lang-core";
import {
  interpret_home_dsl,
  applyResolution,
  createSession,
} from "@opennest/vm";
import type { Session, Device, AmbiguityInfo } from "@opennest/vm";
import {
  formatSuccess,
  formatWaiting,
  formatErrors,
  formatParseErrors,
  formatDevices,
  formatSession,
  banner,
  help,
} from "./format.js";

interface State {
  session: Session;
  devices: Device[];
  lastProgram: Program | null;
}

interface Choice {
  index: number;
  id: string;
  type: string;
  room: string;
  name: string;
}

function createState(devices: Device[]): State {
  return {
    session: createSession(),
    devices,
    lastProgram: null,
  };
}

function flattenTree(info: AmbiguityInfo): Choice[] {
  const result: Choice[] = [];
  let idx = 0;
  for (const room of info.tree.children) {
    for (const dev of room.children) {
      result.push({
        index: ++idx,
        id: dev.id,
        type: info.tree.type,
        room: room.key,
        name: dev.key,
      });
    }
  }
  return result;
}

async function executeProgram(state: State): Promise<AmbiguityInfo | null> {
  if (!state.lastProgram) return null;

  const prevHistoryLen = state.session.history.length;

  const result = await interpret_home_dsl(state.lastProgram, {
    devices: state.devices,
    session: state.session,
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
    case "waiting":
      if (result.executed.length > prevHistoryLen) {
        process.stdout.write(formatSuccess(result, prevHistoryLen) + "\n");
      }
      process.stdout.write(formatWaiting(result.awaiting!) + "\n");
      process.stdout.write(
        `  \u2192 Choose a device (1-${flattenTree(result.awaiting!).length}, or :cancel): `,
      );
      return result.awaiting;
    case "error":
      process.stdout.write(formatErrors(result.errors) + "\n");
      return null;
  }
}

function resolveAmbiguity(
  state: State,
  info: AmbiguityInfo,
  answer: string,
): boolean {
  const trimmed = answer.trim();
  if (trimmed === ":cancel" || trimmed === ":q") {
    process.stdout.write("  Cancelled.\n\n");
    return false;
  }

  const devices = flattenTree(info);
  const idx = parseInt(trimmed, 10);
  if (isNaN(idx) || idx < 1 || idx > devices.length) {
    process.stdout.write("  Invalid choice.\n\n");
    return false;
  }

  const chosen = devices[idx - 1]!;
  applyResolution(state.session, chosen.type, chosen.id);
  return true;
}

async function executeSource(state: State, src: string): Promise<AmbiguityInfo | null> {
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

export async function startRepl(devices: Device[]): Promise<void> {
  const state = createState(devices);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  let pendingAmbiguity: AmbiguityInfo | null = null;
  let processing = false;
  const queue: string[] = [];

  // Multi-line input accumulation
  let accumulating = false;
  let buffer: string[] = [];

  process.stdout.write(banner(state.devices) + "\n");

  const prompt = () => {
    if (accumulating) {
      process.stdout.write(".. ");
    } else if (!pendingAmbiguity) {
      process.stdout.write("> ");
    }
  };

  prompt();

  async function processNext(line: string): Promise<void> {
    const trimmed = line.trim();

    // Handle pending ambiguity
    if (pendingAmbiguity) {
      const info = pendingAmbiguity;
      pendingAmbiguity = null;
      if (resolveAmbiguity(state, info, trimmed)) {
        pendingAmbiguity = await executeProgram(state);
      }
      return;
    }

    // Handle accumulation mode
    if (accumulating) {
      if (trimmed === ":}") {
        accumulating = false;
        if (buffer.length > 0) {
          pendingAmbiguity = await executeSource(state, buffer.join("\n"));
        }
        buffer = [];
        return;
      }
      if (trimmed === "") {
        accumulating = false;
        if (buffer.length > 0) {
          pendingAmbiguity = await executeSource(state, buffer.join("\n"));
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
    if (trimmed === "") {
      return;
    }

    pendingAmbiguity = await executeSource(state, trimmed);
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
