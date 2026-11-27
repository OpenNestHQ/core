import { describe, expect, it } from 'vitest'

import { checkManifest, PUBLISHED_PACKAGES } from './manifest-rules.mjs'

const DIR = 'packages/vm'

/** Minimal manifest that satisfies every rule, with `overrides` applied. */
function manifest(overrides = {}) {
  return {
    name: '@opennest/vm',
    version: '0.0.0',
    description: 'OpenNest VM',
    homepage: 'https://github.com/OpenNestHQ/core#readme',
    bugs: { url: 'https://github.com/OpenNestHQ/core/issues' },
    repository: {
      type: 'git',
      url: 'git+https://github.com/OpenNestHQ/core.git',
      directory: DIR,
    },
    engines: { node: '>=24' },
    files: ['dist', 'README.md'],
    publishConfig: { access: 'public', provenance: true },
    exports: { '.': './dist/index.js' },
    ...overrides,
  }
}

/** Asserts that the manifest breaks exactly one rule, about `field`. */
function expectSingleError(overrides, field) {
  const errors = checkManifest(manifest(overrides), DIR)

  expect(errors).toHaveLength(1)
  expect(errors[0]).toContain(DIR)
  expect(errors[0]).toContain(field)
}

describe('PUBLISHED_PACKAGES', () => {
  it('lists the directory names of the six published packages', () => {
    expect(PUBLISHED_PACKAGES).toEqual([
      'lang-core',
      'devices',
      'vm',
      'vm-opentelemetry',
      'sdk',
      'mcp',
    ])
  })
})

describe('checkManifest', () => {
  it('returns no errors for a valid manifest', () => {
    expect(checkManifest(manifest(), DIR)).toEqual([])
  })

  it('accepts main and types in place of exports', () => {
    const input = manifest({
      exports: undefined,
      main: 'dist/index.js',
      types: 'dist/index.d.ts',
    })

    expect(checkManifest(input, DIR)).toEqual([])
  })

  it('does not check the version', () => {
    expect(checkManifest(manifest({ version: '12.3.4' }), DIR)).toEqual([])
  })

  it.each([
    ['is missing', undefined],
    ['omits README.md', ['dist']],
    ['has an extra entry', ['dist', 'README.md', 'src']],
    ['has another entry', ['src', 'README.md']],
    ['is not an array', 'dist'],
  ])('reports an error when files %s', (_label, files) => {
    expectSingleError({ files }, 'files')
  })

  it.each([
    ['is missing', { provenance: true }],
    ['is not public', { access: 'restricted', provenance: true }],
  ])(
    'reports an error when publishConfig.access %s',
    (_label, publishConfig) => {
      expectSingleError({ publishConfig }, 'publishConfig.access')
    },
  )

  it.each([
    ['is missing', { access: 'public' }],
    ['is false', { access: 'public', provenance: false }],
    ['is a string', { access: 'public', provenance: 'true' }],
  ])(
    'reports an error when publishConfig.provenance %s',
    (_label, publishConfig) => {
      expectSingleError({ publishConfig }, 'publishConfig.provenance')
    },
  )

  it.each([
    ['neither exports nor main and types are defined', {}],
    ['only main is defined', { main: 'dist/index.js' }],
    ['only types is defined', { types: 'dist/index.d.ts' }],
  ])('reports an error when %s', (_label, entry) => {
    expectSingleError({ exports: undefined, ...entry }, 'exports')
  })

  it.each([
    ['is missing', undefined],
    ['points elsewhere', { directory: 'packages/sdk' }],
    ['is a string', 'github:OpenNestHQ/core'],
  ])('reports an error when repository.directory %s', (_label, repository) => {
    expectSingleError({ repository }, 'repository.directory')
  })

  it.each([
    ['is missing', undefined],
    ['allows an older Node.js', { node: '>=22' }],
  ])('reports an error when engines.node %s', (_label, engines) => {
    expectSingleError({ engines }, 'engines.node')
  })

  it.each([
    ['description', { description: undefined }],
    ['description', { description: '' }],
    ['homepage', { homepage: undefined }],
    ['bugs.url', { bugs: undefined }],
    ['bugs.url', { bugs: {} }],
  ])('reports an error when %s is missing', (field, overrides) => {
    expectSingleError(overrides, field)
  })

  it('reports an error when the package is private', () => {
    expectSingleError({ private: true }, 'private')
  })

  it('reports every broken rule at once', () => {
    const errors = checkManifest({}, DIR)

    expect(errors).toHaveLength(9)
  })
})
