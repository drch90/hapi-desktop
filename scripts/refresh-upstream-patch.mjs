import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

// Regenerate derived hashes and the patch after reviewed edits/imports. Read
// baseline bytes from the pinned commit, even when the source checkout is dirty.
// UPSTREAM.json backport attribution must be recorded separately by the caller.
assert.ok(process.argv[2], 'Usage: node scripts/refresh-upstream-patch.mjs <HAPI source repository>')
const source = resolve(process.argv[2])
const metadata = JSON.parse(await readFile('UPSTREAM.json', 'utf8'))
const previous = JSON.parse(await readFile('UPSTREAM-FILES.json', 'utf8'))
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const sourcePaths = new Set(
  execFileSync('git', ['-C', source, 'ls-tree', '-r', '--name-only', '-z', metadata.commit], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  }).split('\0'),
)

async function files(directory, prefix = '') {
  const paths = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const relative = prefix + entry.name
    if (entry.isDirectory()) paths.push(...(await files(join(directory, entry.name), `${relative}/`)))
    else if (entry.isFile()) paths.push(relative)
    else throw new Error(`Unsupported vendored entry: ${relative}`)
  }
  return paths.sort()
}

const paths = await files('vendor/hapi')
const currentPaths = new Set(paths)
for (const path of Object.keys(previous)) {
  assert.ok(currentPaths.has(path), `Vendored deletion needs explicit provenance support: ${path}`)
}
const staging = await mkdtemp(join(tmpdir(), 'hapi-patch-refresh-'))
const manifest = {}
const modified = new Map()
function git(args, input) {
  return execFileSync('git', ['-c', 'core.autocrlf=false', ...args], {
    cwd: staging,
    input,
    maxBuffer: 32 * 1024 * 1024,
  })
}

try {
  git(['init', '--quiet'])
  for (const path of paths) {
    const current = await readFile(join('vendor/hapi', path))
    const vendored = sha256(current)
    const original = sourcePaths.has(path)
      ? execFileSync('git', ['-C', source, 'show', `${metadata.commit}:${path}`], {
          maxBuffer: 16 * 1024 * 1024,
        })
      : null
    const upstream = original === null ? null : sha256(original)
    if (previous[path]) assert.equal(upstream, previous[path].upstream, `Pinned source mismatch: ${path}`)
    manifest[path] = { upstream, vendored }
    if (upstream === vendored) continue
    const target = join(staging, 'vendor/hapi', path)
    await mkdir(dirname(target), { recursive: true })
    if (original !== null) await writeFile(target, original)
    modified.set(path, current)
  }
  git(['add', '--all'])
  for (const [path, current] of modified) await writeFile(join(staging, 'vendor/hapi', path), current)
  git(['add', '--intent-to-add', '.'])
  const patch = git([
    'diff',
    '--binary',
    '--full-index',
    '--no-ext-diff',
    '--no-color',
    '--no-renames',
    '--',
    'vendor/hapi',
  ])
  git(['apply', '--reverse', '--whitespace=nowarn', '-'], patch)
  for (const path of modified.keys()) {
    const target = join(staging, 'vendor/hapi', path)
    if (manifest[path].upstream === null) {
      await assert.rejects(access(target), { code: 'ENOENT' })
    } else {
      assert.equal(sha256(await readFile(target)), manifest[path].upstream, `Restoration failed: ${path}`)
    }
  }
  git(['apply', '--whitespace=nowarn', '-'], patch)
  for (const path of modified.keys()) {
    assert.equal(
      sha256(await readFile(join(staging, 'vendor/hapi', path))),
      manifest[path].vendored,
      `Replay failed: ${path}`,
    )
  }
  await writeFile('UPSTREAM-FILES.json', JSON.stringify(manifest, null, 2) + '\n')
  await writeFile('patches/hapi-desktop.patch', patch)
  console.log(
    `Recorded ${paths.length} vendored files and ${modified.size} patches against ${metadata.commit}`,
  )
} finally {
  await rm(staging, { recursive: true, force: true })
}
