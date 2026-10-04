import { useEffect, useRef, useState } from 'react'

// Polls a read every few seconds and keeps the last good answer on screen if one fails.
export function usePoll<T>(load: () => Promise<T>, ms: number, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [failed, setFailed] = useState(false)
  const runRef = useRef<() => void>(() => {})
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    let alive = true
    setData(null)
    setFailed(false)
    const run = async () => {
      try {
        const res = await loadRef.current()
        if (alive) { setData(res); setFailed(false) }
      } catch {
        if (alive) setFailed(true)
      }
    }
    runRef.current = run
    run()
    const id = setInterval(() => { if (document.visibilityState === 'visible') run() }, ms)
    return () => { alive = false; clearInterval(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, failed, refresh: () => runRef.current() }
}

export function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="surface rounded-tile px-4 py-3">
      <p className="type-caption">{label}</p>
      <p className="type-title tabular-nums">{value}</p>
      {hint && <p className="type-caption">{hint}</p>}
    </div>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="type-body py-6 text-center">{children}</p>
}
