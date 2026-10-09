// Inline only the packaged WOFF2 fonts, in a chunk loaded when exporting math.
// SVG image captures cannot use the document's external font files, and the
// renderer's CSP intentionally prevents html-to-image from fetching them.
const fonts = import.meta.glob<string>('../../../node_modules/katex/dist/fonts/*.woff2', {
  eager: true,
  query: '?inline',
  import: 'default',
})

export const katexFontCss = Object.entries(fonts)
  .map(([path, url]) => {
    const match = /\/(KaTeX_[^-]+)-([^.]+)\.woff2$/.exec(path)
    if (!match) return ''
    const [, family, variant] = match
    const style = variant.includes('Italic') ? 'italic' : 'normal'
    const weight = variant.includes('Bold') ? 700 : 400
    return `@font-face{font-family:${family};font-style:${style};font-weight:${weight};src:url("${url}") format("woff2")}`
  })
  .join('\n')
