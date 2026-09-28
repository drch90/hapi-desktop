import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Include notices for installed build dependencies as well as bundled code.
// Over-inclusion keeps the shipped notice set conservative and reproducible.
const packages = new Map()
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const path = join(directory, entry.name)
    if (entry.name.startsWith('@')) {
      await collect(path)
      continue
    }
    try {
      const metadata = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'))
      if (!metadata.name || !metadata.version) continue
      const key = `${metadata.name}@${metadata.version}`
      if (packages.has(key)) continue
      const names = (await readdir(path)).filter((name) =>
        /^(license|licence|copying|copyright|notice)(\.|$)/i.test(name),
      )
      const notices = []
      for (const name of names) {
        try {
          notices.push(await readFile(join(path, name), 'utf8'))
        } catch {}
      }
      packages.set(key, {
        license: metadata.license ?? 'See upstream',
        repository:
          typeof metadata.repository === 'string'
            ? metadata.repository
            : (metadata.repository?.url ?? metadata.homepage ?? ''),
        notices,
      })
    } catch {
      /* Non-package directory. */
    }
  }
}
for (const entry of await readdir('node_modules/.bun')) {
  try {
    await collect(join('node_modules/.bun', entry, 'node_modules'))
  } catch {}
}
let text =
  '# Third-party notices\n\nHAPI Desktop is distributed under AGPL-3.0-only. This is an independent desktop client, not an official HAPI release.\n\nHAPI: https://github.com/tiann/hapi (AGPL-3.0), pinned in UPSTREAM.json. HAPI includes work derived from Happy: https://github.com/slopus/happy. Original source notices are retained in vendor/hapi.\n\nElectron and Chromium notices are also distributed with the application as LICENSE.electron.txt and LICENSES.chromium.html. The list below includes development dependencies; listing does not imply every package is present at runtime.\n'
for (const [name, data] of [...packages.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  text += `\n## ${name}\n\nLicense: ${typeof data.license === 'string' ? data.license : JSON.stringify(data.license)}\n\n${data.repository}\n`
  for (const notice of data.notices) text += `\n~~~text\n${notice.trim()}\n~~~\n`
}
await writeFile('THIRD_PARTY_NOTICES.md', text)
console.log(`Wrote notices for ${packages.size} dependency versions`)
