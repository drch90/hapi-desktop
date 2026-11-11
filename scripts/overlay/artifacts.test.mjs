import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { assertCompatible, digest, inheritedExecutables } from './artifacts.mjs'

const baseline = {
  runtimeVersion: '40.10.6',
  code: [{ name: '.text', sha256: digest('runtime') }],
  resources: [{ type: 24, sha256: digest('requested execution level') }],
  files: { version: digest('40.10.6'), 'resources/icon.png': digest('icon') },
}

test('resource overlays require the same runtime, executable code and every file outside app.asar', () => {
  assert.doesNotThrow(() => assertCompatible(baseline, structuredClone(baseline), '1.0.21', '1.0.22'))
  assert.throws(() => assertCompatible(baseline, baseline, '1.0.22', '1.0.22'), /newer/)
  assert.throws(
    () => assertCompatible(baseline, { ...baseline, runtimeVersion: '41.0.0' }, '1.0.21', '1.0.22'),
    /runtime changed/,
  )
  assert.throws(
    () => assertCompatible(baseline, { ...baseline, code: [] }, '1.0.21', '1.0.22'),
    /code changed/,
  )
  assert.throws(
    () => assertCompatible(baseline, { ...baseline, resources: [] }, '1.0.21', '1.0.22'),
    /resources changed/,
  )
  for (const files of [
    { ...baseline.files, 'resources/icon.png': digest('new icon') },
    { ...baseline.files, 'resources/app.asar.unpacked/addon.node': digest('native addon') },
    { version: baseline.files.version },
  ])
    assert.throws(
      () => assertCompatible(baseline, { ...baseline, files }, '1.0.21', '1.0.22'),
      /outside app.asar changed/,
    )
})

test('chained upgrades retain executable identities only from a verified previous overlay manifest', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'hapi-overlay-chain-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const oldExe = digest('base exe')
  const currentExe = digest('current full installer exe')
  const asar = digest('current app')
  const archive = {
    folder,
    version: '1.0.22',
    report: {
      executableSha256: currentExe,
      appAsarSha256: asar,
      runtimeVersion: '40.10.6',
    },
  }
  assert.deepEqual(await inheritedExecutables(archive), [currentExe])
  const manifest = JSON.stringify({
    version: '1.0.22',
    runtimeVersion: '40.10.6',
    targetAsarSha256: asar,
    allowedExecutableSha256: [oldExe, currentExe],
  })
  await writeFile(join(folder, 'overlay-manifest.json'), manifest)
  await writeFile(
    join(folder, 'overlay-verification.json'),
    JSON.stringify({
      status: 'verified',
      version: '1.0.22',
      targetAsarSha256: asar,
      manifestSha256: digest(manifest),
    }),
  )
  assert.deepEqual(await inheritedExecutables(archive), [currentExe, oldExe])
  await writeFile(
    join(folder, 'overlay-manifest.json'),
    manifest.replace(oldExe, digest('unknown executable')),
  )
  await assert.rejects(inheritedExecutables(archive), /manifest changed/)
})
