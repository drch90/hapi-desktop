import { createContext, useContext, useState, type ReactElement, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

const ExpandedContentContext = createContext(false)
export const useExpandedContent = () => useContext(ExpandedContentContext)

export function ContentDialog({
  title,
  trigger,
  children,
  onOpenChange,
}: {
  title: string
  trigger: ReactElement
  children: ReactNode
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value)
        onOpenChange?.(value)
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {open && (
        <DialogContent
          className="content-reader-dialog"
          aria-describedby={undefined}
          onEscapeKeyDown={(event) => {
            // Escape closes CodeMirror's find/go-to-line panel first.
            if (event.target instanceof Element && event.target.closest('.cm-panel')) event.preventDefault()
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <ExpandedContentContext.Provider value>
            <div className="content-reader-body">{children}</div>
          </ExpandedContentContext.Provider>
        </DialogContent>
      )}
    </Dialog>
  )
}
