import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { GeneratedMediaCard } from '../src/renderer/components/GeneratedMediaCard'
import { downloadFileName } from '../src/shared/policy'
import type { GeneratedImageBlock } from '@/chat/types'
import type { DesktopBridge, RemoteFileData, Result } from '../src/shared/bridge'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const block: GeneratedImageBlock = {
  kind: 'generated-image',
  id: 'm',
  localId: null,
  createdAt: 1000,
  imageId: 'image-1',
  fileName: 'preview.png',
  mimeType: 'image/png',
}
const readFile = vi.fn<DesktopBridge['readFile']>()
const saveFile = vi.fn<DesktopBridge['saveFile']>()
const createObjectURL = vi.fn((_blob: Blob) => 'blob:fixture')
const revokeObjectURL = vi.fn()

beforeEach(() => {
  readFile
    .mockReset()
    .mockResolvedValue({ ok: true, value: { bytes: new Uint8Array([0, 255, 1]), mimeType: 'image/png' } })
  saveFile.mockReset().mockResolvedValue({ ok: true, value: { saved: true } })
  Object.defineProperty(window, 'desktop', { configurable: true, value: { readFile, saveFile } })
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('HAPI media cards', () => {
  it('previews an image and releases its object URL when the card is removed', async () => {
    const view = render(<GeneratedMediaCard sessionId="session-1" block={block} />)
    await screen.findByRole('img', { name: 'preview.png' })
    expect(readFile).toHaveBeenCalledWith({ kind: 'generated', sessionId: 'session-1', imageId: 'image-1' })
    expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob)
    view.unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fixture')
  })

  it('does not retain or display an image that arrives after the card is removed', async () => {
    let resolve!: (result: Result<RemoteFileData>) => void
    readFile.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const view = render(<GeneratedMediaCard sessionId="session-1" block={block} />)
    view.unmount()
    await act(async () => resolve({ ok: true, value: { bytes: new Uint8Array([1]), mimeType: 'image/png' } }))
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('loads video only on request and offers direct file saving without prefetching', async () => {
    const view = render(
      <GeneratedMediaCard sessionId="session-1" block={{ ...block, mimeType: 'video/mp4' }} />,
    )
    expect(readFile).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Load video' }))
    await waitFor(() => expect(view.container.querySelector('video')?.src).toBe('blob:fixture'))
    view.unmount()
    readFile.mockClear()
    render(
      <GeneratedMediaCard
        sessionId="session-2"
        block={{ ...block, imageId: 'file-1', mimeType: 'application/pdf', fileName: 'report.pdf' }}
      />,
    )
    expect(readFile).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Download file' }))
    await screen.findByText('File saved')
    expect(saveFile).toHaveBeenCalledWith({
      source: { kind: 'generated', sessionId: 'session-2', imageId: 'file-1' },
      fileName: 'report.pdf',
    })
  })

  it('shows missing-file errors, supports retry, and does not report cancellation as a save', async () => {
    readFile.mockResolvedValueOnce({
      ok: false,
      error: { message: 'HTTP_404', code: 'HTTP_404', status: 404 },
    })
    render(<GeneratedMediaCard sessionId="session-1" block={block} />)
    expect((await screen.findByRole('alert')).textContent).toContain('File unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByRole('img', { name: 'preview.png' })
    saveFile.mockResolvedValueOnce({ ok: true, value: { saved: false } })
    fireEvent.click(screen.getByRole('button', { name: 'Download file' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Download file' }).hasAttribute('disabled')).toBe(false),
    )
    expect(screen.queryByText('File saved')).toBeNull()
  })

  it('keeps download available when browser playback fails', async () => {
    render(<GeneratedMediaCard sessionId="session-1" block={block} />)
    fireEvent.error(await screen.findByRole('img', { name: 'preview.png' }))
    expect(screen.getByText('Unable to preview this image. Download it to open locally.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Download file' })).toBeTruthy()
  })

  it.each([
    ['../../report.pdf', 'report.pdf'],
    ['C:\\temp\\report.csv', 'report.csv'],
    ['report:stream?.txt', 'report_stream_.txt'],
    ['CON.txt', 'download'],
    ['..', 'download'],
    ['报告.pdf', '报告.pdf'],
  ])('uses a safe download name for %s', (input, expected) => {
    expect(downloadFileName(input)).toBe(expected)
  })
})
