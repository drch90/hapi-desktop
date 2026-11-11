import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { appendFile, readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, relative } from 'node:path'
import { promisify } from 'node:util'
import { compareVersions, hashFile, info, readArchive, versionParts } from '../cleanup-builds.mjs'

const require = createRequire(import.meta.url)
const builderRequire = createRequire(require.resolve('electron-builder'))
const appBuilderRequire = createRequire(builderRequire.resolve('app-builder-lib'))
export const asar = appBuilderRequire('@electron/asar')
const { NtExecutable, NtExecutableResource } = appBuilderRequire('resedit')
const { getCurrentFuseWire, FuseV1Options } = appBuilderRequire('@electron/fuses')
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
export const digestPattern = /^[a-f0-9]{64}$/

export async function sevenZip(args, log, cwd) {
  await appendFile(log, `7z ${args.join(' ')}\n`)
  try {
    const { stdout, stderr } = await promisify(execFile)('7z', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    })
    await appendFile(log, stdout + stderr + '\n')
  } catch (error) {
    await appendFile(log, String(error.stdout ?? '') + String(error.stderr ?? ''))
    throw error
  }
}

export async function fileHashes(directory) {
  const result = {}
  async function walk(folder) {
    assert.ok((await info(folder))?.isDirectory(), `Linked or missing directory: ${folder}`)
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name)
      if (entry.isDirectory()) await walk(path)
      else result[relative(directory, path).replaceAll('\\', '/')] = await hashFile(path)
    }
  }
  await walk(directory)
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)))
}

export async function verifiedArchive(root, version) {
  versionParts(version)
  assert.ok((await info(join(root, 'build')))?.isDirectory(), 'Build directory is missing or linked')
  assert.ok(
    (await info(join(root, 'build', `v${version}`)))?.isDirectory(),
    'Archive directory is missing or linked',
  )
  const archive = await readArchive(join(root, 'build'), `v${version}`)
  assert.ok(archive, `Missing verified full installer: ${version}`)
  assert.equal(archive.report.payloadArchiveTest, 'passed', 'Missing payload verification')
  assert.equal(archive.report.packagedBuildMatchesTestedBuild, true, 'Missing build verification')
  return archive
}

export async function extractArchive(archive, target, log) {
  const nsis = join(target, 'nsis')
  const app = join(target, 'app')
  await sevenZip(['x', '-y', archive.installer, `-o${nsis}`, '$PLUGINSDIR/app-64.7z'], log)
  await sevenZip(['x', '-y', join(nsis, '$PLUGINSDIR', 'app-64.7z'), `-o${app}`], log)
  assert.equal(await hashFile(join(app, 'resources', 'app.asar')), archive.report.appAsarSha256)
  assert.equal(await hashFile(join(app, 'HAPI Desktop.exe')), archive.report.executableSha256)
  return app
}

export async function runtimeState(app) {
  const executable = join(app, 'HAPI Desktop.exe')
  const bytes = await readFile(executable)
  assert.equal(bytes.readUInt16LE(bytes.readUInt32LE(0x3c) + 4), 0x8664, 'Expected Windows x64 runtime')
  const fuses = await getCurrentFuseWire(executable)
  // Never disable validation to make a resource-only upgrade possible.
  assert.equal(
    fuses[FuseV1Options.EnableEmbeddedAsarIntegrityValidation],
    48,
    'Embedded ASAR validation requires a full installer',
  )
  const pe = NtExecutable.from(bytes)
  const sections = pe.getAllSections()
  const resources = sections.filter((section) => section.info.name === '.rsrc')
  assert.equal(resources.length, 1, 'Unknown PE resource layout; use a full installer')
  // Version and ASAR digest resources vary between releases. Every other PE
  // section, including executable code and fuse settings, must be identical.
  const code = sections
    .filter((section) => section.info.name !== '.rsrc')
    .map((section) => ({
      name: section.info.name,
      virtualAddress: section.info.virtualAddress,
      characteristics: section.info.characteristics,
      sha256: digest(Buffer.from(section.data ?? new ArrayBuffer(0))),
    }))
  const files = await fileHashes(app)
  delete files['HAPI Desktop.exe']
  delete files['resources/app.asar']
  return {
    runtimeVersion: (await readFile(join(app, 'version'), 'utf8')).trim(),
    code,
    resources: NtExecutableResource.from(pe)
      .entries.filter(
        (entry) => entry.type !== 16 && !(entry.type === 'INTEGRITY' && entry.id === 'ELECTRONASAR'),
      )
      .map((entry) => ({
        type: entry.type,
        id: entry.id,
        lang: entry.lang,
        codepage: entry.codepage,
        sha256: digest(Buffer.from(entry.bin)),
      })),
    files,
  }
}

export function assertCompatible(base, target, fromVersion, version) {
  assert.ok(compareVersions(version, fromVersion) > 0, 'Overlay target must be newer than its base')
  assert.equal(target.runtimeVersion, base.runtimeVersion, 'Electron runtime changed; use a full installer')
  assert.deepEqual(target.code, base.code, 'Executable code changed; use a full installer')
  assert.deepEqual(target.resources, base.resources, 'Executable resources changed; use a full installer')
  assert.deepEqual(target.files, base.files, 'Files outside app.asar changed; use a full installer')
}

export async function inheritedExecutables(archive) {
  const hashes = [archive.report.executableSha256]
  const reportPath = join(archive.folder, 'overlay-verification.json')
  if (!(await info(reportPath))) return hashes
  assert.ok((await info(reportPath))?.isFile(), 'Linked overlay verification record')
  const report = JSON.parse(await readFile(reportPath, 'utf8'))
  assert.equal(report.status, 'verified')
  assert.equal(report.version, archive.version)
  assert.equal(report.targetAsarSha256, archive.report.appAsarSha256)
  const manifestPath = join(archive.folder, 'overlay-manifest.json')
  assert.equal(await hashFile(manifestPath), report.manifestSha256, 'Previous overlay manifest changed')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.equal(manifest.version, archive.version)
  assert.equal(manifest.targetAsarSha256, archive.report.appAsarSha256)
  assert.equal(manifest.runtimeVersion, archive.report.runtimeVersion)
  for (const hash of manifest.allowedExecutableSha256) {
    assert.match(hash, digestPattern)
    hashes.push(hash)
  }
  return [...new Set(hashes)]
}
