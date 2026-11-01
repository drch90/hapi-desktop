import type { Root, Nodes } from 'mdast'
import type { ElementContent } from 'hast'
import type { VFile } from 'vfile'

/** User messages are source text. Only links gain behavior; their text stays verbatim. */
export function remarkUserText() {
  return (tree: Root, file: VFile) => {
    const source = String(file)
    const children: ElementContent[] = []
    let offset = 0
    function collectLinks(node: Nodes) {
      if (node.type === 'link') {
        const start = node.position?.start.offset
        const end = node.position?.end.offset
        if (start === undefined || end === undefined || start < offset) return
        if (start > offset) children.push({ type: 'text', value: source.slice(offset, start) })
        children.push({
          type: 'element',
          tagName: 'a',
          properties: { href: node.url, ...(node.title ? { title: node.title } : {}) },
          children: [{ type: 'text', value: source.slice(start, end) }],
        })
        offset = end
      } else if ('children' in node) node.children.forEach(collectLinks)
    }
    collectLinks(tree)
    if (offset < source.length) children.push({ type: 'text', value: source.slice(offset) })
    // Bypass Markdown's whitespace trimming and HTML/inline interpretation,
    // including in the worker used for long messages and expanded reading.
    tree.children = source
      ? [
          {
            type: 'paragraph',
            children: [{ type: 'text', value: source }],
            data: {
              hProperties: { className: ['user-text-literal'] },
              hChildren: children,
            },
          },
        ]
      : []
  }
}
