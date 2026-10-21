import { useEffect, useRef, useState } from 'react'
import type { MarkdownOptions } from './markdown-plugins'
import type { MarkdownRequest, MarkdownResult } from './markdown-worker'
import type { MarkdownSection } from './markdown-sections'

type Preview = { sections: MarkdownSection[]; error: boolean; ready: boolean }
const emptyPreview = (): Preview => ({ sections: [], error: false, ready: false })

export function useMarkdownPreview(
  props: MarkdownOptions & { content: string },
  enabled: boolean,
  retry: number,
) {
  const [result, setResult] = useState<Preview>(emptyPreview)
  const latest = useRef<MarkdownRequest | null>(null)
  const sequence = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const send = useRef(() => {})
  useEffect(() => {
    setResult(emptyPreview())
    if (!enabled) return
    let instance: Worker
    try {
      instance = new Worker(new URL('./markdown-worker.ts', import.meta.url), { type: 'module' })
    } catch {
      setResult({ sections: [], error: true, ready: true })
      return
    }
    let busy = false
    let sent: MarkdownRequest | null = null
    send.current = () => {
      if (!latest.current || busy || sent?.id === latest.current.id) return
      sent = latest.current
      busy = true
      instance.postMessage(sent)
    }
    instance.onmessage = ({ data }: MessageEvent<MarkdownResult>) => {
      if (data.id !== sent?.id) return
      busy = false
      // Show completed prefixes during streaming. Replacements discard the
      // old response, and only the newest pending request is sent next.
      if (data.id === latest.current?.id || (!data.error && latest.current?.content.startsWith(sent.content)))
        setResult(
          data.error
            ? { sections: [], error: true, ready: true }
            : { sections: data.sections, error: false, ready: true },
        )
      send.current()
    }
    instance.onerror = (event) => {
      event.preventDefault()
      busy = false
      setResult({ sections: [], error: true, ready: true })
    }
    return () => {
      clearTimeout(timer.current)
      timer.current = undefined
      instance.onmessage = null
      instance.onerror = null
      instance.terminate()
      send.current = () => {}
    }
  }, [enabled, retry])
  useEffect(() => {
    if (!enabled) return
    latest.current = {
      id: ++sequence.current,
      content: props.content,
      preserveSingleLineBreaks: props.preserveSingleLineBreaks,
      userMessage: props.userMessage,
    }
    // Throttle, rather than debounce: continuous token updates must not keep
    // postponing the first preview until the agent finishes its response.
    if (timer.current === undefined)
      timer.current = setTimeout(() => {
        timer.current = undefined
        send.current()
      }, 150)
  }, [props.content, props.preserveSingleLineBreaks, props.userMessage, enabled, retry])
  return result
}
