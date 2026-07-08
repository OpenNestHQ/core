import { OpenNestPrompt } from "@opennest/lang-core";
import { parseHomeDSL } from "@opennest/lang-core";
import type { Program } from "@opennest/lang-core";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

const MAX_RETRIES = 5;

function createSystemPrompt(): string {
  return new OpenNestPrompt().prompt({
    preamble: `# YOUR ROLE
You are a HomeDSL translator. Convert natural language smart home commands into valid HomeDSL code only.`,
    customInstruction:  `CRITICAL RULES:
- Output ONLY raw HomeDSL statements — nothing else.
- No markdown fences, no backticks, no natural language explanations.
- If the user request is unclear or cannot be translated, respond with exactly: UNTRANSLATABLE
- Always use device TYPE + ROOM selectors (e.g., tv[salon]), never raw device IDs.
- Prefer the most natural device for the described action.`
,
  });
}

function getModelId(): string {
  return process.env["OPENNEST_MODEL"] ?? "openai/gpt-4o-mini";
}

function createModel(modelId: string, apiKey: string, baseURL?: string) {
  const parts = modelId.split("/");
  const modelName = parts.length > 1 ? parts[1]! : modelId;

  const openai = createOpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  });

  return openai(modelName);
}

export interface NlTranslateResult {
  program: Program | null;
  dsl: string;
  attempts: number;
  failed: boolean;
}

export type AttemptCallback = (
  attempt: number,
  dsl: string,
  errors: string[] | null,
) => void;

export async function translateNlToDsl(
  input: string,
  onAttempt?: AttemptCallback,
): Promise<NlTranslateResult> {
  const systemPrompt = createSystemPrompt();
  const modelId = getModelId();
  const apiKey = process.env["OPENAI_API_KEY"];
  const baseURL = process.env["OPENAI_BASE_URL"];

  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. Create a .env file with OPENAI_API_KEY=your-key",
    );
  }

  const model = createModel(modelId, apiKey, baseURL);

  const messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [
    { role: "system", content: systemPrompt },
    { role: "user", content: input },
  ];

  let lastDsl = "";

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { text } = await generateText({
      model,
      allowSystemInMessages: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: messages as any,
    });

    const dsl = text.trim();
    lastDsl = dsl;

    if (dsl === "UNTRANSLATABLE" || dsl === "") {
      onAttempt?.(attempt + 1, dsl, null);
      return {
        program: null,
        dsl: "",
        attempts: attempt + 1,
        failed: true,
      };
    }

    const parseResult = parseHomeDSL(dsl);

    if (
      parseResult.errors.length === 0 &&
      parseResult.program.statements.length > 0
    ) {
      onAttempt?.(attempt + 1, dsl, null);
      return {
        program: parseResult.program,
        dsl,
        attempts: attempt + 1,
        failed: false,
      };
    }

    const errorMessages = parseResult.errors.map((e) => e.message);
    onAttempt?.(attempt + 1, dsl, errorMessages);

    const errorText =
      `The HomeDSL you generated has parse errors:\n${errorMessages.join("\n")}\n\nPlease fix the HomeDSL and output ONLY valid code.`;

    messages.push({ role: "assistant", content: dsl });
    messages.push({ role: "user", content: errorText });
  }

  return {
    program: null,
    dsl: lastDsl,
    attempts: MAX_RETRIES,
    failed: true,
  };
}
