/** Convert Markdown content controls to static content before the shared dialog strips inputs/buttons. */
export function createShareSnapshot(source: HTMLElement | null): string {
  if (!source) return ''
  const snapshot = source.cloneNode(true) as HTMLElement
  for (const block of snapshot.querySelectorAll<HTMLElement>('[data-virtual-text-content]')) {
    // Virtual editors contain large offscreen spacers, not the whole document.
    // Turn the rendered excerpt into static text before cloning for an image.
    const text = [...block.querySelectorAll('.cm-line')]
      .slice(0, 300)
      .map((line) => line.textContent)
      .join('\n')
    const excerpt = document.createElement('pre')
    excerpt.className = 'virtual-text-excerpt'
    excerpt.textContent = text.slice(0, 24_000).replace(/[\uD800-\uDBFF]$/, '')
    block.querySelector('.virtual-text-editor')?.replaceWith(excerpt)
    const label = document.createElement('span')
    label.textContent = block.dataset.hapiShareExcerptLabel ?? ''
    block.querySelector('.virtual-text-toolbar')?.append(label)
    const wrapper = block.closest<HTMLElement>('.virtual-text-block')
    if (wrapper) {
      wrapper.style.height = 'auto'
      wrapper.style.maxHeight = 'none'
    }
  }
  for (const checkbox of snapshot.querySelectorAll<HTMLInputElement>(
    '.task-list-item input[type="checkbox"]',
  )) {
    const marker = document.createElement('span')
    marker.className = 'markdown-task-checkbox'
    marker.textContent = checkbox.checked ? '☑' : '☐'
    checkbox.replaceWith(marker)
  }
  for (const block of snapshot.querySelectorAll('.markdown-mermaid')) {
    if (!block.querySelector('[data-mermaid-diagram]')) continue
    // Snapshot controls cannot re-render a diagram or switch back to its source.
    for (const control of block.querySelectorAll('[data-hapi-share-export-exclude]')) control.remove()
  }
  for (const button of snapshot.querySelectorAll<HTMLButtonElement>('button[data-mermaid-diagram]')) {
    const diagram = document.createElement('div')
    diagram.className = button.className
    diagram.dataset.mermaidDiagram = 'true'
    diagram.style.cursor = 'default'
    diagram.append(...button.childNodes)
    button.replaceWith(diagram)
  }
  return snapshot.outerHTML
}

export async function renderShareImage(element: HTMLElement, width: number): Promise<Blob> {
  const { toBlob } = await import('html-to-image')
  const clone = element.cloneNode(true) as HTMLElement
  clone.style.cssText = `position:fixed;left:-20000px;top:0;width:${width}px;max-width:none;overflow:visible;pointer-events:none;padding:28px;background:var(--app-bg);color:var(--app-fg)`
  for (const control of clone.querySelectorAll(
    '[data-hapi-share-export-exclude="true"], [data-hapi-share-action="true"], button',
  ))
    control.remove()
  for (const body of clone.querySelectorAll<HTMLElement>('[data-hapi-code-body="true"]')) {
    body.style.maxHeight = 'none'
    body.style.overflow = 'visible'
  }
  for (const wideContent of clone.querySelectorAll<HTMLElement>('.aui-md-table-wrapper, .katex-display')) {
    wideContent.style.overflow = 'visible'
  }
  document.body.appendChild(clone)
  try {
    await document.fonts.ready
    // Embed math fonts from local build assets without loosening renderer CSP.
    const fontEmbedCSS = clone.querySelector('.katex')
      ? (await import('./katex-share-fonts')).katexFontCss
      : ''
    // Include every table column and formula even when the live message scrolls.
    width = Math.max(width, Math.ceil(clone.scrollWidth))
    clone.style.width = `${width}px`
    const height = Math.ceil(clone.scrollHeight)
    const pixelRatio = Math.min(2, Math.sqrt(24_000_000 / Math.max(1, width * height)))
    const blob = await toBlob(clone, {
      width,
      height,
      pixelRatio,
      fontEmbedCSS,
      skipFonts: !fontEmbedCSS,
      backgroundColor: getComputedStyle(clone).backgroundColor,
      style: { position: 'static', left: '0', top: '0' },
    })
    if (!blob) throw new Error('IMAGE_EXPORT_FAILED')
    return blob
  } finally {
    clone.remove()
  }
}
