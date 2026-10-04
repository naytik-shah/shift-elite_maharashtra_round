import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

// 16px text keeps iOS Safari from zooming the page when the field is focused.
export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-12 w-full rounded-lg border border-line bg-surface px-4 text-base text-ink placeholder:text-muted',
        'transition-colors outline-none focus:border-primary focus:ring-3 focus:ring-primary-soft',
        'aria-invalid:border-danger',
        className,
      )}
      {...props}
    />
  )
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="type-strong mb-1.5 block">{label}</span>
      {children}
      {error ? (
        <span role="alert" className="mt-1.5 block text-[0.8125rem] text-danger">{error}</span>
      ) : hint ? (
        <span className="type-caption mt-1.5 block">{hint}</span>
      ) : null}
    </label>
  )
}
