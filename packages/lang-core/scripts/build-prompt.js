import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { OpenNestPrompt, DEFAULT_DEVICES, DEFAULT_ROOMS } from "../dist/index.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootDir = join(__dirname, "..");

const prompt = new OpenNestPrompt(DEFAULT_DEVICES, DEFAULT_ROOMS).prompt();
const outPath = join(rootDir, "example-prompt.md");

writeFileSync(outPath, prompt, "utf-8");
console.log(`Prompt written to ${outPath}`);
