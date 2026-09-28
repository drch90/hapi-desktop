import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopBridge, DesktopEvent } from '../shared/bridge'

const desktop: DesktopBridge = {
  bootstrap: () => ipcRenderer.invoke('desktop:bootstrap'),
  connect: (input) => ipcRenderer.invoke('desktop:connect', input),
  disconnect: () => ipcRenderer.invoke('desktop:disconnect'),
  request: (input) => ipcRenderer.invoke('desktop:request', input),
  updateSettings: (input) => ipcRenderer.invoke('desktop:settings', input),
  setVisibleSessions: (input) => ipcRenderer.invoke('desktop:visible', input),
  openExternal: (url) => ipcRenderer.invoke('desktop:external', url),
  exportImage: (input) => ipcRenderer.invoke('desktop:export-image', input),
  onEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: DesktopEvent) => listener(payload)
    ipcRenderer.on('desktop:event', handler)
    return () => ipcRenderer.removeListener('desktop:event', handler)
  },
}
contextBridge.exposeInMainWorld('desktop', Object.freeze(desktop))
