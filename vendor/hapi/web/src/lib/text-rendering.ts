// Bound both text work and DOM size. A byte/character limit alone still lets
// thousands of short lines through; a line limit alone misses minified files.
export const TEXT_PAGE_CHARS = 24_000
export const TEXT_PAGE_LINES = 300
const HIGHLIGHT_LINE_CHARS = 1_500

export type TextPage = { start: number; end: number; startLine: number }

export function isLargeText(text: string): boolean {
    if (text.length > TEXT_PAGE_CHARS) return true
    let lines = 1
    for (let at = text.indexOf('\n'); at >= 0 && at < text.length - 1; at = text.indexOf('\n', at + 1)) {
        if (++lines > TEXT_PAGE_LINES) return true
    }
    return false
}

export function canHighlightText(text: string): boolean {
    if (isLargeText(text)) return false
    let start = 0
    for (;;) {
        const newline = text.indexOf('\n', start)
        const end = newline < 0 ? text.length : newline
        if (end - start > HIGHLIGHT_LINE_CHARS) return false
        if (newline < 0) return true
        start = newline + 1
    }
}

/** Non-overlapping slices preserve every character, including long lines. */
export function paginateText(text: string): TextPage[] {
    if (!isLargeText(text)) return [{ start: 0, end: text.length, startLine: 1 }]
    const pages: TextPage[] = []
    let start = 0
    let startLine = 1
    while (start < text.length) {
        let end = Math.min(start + TEXT_PAGE_CHARS, text.length)
        // Keep UTF-16 surrogate pairs and Windows newlines on the same page.
        const last = text.charCodeAt(end - 1)
        if (end < text.length && (
            (last >= 0xd800 && last <= 0xdbff)
            || (last === 13 && text.charCodeAt(end) === 10)
        )) end--
        // Search only this slice: repeatedly searching the rest of a minified
        // file for a nonexistent newline would otherwise be quadratic.
        const slice = text.slice(start, end)
        let lines = 0
        let lastNewline = -1
        for (let at = slice.indexOf('\n'); at >= 0; at = slice.indexOf('\n', at + 1)) {
            lastNewline = at
            if (++lines === TEXT_PAGE_LINES) break
        }
        if (lastNewline >= 0 && (end < text.length || lines === TEXT_PAGE_LINES)) {
            end = start + lastNewline + 1
        }
        pages.push({ start, end, startLine })
        startLine += lines
        start = end
    }
    return pages
}
