import type { Processor } from 'unified'
import remarkMath from 'remark-math'

/** Extend the existing parser so dollar math also works in lists and preview workers. */
export function remarkDesktopMath(this: Processor) {
  remarkMath.call(this, { singleDollarTextMath: true })
  const data = this.data()
  const syntax = data.micromarkExtensions?.at(-1)
  const mathText = syntax?.text?.[36]
  const mdast = data.fromMarkdownExtensions?.at(-1)
  if (!syntax || !mathText || Array.isArray(mathText) || !mdast || Array.isArray(mdast)) {
    throw new Error('The Markdown math parser extensions are unavailable')
  }
  const enterMath = mdast.enter?.mathText
  if (!enterMath) throw new Error('The Markdown inline math handler is unavailable')

  syntax.text = {
    ...syntax.text,
    36: {
      ...mathText,
      tokenize(effects, ok, nok) {
        const start = this.now()
        return mathText.tokenize.call(
          this,
          effects,
          (code) => {
            const raw = this.sliceSerialize({ start, end: this.now() })
            if (raw.startsWith('$$')) return ok(code)

            // Reject ambiguous dollar pairs while tokenizing, so a price cannot
            // consume the opening delimiter of a later formula. Markdown still
            // owns code fences, escapes, link destinations and container syntax.
            const value = raw.slice(1, -1)
            const followedByWord = code !== null && /[\da-z_]/i.test(String.fromCharCode(code))
            if (!value || value.trim() !== value || /[\r\n]/.test(value) || followedByWord) {
              return nok(code)
            }
            return ok(code)
          },
          nok,
        )
      },
    },
  }

  mdast.enter = {
    ...mdast.enter,
    mathText(token) {
      enterMath.call(this, token)
      // The base handler also opens a text buffer above the formula node.
      const node = this.stack.findLast((entry) => entry.type === 'inlineMath')
      // remark-math treats same-line $$…$$ as inline math. Mark it for display
      // at parse time, before table/bracket plugins can reparse the source.
      if (node?.type === 'inlineMath' && this.sliceSerialize(token).startsWith('$$')) {
        node.data = {
          ...node.data,
          hProperties: { ...node.data?.hProperties, className: ['language-math', 'math-display'] },
        }
      }
    },
  }
}
