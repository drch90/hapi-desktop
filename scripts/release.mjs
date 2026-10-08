import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { appendFile, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const command = process.argv[2]
if (!['check', 'prepare'].includes(command)) throw new Error('Usage: node scripts/release.mjs check|prepare')

const { version } = JSON.parse(await readFile('package.json', 'utf8'))
const match =
  typeof version === 'string' &&
  version.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/)
if (
  !match ||
  match[0] !== version ||
  match[4]?.split('.').some((part) => /^\d+$/.test(part) && /^0\d/.test(part))
)
  throw new Error('package.json must contain a valid release version (for example 0.1.11 or 0.1.12-rc.1)')

const tag = `v${version}`
const ref = process.env.GITHUB_REF ?? ''
if (ref.startsWith('refs/tags/') && ref !== `refs/tags/${tag}`)
  throw new Error(`Release tag ${ref.slice('refs/tags/'.length)} does not match package.json (${tag})`)

const notesPath = join('docs', 'release-notes', `${tag}.md`)
const isTag = ref.startsWith('refs/tags/')
let notes
try {
  notes = await readFile(notesPath, 'utf8')
} catch (error) {
  if (error.code !== 'ENOENT' || isTag) throw error
  notes = `# HAPI Desktop ${version}\n\nDevelopment build. See the README for features and installation instructions.\n`
}
if (!notes.trim()) throw new Error(`Release notes are empty: ${notesPath}`)

if (command === 'prepare') {
  const installer = `HAPI-Desktop-${version}-win-x64-setup.exe`
  await mkdir('release', { recursive: true })
  const target = join('release', installer)
  await copyFile(join('build', installer), target)
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(target)) hash.update(chunk)
  await writeFile(join('release', 'SHA256SUMS.txt'), `${hash.digest('hex')}  ${installer}\n`)
  await writeFile(join('release', 'RELEASE_NOTES.md'), notes)
  console.log(`Prepared ${target} and SHA256SUMS.txt`)
}

const metadata = `version=${version}\ntag=${tag}\nprerelease=${Boolean(match[4])}\n`
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, metadata)
console.log(metadata.trim())
