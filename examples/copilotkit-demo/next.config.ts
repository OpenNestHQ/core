import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'

// Monorepo root: pin it so Next doesn't infer it from a stray lockfile
// in a parent directory.
const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url))

const nextConfig: NextConfig = {
  transpilePackages: ['@opennest/sdk', '@opennest/lang-core', '@opennest/vm'],
  // The device registry reads the YAML inventory from disk at runtime.
  serverExternalPackages: ['@opennest/devices'],
  outputFileTracingRoot: workspaceRoot,
  turbopack: { root: workspaceRoot },
  // Linting is handled by the root ESLint config (`pnpm run lint`).
  eslint: { ignoreDuringBuilds: true },
}

export default nextConfig
