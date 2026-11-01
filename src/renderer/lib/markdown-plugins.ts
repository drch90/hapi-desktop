import type { PluggableList } from 'unified'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import remarkLatexBracketMath from '@/lib/remark-latex-bracket-math'
import remarkRepairTables from '@/lib/remark-repair-tables'
import { remarkUserText } from './remark-user-text'

export type MarkdownOptions = { preserveSingleLineBreaks?: boolean; userMessage?: boolean }

const remarkPlugins: PluggableList = [
  [remarkGfm, { singleTilde: false }],
  remarkRepairTables,
  remarkLatexBracketMath,
  // Currency stays literal; use \(…\), \[…\] or $$…$$ for math.
  [remarkMath, { singleDollarTextMath: false }],
]
const remarkPluginsWithBreaks: PluggableList = [...remarkPlugins, remarkBreaks]
const userRemarkPlugins: PluggableList = [[remarkGfm, { singleTilde: false }], remarkUserText]
export const rehypePlugins: PluggableList = [rehypeKatex]

export function getRemarkPlugins(options: MarkdownOptions): PluggableList {
  return options.userMessage
    ? userRemarkPlugins
    : options.preserveSingleLineBreaks
      ? remarkPluginsWithBreaks
      : remarkPlugins
}
