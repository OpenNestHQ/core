import { defineConfig } from 'vitest/config'

// Root run used for coverage only (`pnpm run test:coverage`). Not named
// `vitest.config.ts` on purpose: Vitest would pick it up from every package
// directory and break per-package `pnpm test`.
export default defineConfig({
  test: {
    projects: ['packages/*'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/*/src/**/*.test.ts'],
      reporter: ['text', 'json-summary', 'json'],
      reportOnFailure: true,
      reportsDirectory: './coverage',
    },
  },
})
