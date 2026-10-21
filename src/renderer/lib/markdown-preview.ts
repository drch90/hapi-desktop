import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import type { Root } from 'hast'
import { getRemarkPlugins, rehypePlugins, type MarkdownOptions } from './markdown-plugins'
import { sectionMarkdown } from './markdown-sections'

export function renderMarkdownSections(content: string, options: MarkdownOptions = {}) {
  const processor = unified()
    .use(remarkParse)
    .use(getRemarkPlugins(options))
    .use(remarkRehype)
    .use(rehypePlugins)
  return sectionMarkdown(processor.runSync(processor.parse(content), content) as Root)
}
