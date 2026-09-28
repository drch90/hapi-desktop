import { createRequire } from 'node:module'
import { basename, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const builderRequire = createRequire(require.resolve('electron-builder'))
const { build, Platform, Arch } = require('electron-builder')
const { version: appVersion } = require('../package.json')

if (process.platform === 'linux') {
  // The official reader also extracts NSIS uninstallers on Linux, avoiding
  // running a Windows stub with a Wine version incompatible with host glibc.
  const version = require('electron-builder/package.json').version
  if (version !== '26.15.3')
    throw new Error('Review NSIS reader integration before upgrading electron-builder')
  const { WineVmManager } = builderRequire('app-builder-lib/out/vm/WineVm')
  const { UninstallerReader } = builderRequire('app-builder-lib/out/targets/nsis/nsisUtil')
  const original = WineVmManager.prototype.exec
  WineVmManager.prototype.exec = function (file, args, options, log) {
    if (
      resolve(file) === resolve(`build/HAPI-Desktop-${appVersion}-win-x64-setup.exe`) &&
      (!args || args.length === 0)
    ) {
      console.log(`Extracting ${basename(file)} uninstaller using electron-builder's NSIS reader`)
      return UninstallerReader.exec(file, file.replace(/exe$/, '__uninstaller.exe')).then(() => '')
    }
    return original.call(this, file, args, options, log)
  }
}

await build({
  targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64),
  publish: 'never',
  ...(process.env.HAPI_ELECTRON_DIST ? { config: { electronDist: process.env.HAPI_ELECTRON_DIST } } : {}),
})
