import fs from 'node:fs/promises'
const directory = 'src/renderer/i18n/locales'
const base = JSON.parse(await fs.readFile(`${directory}/en.json`, 'utf8')).translation
for (const locale of ['en', 'zh', 'zh-TW', 'fr', 'ja', 'ru', 'vi']) {
  const file = `${directory}/${locale}.json`
  const data = JSON.parse(await fs.readFile(file, 'utf8'))
  const missing = Object.keys(base).filter((key) => !data.translation[key])
  if (missing.length) throw new Error(`${locale}: missing ${missing.join(', ')}`)
  data.translation = Object.fromEntries(
    Object.entries(data.translation).sort(([a], [b]) => a.localeCompare(b)),
  )
  await fs.writeFile(file, JSON.stringify(data, null, 2) + '\n')
  console.log(`${locale}: ${Object.keys(data.translation).length} keys, no missing translations`)
}
