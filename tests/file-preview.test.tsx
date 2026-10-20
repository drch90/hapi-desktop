import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { FilePreview } from '../src/renderer/components/FilePreview'
import { api } from '../src/renderer/lib/api'
import * as utils from '@/lib/utils'

const { virtualContent } = vi.hoisted(() => ({ virtualContent: vi.fn() }))
vi.mock('../src/renderer/components/VirtualTextContent', () => ({
  VirtualTextContent: (props: unknown) => {
    virtualContent(props)
    return <div data-virtual-text-content />
  },
}))

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/lib/use-translation', () => ({
  useTranslation: () => ({ t: (key: string) => key, locale: 'en' }),
}))
vi.mock('@/hooks/useCopyToClipboard', () => ({
  useCopyToClipboard: () => ({ copied: false, copy: vi.fn() }),
}))
vi.mock('../src/renderer/lib/api', () => ({
  api: { readSessionFile: vi.fn(), getGitDiffFile: vi.fn().mockResolvedValue({ success: true, stdout: '' }) },
  fileErrorKey: () => 'File unavailable',
  unwrap: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const props = {
  sessionId: 'file-preview',
  scope: 'test',
  onBack: () => {},
  onOpenFile: () => {},
  onAddToComposer: () => {},
  onOpenSession: () => {},
}

describe('large file previews', () => {
  it('keeps a large file browsable, decodes it once and releases its cached content on close', async () => {
    const content = 'const line = "文件内容😀";\n'.repeat(100_000) + '// END OF FILE'
    vi.mocked(api.readSessionFile).mockResolvedValue({
      success: true,
      content: Buffer.from(content).toString('base64'),
      size: Buffer.byteLength(content),
    })
    const decode = vi.spyOn(utils, 'decodeBase64')
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { container, unmount } = render(
      <QueryClientProvider client={client}>
        <FilePreview {...props} path="large.ts" />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(container.querySelector('[data-virtual-text-content]')).not.toBeNull())
    expect(container.querySelector('[data-text-pager]')).toBeNull()
    expect(virtualContent).toHaveBeenLastCalledWith(
      expect.objectContaining({ code: content, canCopy: false }),
    )
    expect(decode.mock.calls.filter(([text]) => text.length > 0)).toHaveLength(1)
    expect(container.querySelector('[data-hapi-code-copy]')).toBeNull()
    unmount()
    await waitFor(() =>
      expect(client.getQueryData(['desktop-file', props.sessionId, 'large.ts'])).toBeUndefined(),
    )
    expect(client.getQueryData(['desktop-file-diff', props.sessionId, 'large.ts', undefined])).toBeUndefined()
    client.clear()
  })

  it('does not decode image bytes as text', async () => {
    const content = Buffer.alloc(2_000_000, 42).toString('base64')
    vi.mocked(api.readSessionFile).mockResolvedValue({ success: true, content })
    const decode = vi.spyOn(utils, 'decodeBase64')
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { container } = render(
      <QueryClientProvider client={client}>
        <FilePreview {...props} path="large.png" />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(container.querySelector('img')).not.toBeNull())
    expect(decode.mock.calls.every(([text]) => text === '')).toBe(true)
    client.clear()
  })
})
