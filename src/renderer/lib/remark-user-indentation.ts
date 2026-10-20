import type { Root } from 'mdast'
import type { VFile } from 'vfile'

/** Pasted, indented user text is literal; explicitly fenced and nested Markdown stays Markdown. */
export function remarkUserIndentation() {
  return (tree: Root, file: VFile) => {
    const source = String(file)
    tree.children = tree.children.map((node) => {
      if (node.type !== 'code') return node
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start === undefined || end === undefined) return node
      const text = source.slice(start, end)
      if (/^ {0,3}(?:`{3,}|~{3,})/.test(text)) return node
      // Recover the source, since Markdown has already removed four spaces
      // from each line of an indented code node. Run after inline transforms
      // so configuration comments, escapes and variables remain literal.
      return {
        type: 'paragraph',
        children: [{ type: 'text', value: text }],
        data: {
          hProperties: { className: ['user-text-literal'] },
          // The normal Markdown text handler trims indentation after newlines.
          hChildren: [{ type: 'text', value: text }],
        },
      }
    })
  }
}
