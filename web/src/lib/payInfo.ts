// Details of how a ticket was paid for. The server keeps only a keyed hash of the card or UPI id, so the
// readable part (method, masked id, transaction id) is remembered on this device for the receipt and ticket.

export interface PayInfo {
  method: 'card' | 'upi'
  masked: string
  utr?: string
  at: number
}

const key = (ticketId: string) => `fd.pay.${ticketId}`

export function savePayInfo(ticketId: string, info: PayInfo) {
  try { localStorage.setItem(key(ticketId), JSON.stringify(info)) } catch { /* storage can be blocked */ }
}

export function readPayInfo(ticketId: string): PayInfo | null {
  try {
    const raw = localStorage.getItem(key(ticketId))
    return raw ? (JSON.parse(raw) as PayInfo) : null
  } catch {
    return null
  }
}

export const maskCard = (card: string) => {
  const d = card.replace(/\D/g, '')
  return d.length >= 4 ? `Card ending ${d.slice(-4)}` : 'Card'
}

export function maskVpa(vpa: string) {
  const [name, bank] = vpa.split('@')
  return `${name.slice(0, 2)}${'•'.repeat(Math.max(2, name.length - 2))}@${bank}`
}

export const isVpa = (v: string) => /^[a-z0-9._-]{2,}@[a-z]{2,}$/i.test(v.trim())

// A 12 digit transaction reference in the shape UPI uses. Random, demo only.
export function mockUtr() {
  const a = new Uint32Array(2)
  crypto.getRandomValues(a)
  return String(a[0]).padStart(10, '0').slice(-6) + String(a[1]).padStart(10, '0').slice(-6)
}

export const upiUri = (amount: number | undefined, note: string) =>
  `upi://pay?pa=fairdrop@demobank&pn=${encodeURIComponent('Fair Drop (demo)')}${amount != null ? `&am=${amount}` : ''}&cu=INR&tn=${encodeURIComponent(note)}`

export const groupRef = (ref: string) => ref.replace(/(.{4})(?=.)/g, '$1 ')
