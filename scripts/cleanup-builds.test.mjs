import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { cleanupBuilds } from './cleanup-builds.mjs'

const digest = (value) => createHash('sha256').update(value).digest('hex')
const installerName = (version) => `HAPI-Desktop-${version}-win-x64-setup.exe`
const verifier = fileURLToPath(new URL('./verify-package.mjs', import.meta.url))

async function write(path, content = 'keep this file') {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, content)
}

async function fixture(t, version = '1.0.12') {
  const root = await mkdtemp(join(tmpdir(), 'hapi-cleanup-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await write(join(root, 'package.json'), JSON.stringify({ version }))
  await mkdir(join(root, 'build'))
  return root
}

async function archive(root, version, directory = `v${version}`) {
  const folder = join(root, 'build', directory)
  const bytes = `MZ installer for ${version}`
  const executable = `MZ runtime for ${version}`
  const asar = `app.asar for ${version}`
  const installer = join(folder, installerName(version))
  const report = {
    version,
    installerSha256: digest(bytes),
    archiveTest: 'passed',
    payloadArchiveTest: 'passed',
    packagedBuildMatchesTestedBuild: true,
    appAsarSha256: digest(asar),
    executableSha256: digest(executable),
  }
  await write(installer, bytes)
  await write(join(folder, 'SHA256SUMS.txt'), `${digest(bytes)}  ${installerName(version)}\n`)
  await write(join(folder, 'verification.json'), JSON.stringify(report))
  await write(join(folder, 'source.patch'))
  await write(join(folder, 'package.log'))
  return { folder, installer, bytes, executable, asar, report }
}

async function runtime(folder, value) {
  await write(join(folder, 'HAPI Desktop.exe'), value.executable)
  await write(join(folder, 'resources', 'app.asar'), value.asar)
}

async function missing(path) {
  await assert.rejects(lstat(path), { code: 'ENOENT' })
}

test('preview and cleanup retain two versions, preserve records and remove only verified generated copies', async (t) => {
  const root = await fixture(t)
  const old = await archive(root, '1.0.9')
  await archive(root, '1.0.10')
  const previous = await archive(root, '1.0.11')
  const current = await archive(root, '1.0.12')
  const legacy = await archive(root, '1.0.3', 'dated-local-build')
  await write(
    join(legacy.folder, 'verification.json'),
    JSON.stringify({
      version: '1.0.3',
      nsisIntegrity: 'passed',
      installerSha256: digest(legacy.bytes),
    }),
  )
  await runtime(join(old.folder, 'verification', 'app'), old)
  await write(join(old.folder, 'verification', 'nsis', 'app-64.7z'))
  await runtime(join(root, 'build', 'win-unpacked'), current)
  await write(join(root, 'build', installerName('1.0.12')), current.bytes)
  await write(join(root, 'build', `${installerName('1.0.12')}.blockmap`))
  const protectedPaths = [
    join(root, 'build', 'tool-cache', 'electron.zip'),
    join(root, 'build', 'unknown-folder', 'source.ts'),
    join(root, 'out', 'main.js'),
    join(root, 'node_modules', 'dependency.js'),
    join(root, '.claude', 'worktrees', 'source.ts'),
    join(root, 'release', installerName('1.0.12')),
    join(current.folder, 'verification-failed', 'diagnostic.txt'),
  ]
  for (const path of protectedPaths) await write(path)
  const preview = await cleanupBuilds({ root })
  assert.equal(preview.status, 'preview')
  assert.deepEqual(
    preview.keep.map((entry) => entry.version),
    ['1.0.12', '1.0.11'],
  )
  assert.equal(await readFile(old.installer, 'utf8'), old.bytes)
  await missing(join(root, 'build', 'cleanup-reports'))

  const result = await cleanupBuilds({ root, apply: true })
  assert.ok(result.bytes > 0)
  assert.equal(result.status, 'completed')
  await missing(old.installer)
  await missing(legacy.installer)
  await missing(join(old.folder, 'verification'))
  await missing(join(root, 'build', 'win-unpacked'))
  await missing(join(root, 'build', installerName('1.0.12')))
  await missing(join(root, 'build', `${installerName('1.0.12')}.blockmap`))
  assert.equal(await readFile(current.installer, 'utf8'), current.bytes)
  assert.equal(await readFile(previous.installer, 'utf8'), previous.bytes)
  for (const path of [...protectedPaths, join(old.folder, 'source.patch'), join(old.folder, 'package.log')])
    assert.equal(await readFile(path, 'utf8'), 'keep this file')
  const record = JSON.parse(await readFile(join(root, result.record), 'utf8'))
  assert.equal(record.status, 'completed')
  assert.equal(record.removed.length, result.remove.length)
  const again = await cleanupBuilds({ root, apply: true })
  assert.equal(again.bytes, 0)
  assert.deepEqual(again.removed, [])
})

for (const failure of ['installer changed', 'checksum record changed', 'verification incomplete']) {
  test(`cleanup refuses to delete when the current ${failure}`, async (t) => {
    const root = await fixture(t)
    const old = await archive(root, '1.0.10')
    await archive(root, '1.0.11')
    const current = await archive(root, '1.0.12')
    if (failure === 'installer changed') await write(current.installer, 'modified installer')
    if (failure === 'checksum record changed') await write(join(current.folder, 'SHA256SUMS.txt'), '')
    if (failure === 'verification incomplete')
      await write(
        join(current.folder, 'verification.json'),
        JSON.stringify({
          ...current.report,
          packagedBuildMatchesTestedBuild: false,
        }),
      )
    await assert.rejects(cleanupBuilds({ root, apply: true }), /not safely archived|verification is missing/)
    assert.equal(await readFile(old.installer, 'utf8'), old.bytes)
    await missing(join(root, 'build', 'cleanup-reports'))
  })
}

test('failed and unknown builds survive cleanup, including a different staged runtime of the same version', async (t) => {
  const root = await fixture(t)
  const previous = await archive(root, '1.0.10')
  const broken = await archive(root, '1.0.11')
  const current = await archive(root, '1.0.12')
  await write(broken.installer, 'failed installer')
  const staged = join(root, 'build', installerName('1.0.12'))
  await write(staged, 'new unverified build')
  const future = join(root, 'build', 'v1.0.13', installerName('1.0.13'))
  await write(future, 'unfinished release')
  await runtime(join(root, 'build', 'win-unpacked'), { ...current, asar: 'different app' })
  const result = await cleanupBuilds({ root, apply: true })
  assert.deepEqual(
    result.keep.map((entry) => entry.version),
    ['1.0.12', '1.0.10'],
  )
  assert.ok(result.skipped.some((entry) => entry.path === 'v1.0.11'))
  assert.equal(await readFile(previous.installer, 'utf8'), previous.bytes)
  assert.equal(await readFile(broken.installer, 'utf8'), 'failed installer')
  assert.equal(await readFile(staged, 'utf8'), 'new unverified build')
  assert.equal(await readFile(future, 'utf8'), 'unfinished release')
  assert.equal(
    await readFile(join(root, 'build', 'win-unpacked', 'resources', 'app.asar'), 'utf8'),
    'different app',
  )
})

test('version retention compares numbers and prereleases, and refuses cleanup from an older checkout', async (t) => {
  const root = await fixture(t)
  await archive(root, '1.0.12-rc.9')
  await archive(root, '1.0.12-rc.10')
  const current = await archive(root, '1.0.12')
  const preview = await cleanupBuilds({ root })
  assert.deepEqual(
    preview.keep.map((entry) => entry.version),
    ['1.0.12', '1.0.12-rc.10'],
  )
  await write(join(root, 'package.json'), JSON.stringify({ version: '1.0.12-rc.10' }))
  await assert.rejects(cleanupBuilds({ root, apply: true }), /newer archived version/)
  assert.equal(await readFile(current.installer, 'utf8'), current.bytes)
})

test('directory links and linked files never expand the cleanup scope', async (t) => {
  const root = await fixture(t)
  const outside = await fixture(t)
  const external = await archive(outside, '1.0.9')
  await archive(root, '1.0.11')
  await archive(root, '1.0.12')
  await symlink(external.folder, join(root, 'build', 'v1.0.9'), 'junction')
  const old = await archive(root, '1.0.10')
  await runtime(join(old.folder, 'verification', 'app'), old)
  await symlink(external.folder, join(old.folder, 'verification', 'linked-files'), 'junction')
  const result = await cleanupBuilds({ root, apply: true })
  assert.ok(result.skipped.some((entry) => entry.path.endsWith('verification')))
  assert.ok((await lstat(join(old.folder, 'verification'))).isDirectory())
  assert.ok((await lstat(join(root, 'build', 'v1.0.9'))).isSymbolicLink())
  assert.equal(await readFile(external.installer, 'utf8'), external.bytes)
  await rm(join(root, 'build'), { recursive: true })
  await symlink(join(outside, 'build'), join(root, 'build'), 'junction')
  await assert.rejects(cleanupBuilds({ root, apply: true }), /build is a link/)
  assert.equal(await readFile(external.installer, 'utf8'), external.bytes)
})

test('package verification failure does not trigger automatic cleanup', async (t) => {
  const root = await fixture(t)
  const old = await archive(root, '1.0.10')
  await archive(root, '1.0.11')
  await archive(root, '1.0.12')
  execFileSync('git', ['init', '--quiet'], { cwd: root })
  execFileSync(process.execPath, [verifier, 'record-inputs'], { cwd: root, stdio: 'pipe' })
  await write(join(root, 'package.json'), JSON.stringify({ version: '1.0.12', description: 'changed' }))
  assert.throws(
    () => execFileSync(process.execPath, [verifier, 'verify'], { cwd: root, stdio: 'pipe' }),
    /Packaging input changed: package.json/,
  )
  assert.equal(await readFile(old.installer, 'utf8'), old.bytes)
  await missing(join(root, 'build', 'cleanup-reports'))
})
