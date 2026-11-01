import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { constants, createReadStream } from 'node:fs'
import {
  appendFile,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, relative, resolve } from 'node:path'

// Record inputs before packaging, then outputs before testing. Verification
// compares the actual installer payload against both immutable snapshots.
const command = process.argv[2] ?? 'verify'
assert.ok(['record-inputs', 'record-output', 'verify'].includes(command), 'Unknown verification command')
const root = resolve('.')
const { version } = JSON.parse(await readFile('package.json', 'utf8'))
assert.match(version, /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/)
const archive = resolve('build', `v${version}`)
await mkdir(archive, { recursive: true })
const inputManifest = join(archive, 'source-snapshot.json')
const outputManifest = join(archive, 'tested-build-sha256.json')
const hashBytes = (bytes) => createHash('sha256').update(bytes).digest('hex')
const portable = (file) => relative(root, resolve(file)).replaceAll('\\', '/')

async function hashFile(file) {
  const hash = createHash('sha256')
  for await (const bytes of createReadStream(file)) hash.update(bytes)
  return hash.digest('hex')
}

async function files(dir) {
  const result = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name)
    if (entry.isDirectory()) result.push(...(await files(file)))
    else if (entry.isFile()) result.push(portable(file))
  }
  return result.sort()
}

async function record(paths, target) {
  const hashes = {}
  for (const file of paths) hashes[file] = await hashFile(file)
  // Never silently replace the evidence belonging to an existing package.
  await writeFile(target, JSON.stringify(hashes, null, 2) + '\n', { flag: 'wx' })
  console.log(`Recorded ${paths.length} files in ${portable(target)}`)
}

function sourceInputs() {
  const roots = new Set([
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    'UPSTREAM.json',
    'UPSTREAM-FILES.json',
    'package.json',
    'bun.lock',
    'electron.vite.config.ts',
    'tsconfig.json',
  ])
  const tracked = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'utf8' })
  return [
    ...new Set(
      tracked
        .split('\0')
        .filter((file) => roots.has(file) || /^(src|vendor|resources|scripts|patches)\//.test(file)),
    ),
  ].sort()
}

async function verify() {
  const source = JSON.parse(await readFile(inputManifest, 'utf8'))
  assert.deepEqual(sourceInputs(), Object.keys(source).sort(), 'Packaging input file set changed')
  for (const [file, expected] of Object.entries(source))
    assert.equal(await hashFile(file), expected, `Packaging input changed: ${file}`)

  const name = `HAPI-Desktop-${version}-win-x64-setup.exe`
  const stagedInstaller = join('build', name)
  const installer = join(archive, name)
  try {
    await copyFile(stagedInstaller, installer, constants.COPYFILE_EXCL)
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    assert.equal(
      await hashFile(installer),
      await hashFile(stagedInstaller),
      'Version archive already differs',
    )
  }
  const unpack = await mkdtemp(join(archive, 'verification-'))
  const nsis = join(unpack, 'nsis')
  const app = join(unpack, 'app')
  const log = join(archive, 'installer-verification.log')
  await writeFile(log, '')
  async function sevenZip(args) {
    await appendFile(log, `7z ${args.join(' ')}\n`)
    try {
      const output = execFileSync('7z', args, { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
      await appendFile(log, output + '\n')
    } catch (error) {
      await appendFile(log, String(error.stdout ?? '') + String(error.stderr ?? ''))
      throw error
    }
  }
  // Keep extraction and its diagnostics on failure. Successful verification
  // only needs the installer, hashes and logs, not a second runtime tree.
  await sevenZip(['t', installer])
  await sevenZip(['x', '-y', installer, `-o${nsis}`])
  const payload = join(nsis, '$PLUGINSDIR', 'app-64.7z')
  await sevenZip(['t', payload])
  await sevenZip(['x', '-y', payload, `-o${app}`])
  const packedAsar = join(app, 'resources', 'app.asar')
  const appAsarSha256 = await hashFile(packedAsar)
  assert.equal(appAsarSha256, await hashFile('build/win-unpacked/resources/app.asar'))
  const executableSha256 = await hashFile(join(app, 'HAPI Desktop.exe'))
  assert.equal(executableSha256, await hashFile('build/win-unpacked/HAPI Desktop.exe'))
  const require = createRequire(join(root, 'package.json'))
  const builderRequire = createRequire(require.resolve('electron-builder'))
  const appBuilderRequire = createRequire(builderRequire.resolve('app-builder-lib'))
  const asar = appBuilderRequire('@electron/asar')
  assert.equal(JSON.parse(asar.extractFile(packedAsar, 'package.json').toString()).version, version)

  const outputs = JSON.parse(await readFile(outputManifest, 'utf8'))
  const currentOutputs = await files('out')
  assert.deepEqual(currentOutputs, Object.keys(outputs).sort(), 'Tested output file set changed')
  for (const [file, expected] of Object.entries(outputs)) {
    assert.equal(await hashFile(file), expected, `Tested output changed: ${file}`)
    assert.equal(hashBytes(asar.extractFile(packedAsar, file)), expected, `Packaged output mismatch: ${file}`)
  }
  for (const file of ['LICENSE', 'UPSTREAM.json', 'THIRD_PARTY_NOTICES.md'])
    assert.equal(
      hashBytes(asar.extractFile(packedAsar, file)),
      await hashFile(file),
      `Notice mismatch: ${file}`,
    )
  const resources = await files('resources')
  for (const file of resources)
    assert.equal(
      await hashFile(join(app, 'resources', file)),
      await hashFile(file),
      `Resource mismatch: ${file}`,
    )
  const runtimeVersion = (await readFile(join(app, 'version'), 'utf8')).trim()
  assert.equal(runtimeVersion, require('electron/package.json').version)

  const installerSha256 = await hashFile(installer)
  const report = {
    version,
    installer,
    installerBytes: (await stat(installer)).size,
    installerSha256,
    archiveTest: 'passed',
    payloadArchiveTest: 'passed',
    appAsarSha256,
    executableSha256,
    checkedOutputFiles: currentOutputs.length,
    checkedSourceInputs: Object.keys(source).length,
    checkedLicenseSourceFiles: 3,
    checkedExtraResourceFiles: resources.length,
    packagedBuildMatchesTestedBuild: true,
    runtimeVersion,
    cpuAffinity:
      process.platform === 'linux'
        ? (await readFile('/proc/self/status', 'utf8')).match(/^Cpus_allowed_list:\s*(.+)$/m)?.[1]
        : undefined,
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceIncludesUncommittedChanges:
      execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
    windowsInstallationTested: false,
    completedAt: new Date().toISOString(),
  }
  await writeFile(join(archive, 'verification.json'), JSON.stringify(report, null, 2) + '\n')
  await writeFile(join(archive, 'SHA256SUMS.txt'), `${installerSha256}  ${name}\n`)
  await rm(unpack, { recursive: true })
  console.log(JSON.stringify(report, null, 2))
}

if (command === 'record-inputs') await record(sourceInputs(), inputManifest)
else if (command === 'record-output') await record(await files('out'), outputManifest)
else await verify()
