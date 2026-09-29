import { createHash } from 'node:crypto'
import { readFile, writeFile, readdir, mkdir, mkdtemp, cp, rm, access } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

const root = resolve('vendor/hapi')
const manifestPath = 'UPSTREAM-FILES.json'
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
async function files(directory) {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...(await files(path)))
    else if (entry.isFile()) result.push(path)
  }
  return result
}

if (process.argv[2] === '--record') {
  const upstream = resolve(process.argv[3])
  const meta = JSON.parse(await readFile('UPSTREAM.json', 'utf8'))
  const actualCommit = execFileSync('git', ['-C', upstream, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  if (actualCommit !== meta.commit) throw new Error('Upstream commit mismatch')
  const upstreamPaths = new Set(
    execFileSync('git', ['-C', upstream, 'ls-tree', '-r', '--name-only', '-z', meta.commit], {
      encoding: 'utf8',
    }).split('\0'),
  )
  const entries = {}
  for (const path of (await files(root)).sort()) {
    const relative = path.slice(root.length + 1)
    entries[relative] = {
      upstream: upstreamPaths.has(relative)
        ? sha256(execFileSync('git', ['-C', upstream, 'show', `${meta.commit}:${relative}`]))
        : null,
      vendored: sha256(await readFile(path)),
    }
  }
  await writeFile(manifestPath, JSON.stringify(entries, null, 2) + '\n')
  console.log(`Recorded ${Object.keys(entries).length} upstream files at ${actualCommit}`)
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const actual = await files(root)
if (actual.length !== Object.keys(manifest).length) throw new Error('Unexpected vendored file count')
const modified = []
for (const [path, hashes] of Object.entries(manifest)) {
  if (sha256(await readFile(join(root, path))) !== hashes.vendored)
    throw new Error(`Vendored source changed without provenance update: ${path}`)
  if (hashes.upstream !== hashes.vendored) modified.push(path)
}
const staging = await mkdtemp(join(tmpdir(), 'hapi-patch-verify-'))
try {
  for (const path of modified) {
    const target = join(staging, 'vendor/hapi', path)
    await mkdir(dirname(target), { recursive: true })
    await cp(join(root, path), target)
  }
  const patch = resolve('patches/hapi-desktop.patch')
  execFileSync('git', ['apply', '--reverse', patch], { cwd: staging })
  for (const path of modified) {
    const restored = join(staging, 'vendor/hapi', path)
    if (manifest[path].upstream === null) {
      // Backported additions must not exist in the pinned baseline.
      const exists = await access(restored).then(
        () => true,
        (error) => {
          if (error.code !== 'ENOENT') throw error
          return false
        },
      )
      if (exists) throw new Error(`Added file survived upstream restoration: ${path}`)
    } else if (sha256(await readFile(restored)) !== manifest[path].upstream)
      throw new Error(`Upstream restoration failed: ${path}`)
  }
  execFileSync('git', ['apply', patch], { cwd: staging })
  for (const path of modified)
    if (sha256(await readFile(join(staging, 'vendor/hapi', path))) !== manifest[path].vendored)
      throw new Error(`Patch reapplication failed: ${path}`)
} finally {
  await rm(staging, { recursive: true, force: true })
}
console.log(
  `Verified ${actual.length} vendored files; ${modified.length} patched files restore and reapply exactly`,
)
