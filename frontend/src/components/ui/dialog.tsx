import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export const Dialog = DialogPrimitive.Root

// Bottom sheet on phones, centered modal from the sm breakpoint up.
export function DialogContent({ title, description, children, className }: { title: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 animate-fade bg-black/45" />
      <DialogPrimitive.Content
        {...(description ? {} : { "aria-describedby": undefined })}
        className={cn(
          'fixed z-50 flex max-h-[92dvh] flex-col bg-bg text-ink shadow-2xl outline-none',
          'inset-x-0 bottom-0 animate-sheet rounded-t-card pb-[env(safe-area-inset-bottom)]',
          'sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-[28rem] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:animate-pop sm:rounded-card sm:pb-0',
          className,
        )}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-line sm:hidden" aria-hidden />
        <div className="flex items-start justify-between gap-4 px-5 pt-4 sm:px-6 sm:pt-6">
          <div>
            <DialogPrimitive.Title className="text-xl font-bold tracking-tight">{title}</DialogPrimitive.Title>
            {description && (
              <DialogPrimitive.Description className="mt-1 text-sm text-muted">{description}</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close
            className="-mt-1 -mr-1 grid size-11 shrink-0 place-items-center rounded-full text-muted transition-colors hover:text-ink"
            aria-label="Close"
          >
            <span className="grid size-8 place-items-center rounded-full bg-fill"><X className="size-4" /></span>
          </DialogPrimitive.Close>
        </div>
        <div className="overflow-y-auto px-5 pt-4 pb-5 sm:px-6 sm:pb-6">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}
