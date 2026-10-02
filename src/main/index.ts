import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  net,
  Notification,
  powerMonitor,
  protocol,
  session,
  shell,
  Tray,
} from 'electron'
import { existsSync } from 'node:fs'
import { writeFile, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { HubConnection, HubError } from './hub'
import { DesktopStorage } from './storage'
import { NotificationTracker } from './notifications'
import {
  connectSchema,
  normalizeHubUrl,
  settingsUpdateSchema,
  remoteFileSchema,
  saveFileSchema,
  downloadFileName,
} from '../shared/policy'
import type { DesktopEvent, Result } from '../shared/bridge'
import { translate } from '../shared/i18n'
import { decodeExportPng, imageExportSchema } from './image-export'
import { version as developmentVersion } from '../../package.json'

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])
const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) app.quit()
app.setAppUserModelId('run.hapi.desktop')

let window: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let storage: DesktopStorage
let connectBusy = false
let restoreGeneration = 0
let visibleSessions = new Set<string>()
const tracker = new NotificationTracker()
const notifications = new Set<Notification>()
const hub = new HubConnection(handleEvent)
let priming = false

function handleEvent(event: DesktopEvent) {
  if (event.type === 'resync' && !priming) {
    priming = true
    const lifetime = hub.signal
    void hub
      .request({ path: '/api/sessions', method: 'GET' })
      .then((value) => {
        if (lifetime.aborted) return
        tracker.prime(value)
        updateTray()
      })
      .catch(() => {})
      .finally(() => {
        priming = false
      })
  }
  if (
    event.type === 'connection' &&
    ['connecting', 'disconnected', 'authentication-required'].includes(event.state.status)
  ) {
    for (const notification of notifications) notification.close()
    notifications.clear()
    visibleSessions.clear()
    tracker.reset()
  }
  if (window && !window.isDestroyed()) window.webContents.send('desktop:event', event)
  if (event.type === 'sync') {
    for (const notice of tracker.handle(event.event, event.replay)) {
      if (!storage?.settings.notifications) continue
      const foreground = Boolean(window?.isFocused() && window.isVisible() && !window.isMinimized())
      if (foreground && visibleSessions.has(notice.sessionId)) continue
      const scope = `${hub.state.hubUrl}:${hub.state.profile ?? ''}`
      const attention = notice.kind === 'Approval needed' || notice.kind === 'Reply needed'
      const title = translate(storage.settings.locale, notice.kind)
      const body = notice.title.slice(0, 150)
      if (foreground) {
        handleEvent({
          type: 'notification',
          id: randomUUID(),
          scope,
          sessionId: notice.sessionId,
          title,
          body,
          attention,
        })
        continue
      }
      if (!Notification.isSupported()) continue
      const lifetime = hub.signal
      const notification = new Notification({ title, body, icon: iconPath() })
      notifications.add(notification)
      notification.once('click', () => {
        if (lifetime.aborted || scope !== `${hub.state.hubUrl}:${hub.state.profile ?? ''}`) return
        showWindow()
        handleEvent({ type: 'open-session', sessionId: notice.sessionId, scope, attention })
      })
      notification.once('close', () => notifications.delete(notification))
      notification.once('failed', () => notifications.delete(notification))
      notification.show()
    }
  }
  if (event.type === 'connection' || event.type === 'sync') updateTray()
}

function iconPath() {
  return app.isPackaged ? join(process.resourcesPath, 'resources/icon.png') : resolve('resources/icon.png')
}

function updateTray() {
  if (!tray || !storage) return
  const t = (key: string) => translate(storage.settings.locale, key)
  const status = t(hub.state.status)
  tray.setToolTip(`HAPI Desktop · ${status} · ${tracker.pendingCount} ${t('Pending')}`)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'HAPI Desktop', enabled: false },
      { label: `${status} · ${tracker.pendingCount} ${t('Pending')}`, enabled: false },
      { type: 'separator' },
      { label: t('Open window'), click: showWindow },
      {
        label: t('Notifications'),
        type: 'checkbox',
        checked: storage.settings.notifications,
        click: (item) => {
          storage.saveSettings({ ...storage.settings, notifications: item.checked })
          handleEvent({ type: 'settings', settings: storage.settings })
          updateTray()
        },
      },
      { type: 'separator' },
      {
        label: t('Quit'),
        click: () => {
          quitting = true
          app.quit()
        },
      },
    ]),
  )
}

function showWindow() {
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  hub.wake()
}

function registerIpc() {
  const handle = (channel: string, handler: (input: unknown) => unknown | Promise<unknown>) => {
    ipcMain.handle(`desktop:${channel}`, async (event, input): Promise<Result<unknown>> => {
      const expected = process.env.ELECTRON_RENDERER_URL
        ? new URL(process.env.ELECTRON_RENDERER_URL).origin
        : 'app://desktop'
      const source = event.senderFrame?.url ?? ''
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== event.sender.mainFrame ||
        !(source === `${expected}/` || source.startsWith(`${expected}/`))
      ) {
        return { ok: false, error: { message: 'UNTRUSTED_SENDER' } }
      }
      try {
        return { ok: true, value: await handler(input) }
      } catch (error) {
        const message =
          error instanceof HubError
            ? error.code
            : error instanceof Error && /^[A-Z_]+$/.test(error.message)
              ? error.message
              : 'ACTION_FAILED'
        return {
          ok: false,
          error: {
            message,
            ...(error instanceof HubError ? { status: error.status, code: error.code } : {}),
          },
        }
      }
    })
  }
  handle('bootstrap', () => ({
    settings: storage.settings,
    connection: hub.state,
    canRemember: storage.canRemember,
    version: app.isPackaged ? app.getVersion() : developmentVersion,
    platform: process.platform,
  }))
  handle('export-image', async (input) => {
    const data = imageExportSchema.parse(input)
    const png = decodeExportPng(data.png)
    const image = nativeImage.createFromBuffer(png)
    if (image.isEmpty()) throw new Error('INVALID_IMAGE')
    if (data.action === 'copy') {
      clipboard.writeImage(image)
      return
    }
    const result = await dialog.showSaveDialog(window!, {
      defaultPath: data.fileName,
      filters: [{ name: 'PNG', extensions: ['png'] }],
    })
    if (!result.canceled && result.filePath) await writeFile(result.filePath, png)
  })
  handle('connect', async (input) => {
    const data = connectSchema.parse(input)
    if (connectBusy) throw new Error('CONNECT_IN_PROGRESS')
    if (data.remember && !storage.canRemember) throw new Error('SECURE_STORAGE_UNAVAILABLE')
    restoreGeneration++
    connectBusy = true
    tracker.reset()
    try {
      const hubUrl = normalizeHubUrl(data.hubUrl)
      await hub.connect(hubUrl, data.accessToken)
      if (data.remember) storage.saveCredential(hubUrl, data.accessToken)
      else storage.clearCredential()
      storage.saveSettings({ ...storage.settings, hubUrl })
      handleEvent({ type: 'settings', settings: storage.settings })
    } finally {
      connectBusy = false
    }
  })
  handle('disconnect', async () => {
    restoreGeneration++
    hub.disconnect()
    tracker.reset()
    visibleSessions.clear()
    storage.clearCredential()
    for (const notification of notifications) notification.close()
    notifications.clear()
    await session.defaultSession.clearStorageData()
    updateTray()
  })
  handle('request', (input) => hub.request(input as never))
  handle('read-file', (input) => hub.readFile(remoteFileSchema.parse(input)))
  handle('save-file', async (input) => {
    const data = saveFileSchema.parse(input)
    const lifetime = hub.signal
    const result = await dialog.showSaveDialog(window!, {
      title: translate(storage.settings.locale, 'Save file'),
      defaultPath: downloadFileName(data.fileName),
    })
    if (result.canceled || !result.filePath) return { saved: false }
    if (lifetime.aborted) throw new HubError('CONNECTION_CHANGED')
    const file = await hub.readFile(data.source)
    if (lifetime.aborted) throw new HubError('CONNECTION_CHANGED')
    const staging = join(dirname(result.filePath), `.hapi-download-${randomUUID()}.tmp`)
    try {
      await writeFile(staging, file.bytes, { flag: 'wx', mode: 0o600 })
      if (lifetime.aborted) throw new HubError('CONNECTION_CHANGED')
      await rename(staging, result.filePath)
    } catch (error) {
      if (error instanceof HubError) throw error
      throw new HubError('FILE_SAVE_FAILED')
    } finally {
      await rm(staging, { force: true }).catch(() => {})
    }
    return { saved: true }
  })
  handle('settings', (input) => {
    const settings = { ...storage.settings, ...settingsUpdateSchema.parse(input) }
    if (settings.launchAtLogin !== storage.settings.launchAtLogin) {
      if (process.platform === 'win32') app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin })
      else if (settings.launchAtLogin) throw new Error('WINDOWS_ONLY')
    }
    storage.saveSettings(settings)
    handleEvent({ type: 'settings', settings })
    updateTray()
    return settings
  })
  handle('visible', (input) => {
    visibleSessions = new Set(z.array(z.string().max(256)).max(2).parse(input))
  })
  handle('external', async (input) => {
    const url = new URL(z.string().max(4096).parse(input))
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
      throw new Error('URL_NOT_ALLOWED')
    await shell.openExternal(url.href)
  })
}

async function restoreConnection() {
  const credential = storage.readCredential()
  if (!credential) return
  const generation = ++restoreGeneration
  while (generation === restoreGeneration) {
    try {
      await hub.connect(credential.hubUrl, credential.accessToken)
      return
    } catch (error) {
      if (error instanceof HubError && (error.status === 401 || error.code === 'INCOMPATIBLE_PROTOCOL'))
        return
      await new Promise((resolve) => setTimeout(resolve, 15_000))
    }
  }
}

app.on('second-instance', showWindow)
app.on('before-quit', () => {
  quitting = true
  restoreGeneration++
  hub.disconnect()
})
app.on('window-all-closed', () => {
  if (quitting) app.quit()
})

if (singleInstance)
  void app.whenReady().then(async () => {
    storage = new DesktopStorage(app.getPath('userData'))
    registerIpc()
    const rendererDirectory = resolve(__dirname, '../renderer')
    protocol.handle('app', async (request) => {
      const url = new URL(request.url)
      if (url.hostname !== 'desktop') return new Response('', { status: 403 })
      const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
      const path = resolve(rendererDirectory, `.${relative}`)
      if (!path.startsWith(`${rendererDirectory}${sep}`) || !existsSync(path))
        return new Response('', { status: 404 })
      const response = await net.fetch(pathToFileURL(path).href)
      const headers = new Headers(response.headers)
      headers.set(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src blob:; font-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'",
      )
      return new Response(response.body, { status: response.status, headers })
    })
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) =>
      callback(contents === window?.webContents && permission === 'clipboard-sanitized-write'),
    )
    session.defaultSession.setPermissionCheckHandler(
      (contents, permission) =>
        contents === window?.webContents && permission === 'clipboard-sanitized-write',
    )
    window = new BrowserWindow({
      width: 1480,
      height: 940,
      minWidth: 920,
      minHeight: 640,
      show: false,
      title: 'HAPI Desktop',
      icon: iconPath(),
      backgroundColor: '#101116',
      webPreferences: {
        preload: join(__dirname, '../preload/index.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: false,
      },
    })
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: translate(storage.settings.locale, 'Edit'),
          submenu: [
            { role: 'undo' },
            { role: 'redo' },
            { type: 'separator' },
            { role: 'cut' },
            { role: 'copy' },
            { role: 'paste' },
            { role: 'selectAll' },
          ],
        },
        {
          label: translate(storage.settings.locale, 'View'),
          submenu: [
            { role: 'resetZoom' },
            { role: 'zoomIn' },
            { role: 'zoomOut' },
            { role: 'togglefullscreen' },
          ],
        },
      ]),
    )
    window.setAutoHideMenuBar(true)
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.on('close', (event) => {
      if (!quitting && tray) {
        event.preventDefault()
        window?.hide()
      } else {
        quitting = true
        app.quit()
      }
    })
    window.on('show', () => hub.setVisible(true))
    window.on('hide', () => hub.setVisible(false))
    window.on('focus', () => hub.wake())
    window.once('ready-to-show', () => window?.show())
    window.webContents.on('render-process-gone', () => {
      visibleSessions.clear()
      window?.reload()
    })
    powerMonitor.on('resume', () => hub.wake())
    try {
      tray = new Tray(nativeImage.createFromPath(iconPath()).resize({ width: 20, height: 20 }))
      tray.on('click', showWindow)
      updateTray()
    } catch {
      /* Linux test sessions may not expose a system tray host. */
    }
    if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(process.env.ELECTRON_RENDERER_URL)
    else await window.loadURL('app://desktop/index.html')
    void restoreConnection()
  })
