/**
 * Packs the published packages, checks what is inside the tarballs, then
 * installs them in throwaway projects outside the repository and uses them the
 * way a consumer would. Run `pnpm run build` first; installing the third-party
 * dependencies needs access to the npm registry.
 *
 * Stops at the first failing check, lists every offending entry of that check
 * and exits with code 1.
 */
import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PUBLISHED_PACKAGES } from './lib/manifest-rules.mjs'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const SHEBANG = '#!/usr/bin/env node'
/** Public entry points besides the package root, by package directory. */
const SUBPATHS = { devices: ['drivers/mock'], vm: ['effect'] }
/** Uses the three packages a typical consumer starts with. */
const CONSUMER_SOURCE = `
import { MockDriver } from '@opennest/devices'
import type { DeviceDriver } from '@opennest/devices'
import { OpenNestClient } from '@opennest/sdk'
import { OpenTelemetryTraceSink } from '@opennest/vm-opentelemetry'

export const driver: DeviceDriver = new MockDriver()
export const client: typeof OpenNestClient = OpenNestClient
export const sink: typeof OpenTelemetryTraceSink = OpenTelemetryTraceSink
`

class CheckFailure extends Error {
  constructor(check, entries) {
    super(`${check} failed:\n${entries.map(e => `  - ${e}`).join('\n')}`)
  }
}

/** Throws if `findProblems` returns anything for at least one of the items. */
function check(title, items, findProblems) {
  const problems = items.flatMap(findProblems)
  if (problems.length > 0) throw new CheckFailure(title, problems)
  console.log(`ok - ${title}`)
}

/**
 * Runs a command to completion; if it fails, throws with its output and the
 * command line (as `error.command`).
 */
function run(command, args, options) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 300_000,
      ...options,
    })
  } catch (error) {
    error.command = [command, ...args].join(' ')
    throw error
  }
}

/** Which command failed and why (e.g. `ETIMEDOUT`), then what it printed. */
function describeFailure(error) {
  const cause = error.code ?? error.signal ?? `exit code ${error.status}`
  const reason = `\`${error.command}\` failed with ${cause}`
  const output = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim()
  return output ? `${reason}\n${output}` : reason
}

/** Like `run`, but returns the failure as a list of problems. */
function attempt(label, command, args, options) {
  try {
    run(command, args, options)
    return []
  } catch (error) {
    return [`${label}: ${describeFailure(error)}`]
  }
}

function pack(dir, workDir) {
  const destination = join(workDir, 'tarballs', dir)
  mkdirSync(destination, { recursive: true })
  run('pnpm', ['pack', '--pack-destination', destination], {
    cwd: join(repoRoot, 'packages', dir),
  })
  const tarball = join(destination, readdirSync(destination)[0])
  const read = entry => run('tar', ['-xzOf', tarball, entry])
  return {
    dir,
    name: `@opennest/${dir}`,
    tarball,
    entries: run('tar', ['-tzf', tarball]).split('\n').filter(Boolean),
    read,
  }
}

function contentProblems({ name, entries }) {
  const problems = entries
    .filter(
      entry =>
        entry.startsWith('package/src/') ||
        entry.includes('.test.') ||
        entry.includes('__tests__'),
    )
    .map(entry => `${name}: must not ship ${entry}`)
  if (!entries.includes('package/dist/index.js')) {
    problems.push(`${name}: package/dist/index.js is missing`)
  }
  return problems
}

/** Paths of the string values still using the pnpm `workspace:` protocol. */
function workspaceValues(value, path) {
  if (typeof value === 'string') {
    return value.includes('workspace:') ? [`${path} = "${value}"`] : []
  }
  if (typeof value !== 'object' || value === null) return []
  return Object.entries(value).flatMap(([key, child]) =>
    workspaceValues(child, path ? `${path}.${key}` : key),
  )
}

function manifestProblems({ name, read }) {
  const manifest = JSON.parse(read('package/package.json'))
  return workspaceValues(manifest, '').map(value => `${name}: ${value}`)
}

function shebangProblems({ name, entries, read }) {
  if (!entries.includes('package/dist/cli.js')) {
    return [`${name}: package/dist/cli.js is missing`]
  }
  const [firstLine] = read('package/dist/cli.js').split('\n')
  return firstLine === SHEBANG
    ? []
    : [`${name}: dist/cli.js must start with "${SHEBANG}"`]
}

function specifiersOf({ dir, name }) {
  return [name, ...(SUBPATHS[dir] ?? []).map(subpath => `${name}/${subpath}`)]
}

/**
 * Writes an empty ESM project depending on the `direct` tarballs only. The
 * overrides point every `@opennest/*` dependency at the local tarballs.
 */
function createProject(workDir, label, direct, all, source) {
  const cwd = join(workDir, 'projects', label)
  mkdirSync(cwd, { recursive: true })
  const specs = packages =>
    Object.fromEntries(packages.map(p => [p.name, `file:${p.tarball}`]))
  // The MCP SDK's own declarations use Node globals such as `Buffer`.
  const nodeTypes = label === 'only-mcp'
  const readManifest = path =>
    JSON.parse(readFileSync(join(repoRoot, path), 'utf8'))
  const { typescript } = readManifest('package.json').devDependencies
  const write = (file, content) => writeFileSync(join(cwd, file), content)

  write(
    'package.json',
    JSON.stringify({
      name: 'release-check-consumer',
      private: true,
      type: 'module',
      dependencies: specs(direct),
      devDependencies: {
        typescript,
        ...(nodeTypes && {
          '@types/node': readManifest('packages/mcp/package.json')
            .devDependencies['@types/node'],
        }),
      },
      overrides: specs(all),
    }),
  )
  write(
    'tsconfig.json',
    JSON.stringify({
      compilerOptions: {
        module: 'nodenext',
        target: 'esnext',
        strict: true,
        skipLibCheck: false,
        types: nodeTypes ? ['node'] : [],
        noEmit: true,
      },
      files: ['consumer.ts'],
    }),
  )
  write('consumer.ts', source)
  const imports = direct.flatMap(specifiersOf)
  write('imports.mjs', imports.map(s => `await import('${s}')\n`).join(''))
  return { label, cwd }
}

function installProblems({ label, cwd }) {
  const problems = attempt(
    label,
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
    { cwd },
  )
  if (problems.length > 0) return problems
  // Anything taken from the registry would not be what is about to be released.
  const lock = JSON.parse(readFileSync(join(cwd, 'package-lock.json'), 'utf8'))
  return Object.entries(lock.packages)
    .filter(
      ([path, { resolved }]) =>
        /node_modules\/@opennest\/[^/]+$/.test(path) &&
        !resolved?.startsWith('file:'),
    )
    .map(([path]) => `${label}: ${path} was not installed from a local tarball`)
}

function binProblems({ label, cwd }) {
  // No inventory file: the server must start, explain why and exit with 1.
  const expected = 'Inventory file not found'
  try {
    run(join(cwd, 'node_modules', '.bin', 'opennest-mcp'), [], {
      cwd,
      env: { ...process.env, OPENNEST_YAML: join(cwd, 'missing.yaml') },
      timeout: 30_000,
      // A server trapping SIGTERM must not outlive the timeout.
      killSignal: 'SIGKILL',
    })
  } catch (error) {
    if (error.status === 1 && error.stderr.includes(expected)) return []
    return [`${label}: opennest-mcp: ${describeFailure(error)}`]
  }
  return [`${label}: opennest-mcp exited with 0 without an inventory file`]
}

function main(workDir) {
  const packed = PUBLISHED_PACKAGES.map(dir => pack(dir, workDir))
  check('tarball contents', packed, contentProblems)
  check('packed manifests', packed, manifestProblems)
  check(
    'mcp CLI shebang',
    packed.filter(p => p.dir === 'mcp'),
    shebangProblems,
  )

  // One project with everything, then one per package: installed alone, a
  // package cannot rely on a sibling that it forgot to declare.
  const everything = createProject(
    workDir,
    'all-packages',
    packed,
    packed,
    CONSUMER_SOURCE,
  )
  const isolated = packed.map(p =>
    createProject(
      workDir,
      `only-${p.dir}`,
      [p],
      packed,
      specifiersOf(p)
        .map((s, i) => `export * as entry${i} from '${s}'\n`)
        .join(''),
    ),
  )
  const projects = [everything, ...isolated]

  check('tarball installation', projects, installProblems)
  check('runtime imports', projects, ({ label, cwd }) =>
    attempt(label, process.execPath, ['imports.mjs'], { cwd }),
  )
  check('consumer type check', projects, ({ label, cwd }) =>
    attempt(label, join(cwd, 'node_modules', '.bin', 'tsc'), ['-p', '.'], {
      cwd,
    }),
  )
  check('opennest-mcp bin', [everything], binProblems)
}

const workDir = mkdtempSync(join(tmpdir(), 'opennest-release-check-'))
try {
  main(workDir)
  console.log(`All ${PUBLISHED_PACKAGES.length} tarballs are ready to release.`)
} catch (error) {
  console.error(error instanceof CheckFailure ? error.message : error)
  process.exitCode = 1
} finally {
  rmSync(workDir, { recursive: true, force: true })
}
