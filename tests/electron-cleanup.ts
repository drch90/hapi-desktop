import type { ElectronApplication } from '@playwright/test'

export async function closeTestElectron(application?: ElectronApplication): Promise<void> {
  if (!application) return
  const child = application.process()
  let forced = false
  // A stalled Chromium shutdown must not keep a finished fixture or worker alive.
  // Only terminate the child launched by this test, after allowing a normal quit.
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      forced = true
      child.kill('SIGKILL')
    }
  }, 10_000)
  timer.unref()
  try {
    await application.close()
  } catch (error) {
    if (!forced) throw error
  } finally {
    clearTimeout(timer)
  }
}
