export function formatAmount(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
  } catch {
    return `${currency} ${amount}`
  }
}

export const formatNumber = (n: number) => n.toLocaleString('en-IN')

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
}

export function formatDay(iso: string) {
  const d = new Date(iso)
  return {
    day: d.toLocaleDateString('en-IN', { day: 'numeric' }),
    month: d.toLocaleDateString('en-IN', { month: 'short' }),
    year: d.toLocaleDateString('en-IN', { year: 'numeric' }),
    full: d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
  }
}

export function shortHash(hash: string, head = 10, tail = 6) {
  return hash.length <= head + tail + 1 ? hash : `${hash.slice(0, head)}…${hash.slice(-tail)}`
}

export function greeting(now = new Date()) {
  const h = now.getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

// "3 days", "20 hours", "12 min" for a moment in the future.
export function relativeIn(iso: string, now = Date.now()) {
  const m = Math.round((Date.parse(iso) - now) / 60_000)
  if (m < 60) return `${Math.max(m, 1)} min`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} hours`
  return `${Math.round(h / 24)} days`
}

export function formatDateTime(iso: string) {
  const d = new Date(iso)
  return `${d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}, ${formatTime(iso)}`
}
