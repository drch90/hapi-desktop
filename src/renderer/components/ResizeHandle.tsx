export function ResizeHandle(props: {
  label: string
  value: number
  min: number
  max: number
  step: number
  direction?: 1 | -1
  pointerValue: (clientX: number) => number
  onChange: (value: number) => void
  onReset: () => void
}) {
  return (
    <div
      className="split-handle"
      role="separator"
      aria-label={props.label}
      aria-orientation="vertical"
      aria-valuenow={Math.round(props.value)}
      aria-valuemin={props.min}
      aria-valuemax={props.max}
      tabIndex={0}
      onKeyDown={(event) => {
        let value = props.value
        if (event.key === 'ArrowLeft') value -= props.step * (props.direction ?? 1)
        else if (event.key === 'ArrowRight') value += props.step * (props.direction ?? 1)
        else if (event.key === 'Home') value = props.min
        else if (event.key === 'End') value = props.max
        else return
        event.preventDefault()
        props.onChange(Math.min(props.max, Math.max(props.min, value)))
      }}
      onDoubleClick={props.onReset}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.focus()
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
        props.onChange(Math.min(props.max, Math.max(props.min, props.pointerValue(event.clientX))))
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId)
      }}
    />
  )
}
