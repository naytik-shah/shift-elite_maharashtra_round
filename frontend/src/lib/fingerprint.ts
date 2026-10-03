import { sha256, toHex } from './sha256'

function canvasSignal(): string {
  try {
    const c = document.createElement('canvas')
    c.width = 220
    c.height = 40
    const ctx = c.getContext('2d')
    if (!ctx) return 'none'
    ctx.textBaseline = 'top'
    ctx.font = '16px system-ui'
    ctx.fillStyle = '#4338ca'
    ctx.fillRect(4, 4, 90, 24)
    ctx.fillStyle = '#a3e635'
    ctx.fillText('fair drop 500/50000', 8, 10)
    return c.toDataURL()
  } catch {
    return 'blocked'
  }
}

let cached: string | null = null

// Coarse device signal for the risk scorer. It only feeds clustering on the server,
// it is never used on its own to block anyone.
export function deviceFingerprint(): string {
  if (cached) return cached
  const nav = navigator as Navigator & { deviceMemory?: number }
  const parts = [
    nav.userAgent,
    nav.language,
    (nav.languages || []).join(','),
    nav.hardwareConcurrency,
    nav.deviceMemory ?? '',
    nav.maxTouchPoints,
    screen.width, screen.height, screen.colorDepth, devicePixelRatio,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    canvasSignal(),
  ]
  cached = 'fp_' + toHex(sha256(parts.join('|'))).slice(0, 32)
  return cached
}
