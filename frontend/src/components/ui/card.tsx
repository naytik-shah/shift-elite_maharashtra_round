import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-card bg-surface p-5 sm:p-6', className)} {...props} />
}

// Sentence case label that sits above a group, outside the card.
export function SectionTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('mb-2 px-1 text-lg font-semibold tracking-tight', className)} {...props} />
}

// Rows inside a card, separated by hairlines.
export function Rows({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('divide-y divide-line rounded-card bg-surface px-5 sm:px-6', className)} {...props} />
}
