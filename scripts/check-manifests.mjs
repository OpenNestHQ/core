/**
 * Checks that the manifests of the published packages are ready to be
 * published. Prints one line per error and exits with code 1 if there is any.
 */
import { readFileSync } from 'node:fs'

import { checkManifest, PUBLISHED_PACKAGES } from './lib/manifest-rules.mjs'

const repoRoot = new URL('../', import.meta.url)

const errors = PUBLISHED_PACKAGES.flatMap(name => {
  const dir = `packages/${name}`
  const path = new URL(`${dir}/package.json`, repoRoot)
  return checkManifest(JSON.parse(readFileSync(path, 'utf8')), dir)
})

if (errors.length > 0) {
  for (const error of errors) console.error(error)
  process.exitCode = 1
} else {
  console.log(`All ${PUBLISHED_PACKAGES.length} manifests are publishable.`)
}
