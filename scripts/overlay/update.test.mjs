import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const pwsh = process.env.HAPI_TEST_PWSH ?? (process.platform === 'win32' ? 'powershell.exe' : 'pwsh')
const source = join(dirname(fileURLToPath(import.meta.url)), 'Update.ps1')
const digest = (value) => createHash('sha256').update(value).digest('hex')
const oldApp = 'verified original application'
const newApp = 'verified updated application'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'hapi-overlay-apply-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const install = join(root, 'HAPI 安装目录')
  const payload = join(root, 'update package')
  await mkdir(join(install, 'resources'), { recursive: true })
  await mkdir(join(payload, 'resources'), { recursive: true })
  const installed = join(install, 'resources', 'app.asar')
  const candidate = join(payload, 'resources', 'app.asar')
  const backup = join(install, 'resources', `app.asar.backup-1.0.21-${digest(oldApp).slice(0, 12)}`)
  const executable = join(install, 'HAPI Desktop.exe')
  const script = join(payload, 'Update.ps1')
  const manifest = {
    format: 1,
    product: 'HAPI Desktop',
    platform: 'win32-x64',
    fromVersion: '1.0.21',
    version: '1.0.22',
    baseAsarSha256: digest(oldApp),
    targetAsarSha256: digest(newApp),
    allowedExecutableSha256: [digest('fixture executable')],
  }
  await writeFile(installed, oldApp)
  await writeFile(candidate, newApp)
  await writeFile(executable, 'fixture executable')
  await writeFile(join(install, 'user-data.txt'), 'untouched draft')
  await copyFile(source, script)
  await writeFile(join(payload, 'manifest.json'), JSON.stringify(manifest))
  const run = (args = [], entry = script) =>
    execFileSync(
      pwsh,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        entry,
        '-InstallDir',
        install,
        ...args,
      ],
      { encoding: 'utf8', stdio: 'pipe', timeout: 20_000 },
    )
  return { root, install, payload, installed, candidate, backup, executable, script, manifest, run }
}

test('the shipped script upgrades, preserves a verified backup, repeats safely and restores', async (t) => {
  const f = await fixture(t)
  assert.match(f.run(), /Completed/)
  assert.equal(await readFile(f.installed, 'utf8'), newApp)
  assert.equal(await readFile(f.backup, 'utf8'), oldApp)
  assert.match(f.run(), /already installed/)
  assert.match(f.run(['-Restore']), /Backup restored/)
  assert.equal(await readFile(f.installed, 'utf8'), oldApp)
  assert.match(f.run(['-Restore']), /already installed/)
  assert.match(f.run(), /Completed/)
  assert.equal(await readFile(f.backup, 'utf8'), oldApp)
  assert.equal(await readFile(join(f.install, 'user-data.txt'), 'utf8'), 'untouched draft')
  assert.equal(
    (await readdir(join(f.install, 'resources'))).some((name) => name.endsWith('.tmp')),
    false,
  )
})

for (const changed of ['installed', 'candidate', 'executable', 'backup']) {
  test(`the script refuses a changed ${changed} without replacing application files`, async (t) => {
    const f = await fixture(t)
    await writeFile(f[changed], 'unexpected content')
    const before = await readFile(f.installed)
    assert.throws(() => f.run())
    assert.deepEqual(await readFile(f.installed), before)
    assert.equal(await readFile(f[changed], 'utf8'), 'unexpected content')
  })
}

test('restore refuses a damaged backup and preserves the working updated application', async (t) => {
  const f = await fixture(t)
  f.run()
  await writeFile(f.backup, 'damaged backup')
  assert.throws(() => f.run(['-Restore']))
  assert.equal(await readFile(f.installed, 'utf8'), newApp)
})

test('the script refuses linked application files and invalid manifest versions', async (t) => {
  const f = await fixture(t)
  await writeFile(
    join(f.payload, 'manifest.json'),
    JSON.stringify({ ...f.manifest, fromVersion: '1.0.21\n' }),
  )
  assert.throws(() => f.run())
  await writeFile(join(f.payload, 'manifest.json'), JSON.stringify(f.manifest))
  const external = join(f.root, 'external.asar')
  await writeFile(external, oldApp)
  await rm(f.installed)
  await symlink(external, f.installed)
  assert.throws(() => f.run())
  assert.equal(await readFile(external, 'utf8'), oldApp)
})

test('an active desktop process blocks the update without terminating it or changing files', async (t) => {
  const f = await fixture(t)
  const wrapper = join(f.payload, 'running-process.ps1')
  await writeFile(
    wrapper,
    [
      'param([string]$InstallDir)',
      'function Get-Process { [pscustomobject]@{ ProcessName = "HAPI Desktop" } }',
      '& (Join-Path $PSScriptRoot "Update.ps1") -InstallDir $InstallDir',
      'exit $LASTEXITCODE',
    ].join('\n'),
  )
  assert.throws(() => f.run([], wrapper))
  assert.equal(await readFile(f.installed, 'utf8'), oldApp)
  await assert.rejects(readFile(f.backup), { code: 'ENOENT' })
})

test('a failed verification after replacement restores the original application and reports failure', async (t) => {
  const f = await fixture(t)
  const wrapper = join(f.payload, 'failed-verification.ps1')
  await writeFile(
    wrapper,
    [
      'param([string]$InstallDir)',
      '$global:HapiOverlayTestInstalledPath = Join-Path $InstallDir "resources/app.asar"',
      'function Get-FileHash {',
      '  param([string]$LiteralPath, [string]$Algorithm)',
      '  $value = Microsoft.PowerShell.Utility\\Get-FileHash -LiteralPath $LiteralPath -Algorithm $Algorithm',
      `  if ($LiteralPath -eq $global:HapiOverlayTestInstalledPath -and $value.Hash -eq '${digest(newApp)}') { $value.Hash = '0' * 64 }`,
      '  return $value',
      '}',
      '& (Join-Path $PSScriptRoot "Update.ps1") -InstallDir $InstallDir',
      'exit $LASTEXITCODE',
    ].join('\n'),
  )
  assert.throws(() => f.run([], wrapper), /Installed checksum mismatch/)
  assert.equal(await readFile(f.installed, 'utf8'), oldApp)
  assert.equal(await readFile(f.backup, 'utf8'), oldApp)
})
