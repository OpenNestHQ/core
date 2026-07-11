# @opennest/lang-core

HomeDSL parser, AST types, and LLM prompt generator.

## Install

```bash
pnpm add @opennest/lang-core
```

## API

### `parseHomeDSL(source: string): ParseResult`

Parses a HomeDSL string into a typed AST.

```ts
import { parseHomeDSL } from "@opennest/lang-core";

const result = parseHomeDSL('tv[salon].power = on');
if (result.errors.length > 0) {
  console.error(result.errors);
} else {
  // result.program.statements → Statement[]
}
```

### `OpenNestPrompt`

Generates structured prompts for the LLM that compiles natural language into HomeDSL.

```ts
import { OpenNestPrompt } from "@opennest/lang-core";

const prompt = new OpenNestPrompt().prompt({
  preamble: "You are a HomeDSL translator.",
  customInstruction: "Output only valid HomeDSL.",
});
```

## Exports

| Export | Kind | Description |
|---|---|---|
| `parseHomeDSL` | function | HomeDSL → AST parser |
| `ParseError` | class | Parse error with location |
| `OpenNestPrompt` | class | Prompt generator with builder API |
| `DEFAULT_DEVICES` | const | 11 device type definitions |
| `DEFAULT_ROOMS` | const | 6 room names (French) |
| `ParseResult`, `Program`, `Statement`, `Expr`, `Value`, etc. | types | Full AST type hierarchy |
