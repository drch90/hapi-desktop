import type { MarkdownOptions } from './markdown-plugins'
import type { MarkdownSection } from './markdown-sections'
import { renderMarkdownSections } from './markdown-preview'

export type MarkdownRequest = MarkdownOptions & { id: number; content: string }
export type MarkdownResult = { id: number } & (
  { sections: MarkdownSection[]; error?: never } | { error: true; sections?: never }
)

// A dedicated worker keeps parsing and KaTeX away from typing and scrolling.
self.onmessage = (event: MessageEvent<MarkdownRequest>) => {
  const { id, content, ...options } = event.data
  try {
    self.postMessage({ id, sections: renderMarkdownSections(content, options) } satisfies MarkdownResult)
  } catch {
    self.postMessage({ id, error: true } satisfies MarkdownResult)
  }
}
