import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

// A real, scannable QR code drawn in the browser. Dark on white whatever the theme, because scanners need the contrast.
export default function Qr({ text, size = 112, label, className }: { text: string; size?: number; label: string; className?: string }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let alive = true
    QRCode.toDataURL(text, { margin: 1, width: size * 2, color: { dark: '#0f1216', light: '#ffffff' } })
      .then((u) => { if (alive) setSrc(u) })
      .catch(() => { if (alive) setSrc('') })
    return () => { alive = false }
  }, [text, size])
  return (
    <div className={cn('shrink-0 overflow-hidden rounded-md bg-white', className)} style={{ width: size, height: size }}>
      {src && <img src={src} width={size} height={size} alt={label} />}
    </div>
  )
}
