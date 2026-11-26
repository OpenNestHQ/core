/** Directory names, under `packages/`, of the packages published to npm. */
export const PUBLISHED_PACKAGES = [
  'lang-core',
  'devices',
  'vm',
  'vm-opentelemetry',
  'sdk',
  'mcp',
]

const REQUIRED_FILES = ['dist', 'README.md']
const REQUIRED_NODE_RANGE = '>=24'

/**
 * Checks that a `package.json` is ready to be published. The version is not
 * checked: it changes with every release.
 *
 * @param {object} manifest Parsed `package.json`.
 * @param {string} dir Repo-relative package directory, such as `packages/vm`.
 * @returns {string[]} One message per broken rule; empty when valid.
 */
export function checkManifest(manifest, dir) {
  const errors = []
  const check = (condition, message) => {
    if (!condition) errors.push(`${dir}: ${message}`)
  }

  check(manifest.private !== true, 'private must not be true')

  for (const [field, value] of [
    ['description', manifest.description],
    ['homepage', manifest.homepage],
    ['bugs.url', manifest.bugs?.url],
  ]) {
    check(Boolean(value), `${field} is required`)
  }

  check(
    manifest.repository?.directory === dir,
    `repository.directory must be "${dir}"`,
  )
  check(
    manifest.engines?.node === REQUIRED_NODE_RANGE,
    `engines.node must be "${REQUIRED_NODE_RANGE}"`,
  )
  check(
    Boolean(manifest.exports || (manifest.main && manifest.types)),
    'either exports, or both main and types, must be defined',
  )
  check(
    JSON.stringify(manifest.files) === JSON.stringify(REQUIRED_FILES),
    `files must be exactly ${JSON.stringify(REQUIRED_FILES)}`,
  )
  check(
    manifest.publishConfig?.access === 'public',
    'publishConfig.access must be "public"',
  )
  check(
    manifest.publishConfig?.provenance === true,
    'publishConfig.provenance must be true',
  )

  return errors
}
