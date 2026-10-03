import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

// 16px text keeps iOS Safari from zooming the page when the field is focused.
export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-[3.125rem] w-full rounded-2xl border border-line bg-surface px-4 text-base text-ink placeholder:text-muted',
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
      <span className="mb-1.5 block text-sm font-semibold">{label}</span>
      {children}
      {error ? (
        <span role="alert" className="mt-1.5 block text-xs text-danger">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-xs text-muted">{hint}</span>
      ) : null}
    </label>
  )
}
