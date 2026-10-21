import type { Element, Root, RootContent } from 'hast'

export type MarkdownSection = { tree: Root; ids: string[]; estimate: number }
type Weight = { chars: number; nodes: number; rows: number }
type Piece = { node: RootContent; weight: Weight }
const MAX_CHARS = 8_000
const MAX_NODES = 500
const MAX_ROWS = 32
const emptyWeight = (): Weight => ({ chars: 0, nodes: 0, rows: 0 })
const add = (a: Weight, b: Weight): Weight => ({
  chars: a.chars + b.chars,
  nodes: a.nodes + b.nodes,
  rows: a.rows + b.rows,
})
const fits = (weight: Weight) =>
  weight.chars <= MAX_CHARS && weight.nodes <= MAX_NODES && weight.rows <= MAX_ROWS

/** Split the parsed tree, so fences, reference links, math and footnotes keep their meaning. */
export function sectionMarkdown(tree: Root): MarkdownSection[] {
  const weights = new WeakMap<RootContent, Weight>()
  function measure(node: RootContent): Weight {
    delete node.position
    let weight: Weight = { chars: 0, nodes: 1, rows: 0 }
    if (node.type === 'text') weight.chars = node.value.length
    if (node.type === 'element') {
      for (const child of node.children) weight = add(weight, measure(child))
      if (/^(p|h[1-6]|li|tr|blockquote|hr)$/.test(node.tagName)) weight.rows++
      // CodeBlock supplies its own virtual text view for a large fence.
      if (node.tagName === 'pre') weight = { chars: 0, nodes: 1, rows: 18 }
    }
    weights.set(node, weight)
    return weight
  }
  tree.children.forEach(measure)

  function* split(node: RootContent): Generator<Piece> {
    const weight = weights.get(node)!
    if (
      fits(weight) ||
      (node.type === 'element' &&
        (['pre', 'tr'].includes(node.tagName) || node.properties.className?.toString().includes('katex')))
    ) {
      yield { node, weight }
      return
    }
    if (node.type === 'text') {
      for (let start = 0; start < node.value.length;) {
        let end = Math.min(start + MAX_CHARS, node.value.length)
        // Never split a Unicode pair or a Windows newline.
        const last = node.value.charCodeAt(end - 1)
        if (end < node.value.length && ((last >= 0xd800 && last <= 0xdbff) || last === 13)) end--
        const value = node.value.slice(start, end)
        yield { node: { type: 'text', value }, weight: { chars: value.length, nodes: 1, rows: 0 } }
        start = end
      }
      return
    }
    if (node.type !== 'element') return

    // Repeat a table's column headings when a very long table spans sections.
    const heading =
      node.tagName === 'table'
        ? node.children.find(
            (child): child is Element => child.type === 'element' && child.tagName === 'thead',
          )
        : undefined
    const children = heading ? node.children.filter((child) => child !== heading) : node.children
    function withoutIds(element: Element): Element {
      const properties = { ...element.properties }
      delete properties.id
      return {
        ...element,
        properties,
        children: element.children.map((child) => (child.type === 'element' ? withoutIds(child) : child)),
      }
    }
    const repeatedHeading = heading ? withoutIds(heading) : undefined
    let group: Element['children'] = []
    let groupWeight = emptyWeight()
    let first = true
    let listNumber = Number(node.properties.start ?? 1) - 1
    const flush = (): Piece => {
      const properties = { ...node.properties }
      if (!first) {
        delete properties.id
        if (node.tagName === 'li') properties.style = 'list-style-type: none'
      }
      if (node.tagName === 'ol')
        properties.start = Number(
          group.find((child): child is Element => child.type === 'element' && child.tagName === 'li')
            ?.properties.value ??
            node.properties.start ??
            1,
        )
      const piece: Piece = {
        node: {
          type: 'element',
          tagName: node.tagName,
          properties,
          children: heading ? [first ? heading : repeatedHeading!, ...group] : group,
        },
        weight: groupWeight,
      }
      first = false
      group = []
      groupWeight = emptyWeight()
      return piece
    }
    for (const child of children) {
      const numbered = node.tagName === 'ol' && child.type === 'element' && child.tagName === 'li'
      if (numbered) listNumber++
      for (const piece of split(child)) {
        if (group.length && !fits(add(groupWeight, piece.weight))) yield flush()
        // A single long list item may span sections. Giving its fragments
        // the same value keeps the following item's number correct.
        group.push(
          numbered && piece.node.type === 'element'
            ? { ...piece.node, properties: { ...piece.node.properties, value: String(listNumber) } }
            : (piece.node as Element['children'][number]),
        )
        groupWeight = add(groupWeight, piece.weight)
      }
    }
    if (group.length) yield flush()
  }

  const sections: MarkdownSection[] = []
  let children: RootContent[] = []
  let weight = emptyWeight()
  function flush() {
    const ids: string[] = []
    function collect(node: RootContent) {
      if (node.type !== 'element') return
      if (typeof node.properties.id === 'string') ids.push(node.properties.id)
      node.children.forEach(collect)
    }
    children.forEach(collect)
    sections.push({
      tree: { type: 'root', children },
      ids,
      estimate: Math.max(48, weight.rows * 30, Math.ceil(weight.chars / 85) * 25),
    })
    children = []
    weight = emptyWeight()
  }
  for (const child of tree.children) {
    // Whitespace between blocks does not need a virtual row of its own.
    if (child.type === 'text' && !child.value.trim()) continue
    for (const piece of split(child)) {
      if (children.length && !fits(add(weight, piece.weight))) flush()
      children.push(piece.node)
      weight = add(weight, piece.weight)
    }
  }
  if (children.length) flush()
  return sections
}
