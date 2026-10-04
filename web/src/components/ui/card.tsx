import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('surface rounded-card p-5 sm:p-6', className)} {...props} />
}

// Sentence case label that sits above a group, outside the card.
export function SectionTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('type-headline mb-2.5 px-1', className)} {...props} />
}

// Rows inside a card, separated by hairlines.
export function Rows({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('surface divide-y divide-line rounded-card px-5 sm:px-6', className)} {...props} />
}
