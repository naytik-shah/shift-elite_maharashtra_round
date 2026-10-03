import { CATEGORIES, type EventCategory } from '@/api'
import { cn } from '@/lib/utils'

export type CategoryFilter = EventCategory | 'All'

export default function CategoryChips({ value, onChange }: { value: CategoryFilter; onChange: (c: CategoryFilter) => void }) {
  const all: CategoryFilter[] = ['All', ...CATEGORIES]
  return (
    <div role="radiogroup" aria-label="Category" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {all.map((c) => (
        <button
          key={c}
          role="radio"
          aria-checked={value === c}
          onClick={() => onChange(c)}
          className={cn(
            'h-11 shrink-0 rounded-full px-5 text-sm font-semibold transition-colors',
            value === c ? 'bg-ink text-bg' : 'bg-surface text-ink',
          )}
        >
          {c}
        </button>
      ))}
    </div>
  )
}
