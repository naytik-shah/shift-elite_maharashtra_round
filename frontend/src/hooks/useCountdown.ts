import { useEffect, useState } from 'react'

export function useCountdown(target?: number) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [])
  const ms = target ? Math.max(0, target - now) : 0
  const s = Math.ceil(ms / 1000)
  const label = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  return { ms, label }
}
