export type SseFrame = { data: string; id?: string }

/** Incremental SSE framing, including CRLF split across chunks and multi-line data. */
export class SseDecoder {
  private buffer = ''
  private data: string[] = []
  private id: string | undefined
  private dataSize = 0

  constructor(private readonly maxFrameBytes = 8 * 1024 * 1024) {}

  push(chunk: string): SseFrame[] {
    this.buffer += chunk
    if (this.buffer.length > this.maxFrameBytes) throw new Error('SSE_FRAME_TOO_LARGE')
    const frames: SseFrame[] = []
    let end: number
    while ((end = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, end).replace(/\r$/, '')
      this.buffer = this.buffer.slice(end + 1)
      if (line === '') {
        if (this.data.length)
          frames.push({ data: this.data.join('\n'), ...(this.id !== undefined ? { id: this.id } : {}) })
        this.data = []
        this.dataSize = 0
        this.id = undefined
      } else if (!line.startsWith(':')) {
        const separator = line.indexOf(':')
        const field = separator < 0 ? line : line.slice(0, separator)
        const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '')
        if (field === 'data') {
          this.data.push(value)
          this.dataSize += value.length
        }
        if (field === 'id' && !value.includes('\0')) this.id = value
        if (this.dataSize > this.maxFrameBytes) throw new Error('SSE_FRAME_TOO_LARGE')
      }
    }
    return frames
  }
}
