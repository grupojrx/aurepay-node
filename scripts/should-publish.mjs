/**
 * Decide se @aurepay/sdk deve ir ao npm.
 *
 * exit 0  → publicar
 * exit 10 → pular (sem alterações / já publicado)
 * exit 1  → erro (ex.: código mudou mas a versão já existe)
 */
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const packageName = pkg.name

function walkFiles(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)

    if (statSync(path).isDirectory()) {
      walkFiles(path, files)
      continue
    }

    files.push(path)
  }

  return files
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function sortKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeys)
  }

  if (value && typeof value === 'object') {
    const object = /** @type {Record<string, unknown>} */ (value)
    const sorted = {}

    for (const key of Object.keys(object).sort()) {
      sorted[key] = sortKeys(object[key])
    }

    return sorted
  }

  return value
}

/**
 * Hash estável do surface publicado (src + package.json sem version).
 * @param {string} base
 */
function contentHash(base) {
  const hash = createHash('sha256')
  const pkgPath = join(base, 'package.json')

  if (existsSync(pkgPath)) {
    const parsed = JSON.parse(readFileSync(pkgPath, 'utf8'))
    delete parsed.version
    hash.update('package.json\0')
    hash.update(JSON.stringify(sortKeys(parsed)))
    hash.update('\0')
  }

  const srcDir = join(base, 'src')

  if (!existsSync(srcDir)) {
    throw new Error(`src/ missing in ${base}`)
  }

  const files = walkFiles(srcDir).sort((a, b) =>
    relative(base, a).localeCompare(relative(base, b))
  )

  for (const file of files) {
    const rel = relative(base, file).replaceAll('\\', '/')
    const body = readFileSync(file, 'utf8').replaceAll('\r\n', '\n')
    hash.update(rel)
    hash.update('\0')
    hash.update(body)
    hash.update('\0')
  }

  return hash.digest('hex')
}

function npmView(spec) {
  try {
    return execSync(`npm view ${spec} version`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
  } catch {
    return ''
  }
}

const localHash = contentHash(root)
const remoteLatest = npmView(packageName)

if (!remoteLatest) {
  console.log(`no remote package — publish ${packageName}@${pkg.version}`)
  process.exit(0)
}

const work = mkdtempSync(join(tmpdir(), 'aurepay-sdk-cmp-'))

try {
  execSync(`npm pack ${packageName}@${remoteLatest} --pack-destination "${work}"`, {
    stdio: ['ignore', 'pipe', 'pipe']
  })

  const tarball = readdirSync(work).find((name) => name.endsWith('.tgz'))

  if (!tarball) {
    throw new Error('npm pack produced no tarball')
  }

  execSync(`tar -xzf "${join(work, tarball)}" -C "${work}"`, { stdio: 'pipe' })

  const remoteHash = contentHash(join(work, 'package'))

  if (localHash === remoteHash) {
    console.log(
      `SDK unchanged vs ${packageName}@${remoteLatest} — skip publish (${localHash.slice(0, 12)})`
    )
    process.exit(10)
  }

  if (npmView(`${packageName}@${pkg.version}`)) {
    console.error(
      `SDK source changed, but ${packageName}@${pkg.version} already exists on npm. Bump version in package.json.`
    )
    process.exit(1)
  }

  console.log(
    `SDK changed (${localHash.slice(0, 8)} ≠ ${remoteHash.slice(0, 8)}) — publish ${pkg.version}`
  )
  process.exit(0)
} finally {
  rmSync(work, { recursive: true, force: true })
}
