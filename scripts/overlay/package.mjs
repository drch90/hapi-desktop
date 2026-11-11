import assert from 'node:assert/strict'
import { constants } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanupBuilds, hashFile, info } from '../cleanup-builds.mjs'
import {
  asar,
  assertCompatible,
  digest,
  extractArchive,
  fileHashes,
  inheritedExecutables,
  runtimeState,
  sevenZip,
  verifiedArchive,
} from './artifacts.mjs'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))

function instructions(manifest) {
  return `HAPI Desktop ${manifest.fromVersion} → ${manifest.version} 轻量覆盖升级

适用于 Windows 10/11 x64 的兼容安装；脚本会核对程序和资源摘要。
1. 从系统托盘退出 HAPI Desktop，保留本解压目录的所有文件。
2. 双击 update.cmd。脚本会寻找安装目录；未找到或存在多个安装时，请选择已安装的 HAPI Desktop.exe。
3. 看到 Completed 后重新启动 HAPI Desktop，应用内版本应为 ${manifest.version}。
安装在 Program Files 等受保护目录时，可能需要右键“以管理员身份运行”。

脚本先备份 resources/app.asar，再校验并原子替换。连接、标签、草稿等用户数据不在修改范围内。
回退：再次从托盘退出，双击本目录的 restore.cmd；保留安装目录中的 app.asar.backup-* 文件。
基线或文件摘要不匹配时不会覆盖，请使用对应版本的完整安装包。请勿强行更改 manifest.json。
此包仅更新应用资源，Windows“已安装的应用”及 exe 文件属性中的版本仍沿用基础安装包；应用内显示新版本。

高级用法：powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\Update.ps1 -InstallDir "D:\\HAPI Desktop"
回退在同一命令末尾加 -Restore。

本包资源对应已验证的 ${manifest.version} 完整安装包；不需要 Node.js、Bun 或联网。
Windows 实机覆盖安装尚未验证；已完成包内容、兼容条件及脚本升级/回退验证。
源代码与许可：https://github.com/drch90/hapi-desktop （AGPL-3.0-only；本包保留包内来源声明）
`
}

export async function packageOverlay({ root = '.', fromVersion }) {
  root = resolve(root)
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const target = await verifiedArchive(root, version)
  const base = await verifiedArchive(root, fromVersion)
  const reportPath = join(target.folder, 'overlay-verification.json')
  assert.ok(!(await info(reportPath)), 'Overlay evidence already exists; use a new version')
  const source = JSON.parse(await readFile(join(target.folder, 'source-snapshot.json'), 'utf8'))
  for (const [file, expected] of Object.entries(source))
    assert.equal(await hashFile(join(root, file)), expected, `Packaging input changed: ${file}`)
  const outputs = JSON.parse(await readFile(join(target.folder, 'tested-build-sha256.json'), 'utf8'))
  const current = await fileHashes(join(root, 'out'))
  assert.deepEqual(
    current,
    Object.fromEntries(Object.entries(outputs).map(([path, hash]) => [path.slice(4), hash])),
    'Tested build changed after installer verification',
  )

  const work = await mkdtemp(join(target.folder, 'overlay-build-'))
  const log = join(target.folder, 'overlay-verification.log')
  // Extraction stays available on failure; only a verified package is archived.
  const oldApp = await extractArchive(base, join(work, 'base'), log)
  const newApp = await extractArchive(target, join(work, 'target'), log)
  const baseState = await runtimeState(oldApp)
  const targetState = await runtimeState(newApp)
  assertCompatible(baseState, targetState, fromVersion, version)
  const packedAsar = join(newApp, 'resources', 'app.asar')
  const basePackage = JSON.parse(
    asar.extractFile(join(oldApp, 'resources', 'app.asar'), 'package.json').toString(),
  )
  const targetPackage = JSON.parse(asar.extractFile(packedAsar, 'package.json').toString())
  assert.equal(targetPackage.version, version)
  assert.equal(basePackage.version, fromVersion)
  for (const key of ['name', 'productName'])
    assert.equal(targetPackage[key], basePackage[key], 'Application identity changed; use a full installer')
  for (const [file, expected] of Object.entries(outputs))
    assert.equal(
      digest(asar.extractFile(packedAsar, file)),
      expected,
      `Overlay differs from tested build: ${file}`,
    )

  const manifest = {
    format: 1,
    product: 'HAPI Desktop',
    platform: 'win32-x64',
    fromVersion,
    version,
    runtimeVersion: targetState.runtimeVersion,
    baseAsarSha256: base.report.appAsarSha256,
    targetAsarSha256: target.report.appAsarSha256,
    allowedExecutableSha256: [
      ...new Set([...(await inheritedExecutables(base)), target.report.executableSha256]),
    ],
  }
  const payload = join(work, 'payload')
  await mkdir(join(payload, 'resources'), { recursive: true })
  await copyFile(packedAsar, join(payload, 'resources', 'app.asar'), constants.COPYFILE_EXCL)
  for (const name of ['Update.ps1', 'update.cmd', 'restore.cmd']) {
    const content = await readFile(join(scriptDirectory, name), 'utf8')
    await writeFile(join(payload, name), content.replace(/\r?\n/g, '\r\n'), { flag: 'wx' })
  }
  const manifestBytes = JSON.stringify(manifest, null, 2) + '\n'
  await writeFile(join(payload, 'manifest.json'), manifestBytes, { flag: 'wx' })
  await writeFile(join(payload, 'README.txt'), '\uFEFF' + instructions(manifest).replace(/\n/g, '\r\n'), {
    flag: 'wx',
  })
  const name = `HAPI-Desktop-${fromVersion}-to-${version}-win-x64-overlay.zip`
  const candidate = join(work, name)
  await sevenZip(['a', '-tzip', '-mx=9', '-mmt=2', candidate, '.'], log, payload)
  await sevenZip(['t', candidate], log)
  const unpacked = join(work, 'check')
  await sevenZip(['x', '-y', candidate, `-o${unpacked}`], log)
  assert.deepEqual(await fileHashes(unpacked), await fileHashes(payload), 'Overlay zip contents changed')
  const sha256 = await hashFile(candidate)
  const report = {
    status: 'verified',
    version,
    fromVersion,
    name,
    sha256,
    bytes: (await stat(candidate)).size,
    manifestSha256: digest(manifestBytes),
    baseAsarSha256: manifest.baseAsarSha256,
    targetAsarSha256: manifest.targetAsarSha256,
    runtimeVersion: manifest.runtimeVersion,
    runtimeCompatibilitySha256: digest(JSON.stringify(targetState)),
    baseInstallerSha256: base.report.installerSha256,
    targetInstallerSha256: target.report.installerSha256,
    checkedOutputFiles: Object.keys(outputs).length,
    windowsInstallationTested: false,
    completedAt: new Date().toISOString(),
  }
  const destination = join(target.folder, name)
  await copyFile(candidate, destination, constants.COPYFILE_EXCL)
  assert.equal(await hashFile(destination), sha256)
  await writeFile(join(target.folder, 'overlay-manifest.json'), manifestBytes, { flag: 'wx' })
  await writeFile(join(target.folder, 'OVERLAY-SHA256SUMS.txt'), `${sha256}  ${name}\n`, { flag: 'wx' })
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  await rm(work, { recursive: true })
  return { ...report, path: destination, cleanup: await cleanupBuilds({ root, apply: true }) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(
    process.argv.length === 4 && process.argv[2] === '--from',
    'Usage: package.mjs --from <verified base version>',
  )
  console.log(JSON.stringify(await packageOverlay({ fromVersion: process.argv[3] }), null, 2))
}
