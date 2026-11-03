import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\w.-]+))?$/
const digestPattern = /^[a-f0-9]{64}$/

function versionParts(version) {
  assert.equal(typeof version, 'string', 'Missing archive version')
  const match = version.match(versionPattern)
  assert.ok(match && match[0] === version, `Invalid archive version: ${version}`)
  const prerelease = match[4]?.split('.') ?? []
  assert.ok(prerelease.every((part) => /^[\da-z-]+$/i.test(part) && !/^0\d+$/.test(part)))
  return { core: match.slice(1, 4).map(BigInt), prerelease }
}

function compareVersions(left, right) {
  const a = versionParts(left)
  const b = versionParts(right)
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i] ? 1 : -1
  }
  if (!a.prerelease.length || !b.prerelease.length)
    return Number(!a.prerelease.length) - Number(!b.prerelease.length)
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i]
    const y = b.prerelease[i]
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1
    if (x === y) continue
    const numericX = /^\d+$/.test(x)
    const numericY = /^\d+$/.test(y)
    if (numericX && numericY) return BigInt(x) > BigInt(y) ? 1 : -1
    if (numericX !== numericY) return numericX ? -1 : 1
    return x > y ? 1 : -1
  }
  return 0
}

async function info(path) {
  try {
    return await lstat(path)
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
}

async function hashFile(path) {
  assert.ok((await info(path))?.isFile(), `Expected a regular file: ${path}`)
  const hash = createHash('sha256')
  for await (const bytes of createReadStream(path)) hash.update(bytes)
  return hash.digest('hex')
}

async function readArchive(build, directory) {
  const folder = join(build, directory)
  const reportPath = join(folder, 'verification.json')
  if (!(await info(reportPath))) return undefined
  assert.ok((await info(reportPath)).isFile(), `Linked verification report: ${directory}`)
  const report = JSON.parse(await readFile(reportPath, 'utf8'))
  versionParts(report.version)
  if (directory.startsWith('v') && versionPattern.test(directory.slice(1)))
    assert.equal(directory, `v${report.version}`, `Archive directory/version mismatch: ${directory}`)
  assert.ok(
    report.archiveTest === 'passed' || report.nsisIntegrity === 'passed',
    `Archive did not pass verification: ${directory}`,
  )
  assert.match(report.installerSha256, digestPattern)
  // Derive paths locally; legacy reports can contain absolute paths from another machine.
  const name = `HAPI-Desktop-${report.version}-win-x64-setup.exe`
  const installer = join(folder, name)
  if (!(await info(installer))) return undefined // Previously pruned archives retain their records.
  assert.ok((await info(join(folder, 'SHA256SUMS.txt')))?.isFile())
  const checksums = await readFile(join(folder, 'SHA256SUMS.txt'), 'utf8')
  assert.ok(
    checksums.split(/\r?\n/).some((line) => line === `${report.installerSha256}  ${name}`),
    `Checksum record mismatch: ${directory}`,
  )
  assert.equal(await hashFile(installer), report.installerSha256, `Installer changed: ${directory}`)
  return { directory, folder, name, installer, version: report.version, report }
}

async function runtimeMatches(folder, report) {
  if (!(await info(folder))?.isDirectory()) return false
  const resources = join(folder, 'resources')
  if (!(await info(resources))?.isDirectory()) return false
  if (!digestPattern.test(report.appAsarSha256) || !digestPattern.test(report.executableSha256)) return false
  const asar = join(resources, 'app.asar')
  const executable = join(folder, 'HAPI Desktop.exe')
  if (!(await info(asar))?.isFile() || !(await info(executable))?.isFile()) return false
  return (
    (await hashFile(asar)) === report.appAsarSha256 &&
    (await hashFile(executable)) === report.executableSha256
  )
}

async function treeBytes(path) {
  const entry = await lstat(path)
  assert.ok(!entry.isSymbolicLink(), `Cleanup does not follow links: ${path}`)
  if (entry.isFile()) return entry.size
  assert.ok(entry.isDirectory(), `Unknown artifact type: ${path}`)
  let bytes = 0
  for (const name of await readdir(path)) bytes += await treeBytes(join(path, name))
  return bytes
}

export async function cleanupBuilds({ root = '.', apply = false } = {}) {
  root = await realpath(root)
  const build = join(root, 'build')
  assert.ok((await info(build))?.isDirectory(), 'Missing build directory or build is a link')
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  versionParts(version)
  const entries = await readdir(build, { withFileTypes: true })
  const archives = []
  const skipped = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'tool-cache') continue
    try {
      const archive = await readArchive(build, entry.name)
      if (archive) archives.push(archive)
    } catch (error) {
      skipped.push({ path: entry.name, reason: error.message })
    }
  }
  const current = archives.find((archive) => archive.directory === `v${version}`)
  assert.ok(current, `Current installer is not safely archived: v${version}; no cleanup performed`)
  assert.equal(current.report.payloadArchiveTest, 'passed', 'Current payload verification is missing')
  assert.equal(current.report.packagedBuildMatchesTestedBuild, true, 'Current build verification is missing')
  assert.ok(
    !archives.some((archive) => compareVersions(archive.version, version) > 0),
    'A newer archived version exists; no cleanup performed',
  )
  const previous = archives
    .filter((archive) => compareVersions(archive.version, version) < 0)
    .sort(
      (a, b) =>
        compareVersions(b.version, a.version) ||
        Number(b.directory === `v${b.version}`) - Number(a.directory === `v${a.version}`),
    )[0]
  const retained = [current, ...(previous ? [previous] : [])]
  const keep = retained.map(({ version, installer, report }) => ({
    version,
    path: relative(root, installer),
    sha256: report.installerSha256,
  }))
  const remove = []
  async function add(path, reason) {
    const entry = await info(path)
    if (!entry) return
    try {
      const bytes = await treeBytes(path)
      remove.push({ path: relative(root, path), bytes, reason })
    } catch (error) {
      skipped.push({ path: relative(root, path), reason: error.message })
    }
  }
  for (const archive of archives) {
    if (!retained.includes(archive)) {
      await add(archive.installer, 'older installer')
      await add(`${archive.installer}.blockmap`, 'older installer blockmap')
    }
    // Successful legacy checks retained an entire second Electron runtime here.
    // Failed verification-* directories remain available for diagnosis.
    const extraction = join(archive.folder, 'verification')
    if (
      (await info(extraction))?.isDirectory() &&
      (await runtimeMatches(join(extraction, 'app'), archive.report))
    )
      await add(extraction, 'verified legacy extraction')
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const copies = archives.filter((archive) => archive.name === entry.name)
    if (!copies.length) continue
    const path = join(build, entry.name)
    const hash = await hashFile(path)
    if (!copies.some((archive) => archive.report.installerSha256 === hash)) {
      skipped.push({ path: relative(root, path), reason: 'Staged installer differs from its archive' })
      continue
    }
    await add(path, 'archived installer duplicate')
    await add(`${path}.blockmap`, 'archived installer blockmap')
  }
  const unpacked = join(build, 'win-unpacked')
  if (await runtimeMatches(unpacked, current.report)) await add(unpacked, 'verified packaging runtime')
  const result = {
    status: apply ? 'completed' : 'preview',
    version,
    keep,
    remove,
    skipped,
    bytes: remove.reduce((sum, entry) => sum + entry.bytes, 0),
    removed: [],
  }
  if (!apply || !remove.length) return result

  // Check retained installers once more before the first deletion. No version
  // archive, log, source snapshot, dependency, worktree or download cache is removed.
  for (const archive of retained)
    assert.equal(await hashFile(archive.installer), archive.report.installerSha256)
  const reports = join(build, 'cleanup-reports')
  if (await info(reports))
    assert.ok((await info(reports)).isDirectory(), 'Cleanup report directory is a link')
  else await mkdir(reports)
  const timestamp = new Date().toISOString().replaceAll(':', '-')
  result.record = relative(root, join(reports, `${timestamp}-${process.pid}.json`))
  result.status = 'running'
  await writeFile(join(root, result.record), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
  try {
    for (const entry of remove) {
      const path = join(root, entry.path)
      assert.equal(await realpath(build), build, 'Build directory changed during cleanup')
      assert.equal(await realpath(path), path, 'Artifact path changed during cleanup')
      await rm(path, { recursive: true })
      result.removed.push(entry.path)
    }
    result.status = 'completed'
  } catch (error) {
    result.status = 'failed'
    result.error = error.message
    throw error
  } finally {
    await writeFile(join(root, result.record), JSON.stringify(result, null, 2) + '\n')
  }
  return result
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(
    process.argv.slice(2).every((arg) => arg === '--apply'),
    'Usage: cleanup-builds.mjs [--apply]',
  )
  console.log(JSON.stringify(await cleanupBuilds({ apply: process.argv.includes('--apply') }), null, 2))
}
