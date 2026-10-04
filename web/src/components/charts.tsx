import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

// Small SVG charts drawn from the theme tokens, so they follow light and dark without extra work.

export interface Series { name: string; color: string; values: number[] }

const nice = (max: number) => {
  if (max <= 5) return 5
  const p = 10 ** Math.floor(Math.log10(max))
  const n = max / p
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p
}

// Lines over time with a faint area under the first one. `labels` are the left and right time captions.
export function AreaChart({ series, height = 168, labels }: { series: Series[]; height?: number; labels?: [string, string] }) {
  const uid = useId().replace(/:/g, '')
  const n = Math.max(2, ...series.map((s) => s.values.length))
  const max = nice(Math.max(1, ...series.flatMap((s) => s.values)))
  const W = 600
  const padL = 34
  const padB = 6
  const h = height
  const x = (i: number) => padL + (i / (n - 1)) * (W - padL - 4)
  const y = (v: number) => 6 + (1 - v / max) * (h - 6 - padB)
  const ticks = [0, max / 2, max]
  const path = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i + (n - vals.length)).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  const first = series[0]

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${h}`} className="w-full" role="img" aria-label={series.map((s) => `${s.name}, latest ${s.values.at(-1) ?? 0}`).join('; ')}>
        <defs>
          <linearGradient id={`${uid}a`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={first?.color} stopOpacity="0.22" />
            <stop offset="1" stopColor={first?.color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="1" strokeDasharray={t === 0 ? undefined : '3 4'} />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)" style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(t)}</text>
          </g>
        ))}
        {first && first.values.length > 1 && (
          <path d={`${path(first.values)} L${x(n - 1)} ${y(0)} L${x(n - first.values.length)} ${y(0)} Z`} fill={`url(#${uid}a)`} />
        )}
        {series.map((s) => s.values.length > 1 && (
          <path key={s.name} d={path(s.values)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {series.map((s) => s.values.length > 0 && (
          <circle key={s.name} cx={x(n - 1)} cy={y(s.values.at(-1)!)} r="3.5" fill={s.color} stroke="var(--surface)" strokeWidth="2" />
        ))}
      </svg>
      {labels && (
        <div className="type-caption mt-1 flex justify-between pl-[34px]"><span>{labels[0]}</span><span>{labels[1]}</span></div>
      )}
    </div>
  )
}

export interface Slice { label: string; value: number; color: string }

// A ring with the total in the middle. Slices below 0.5% are not drawn.
export function Donut({ slices, size = 152, centre }: { slices: Slice[]; size?: number; centre: ReactNode }) {
  const total = slices.reduce((a, s) => a + s.value, 0)
  const r = 54
  const c = 2 * Math.PI * r
  let offset = 0
  return (
    <div className="relative mx-auto grid place-items-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 140 140" className="size-full -rotate-90" role="img" aria-label={slices.map((s) => `${s.label} ${s.value}`).join(', ')}>
        <circle cx="70" cy="70" r={r} fill="none" stroke="var(--fill)" strokeWidth="14" />
        {total > 0 && slices.map((s) => {
          const len = (s.value / total) * c
          if (len < c * 0.005) return null
          const el = <circle key={s.label} cx="70" cy="70" r={r} fill="none" stroke={s.color} strokeWidth="14" strokeDasharray={`${Math.max(0, len - 2)} ${c}`} strokeDashoffset={-offset} />
          offset += len
          return el
        })}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{centre}</div>
    </div>
  )
}

export function Legend({ items, className }: { items: { label: string; value?: string; color: string }[]; className?: string }) {
  return (
    <ul className={cn('space-y-1.5', className)}>
      {items.map((i) => (
        <li key={i.label} className="type-body flex items-center justify-between gap-3">
          <span className="flex items-center gap-2"><span className="size-2.5 rounded-sm" style={{ background: i.color }} aria-hidden />{i.label}</span>
          {i.value !== undefined && <span className="type-strong tabular-nums">{i.value}</span>}
        </li>
      ))}
    </ul>
  )
}

// One bar per row against a shared maximum. `mark` draws a target line.
export function Bars({ rows, max, unit = '' }: { rows: { label: string; value: number | null; color: string; mark?: number }[]; max: number; unit?: string }) {
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[6.5rem_1fr_3.25rem] items-center gap-3">
          <span className="type-caption truncate">{r.label}</span>
          <div className="relative h-2.5 rounded-sm bg-fill">
            <div className="h-full rounded-sm transition-[width] duration-500" style={{ width: `${Math.min(100, ((r.value ?? 0) / max) * 100)}%`, background: r.color }} />
            {r.mark != null && <span aria-hidden className="absolute -top-1 h-4.5 w-px bg-ink" style={{ left: `${Math.min(100, (r.mark / max) * 100)}%` }} />}
          </div>
          <span className="type-strong text-right tabular-nums">{r.value == null ? 'n/a' : `${r.value.toFixed(2)}${unit}`}</span>
        </div>
      ))}
    </div>
  )
}
