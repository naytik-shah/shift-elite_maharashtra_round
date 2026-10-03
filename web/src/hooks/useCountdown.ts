import { useEffect, useState } from 'react'

const pad = (n: number) => String(n).padStart(2, '0')

// Accepts epoch ms or an ISO string. Only rerenders when the visible second changes.
export function useCountdown(target?: number | string | null) {
  const at = target == null ? 0 : typeof target === 'string' ? Date.parse(target) : target
  const left = () => (at ? Math.max(0, Math.ceil((at - Date.now()) / 1000)) : 0)
  const [s, setS] = useState(left)

  useEffect(() => {
    setS(left())
    if (!at) return
    const id = setInterval(() => setS(left()), 250)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at])

  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  // Days read better than 71:59:32 when the event is far off.
  const label = h >= 24
    ? `${Math.floor(h / 24)}d ${h % 24}h ${m}m`
    : h > 0 ? `${pad(h)}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`
  return { seconds: s, done: at > 0 && s === 0, label }
}
