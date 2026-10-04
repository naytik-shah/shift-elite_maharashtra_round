import { sha256 } from 'js-sha256'

let cached: string | null = null

// Coarse device signal for the scoring model, built only from what the browser reports.
export function deviceFingerprint(): string {
  if (cached) return cached
  const parts = [
    navigator.userAgent,
    navigator.language,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    navigator.hardwareConcurrency,
    navigator.platform,
  ]
  cached = sha256(parts.join('|'))
  return cached
}
