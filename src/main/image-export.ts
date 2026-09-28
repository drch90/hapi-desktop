import { z } from 'zod'

export const imageExportSchema = z
  .object({
    action: z.enum(['copy', 'save']),
    fileName: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[^<>:"/\\|?*\x00-\x1f]+\.png$/i),
    png: z
      .string()
      .max(24 * 1024 * 1024)
      .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict()

export function decodeExportPng(data: string): Buffer {
  const png = Buffer.from(data.slice('data:image/png;base64,'.length), 'base64')
  if (
    png.length < 33 ||
    !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    png.toString('ascii', 12, 16) !== 'IHDR'
  )
    throw new Error('INVALID_IMAGE')
  const width = png.readUInt32BE(16),
    height = png.readUInt32BE(20)
  if (!width || !height || width > 24_000 || height > 24_000 || width * height > 24_000_000)
    throw new Error('IMAGE_TOO_LARGE')
  return png
}
