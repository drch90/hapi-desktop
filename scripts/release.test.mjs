import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const script = fileURLToPath(new URL('./release.mjs', import.meta.url))

test('release preparation binds the tag, version, notes and exact installer bytes', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'hapi-release-test-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const output = join(cwd, 'github-output')
  const run = (command, ref = 'refs/tags/v0.1.11') =>
    execFileSync(process.execPath, [script, command], {
      cwd,
      env: { ...process.env, GITHUB_REF: ref, GITHUB_OUTPUT: output },
      stdio: 'pipe',
    })
  await writeFile(join(cwd, 'package.json'), JSON.stringify({ version: '0.1.11' }))
  assert.throws(() => run('check', 'refs/tags/v0.1.10'), /does not match/)
  assert.throws(() => run('check'), /ENOENT/)
  await mkdir(join(cwd, 'docs', 'release-notes'), { recursive: true })
  const notes = '# HAPI Desktop 0.1.11\n\nRelease notes.\n'
  await writeFile(join(cwd, 'docs', 'release-notes', 'v0.1.11.md'), notes)
  run('check')
  assert.match(await readFile(output, 'utf8'), /version=0.1.11\ntag=v0.1.11\nprerelease=false/)
  assert.throws(() => run('prepare'), /ENOENT/)
  await mkdir(join(cwd, 'build'))
  const installer = 'HAPI-Desktop-0.1.11-win-x64-setup.exe'
  const bytes = Buffer.from('MZ\0installer fixture\xff', 'latin1')
  await writeFile(join(cwd, 'build', installer), bytes)
  run('prepare')
  assert.deepEqual(await readFile(join(cwd, 'release', installer)), bytes)
  assert.equal(await readFile(join(cwd, 'release', 'RELEASE_NOTES.md'), 'utf8'), notes)
  assert.equal(
    await readFile(join(cwd, 'release', 'SHA256SUMS.txt'), 'utf8'),
    `${createHash('sha256').update(bytes).digest('hex')}  ${installer}\n`,
  )
  await writeFile(join(cwd, 'package.json'), JSON.stringify({ version: '0.1.12-rc.1' }))
  run('check', 'refs/heads/main')
  assert.match(await readFile(output, 'utf8'), /prerelease=true/)
  for (const version of ['../invalid', '0.1.12-rc.01', '01.1.12', '0.1.12\ninvalid', '0.1.12\n']) {
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ version }))
    assert.throws(() => run('check', 'refs/heads/main'), /valid release version/)
  }
})
