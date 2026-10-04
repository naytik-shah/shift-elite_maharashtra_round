import { Check, Loader2, X } from 'lucide-react'
import { useState } from 'react'
import { errorMessage, type Drop, type Ticket } from '@/api'
import { formatDateTime, formatPrice } from '@/lib/format'
import { isVpa, maskVpa, mockUtr, upiUri, type PayInfo } from '@/lib/payInfo'
import { Button } from './ui/button'
import { Field, Input } from './ui/input'
import Qr from './Qr'

type Step = 'details' | 'approve' | 'processing' | 'done' | 'failed'

interface Receipt { utr: string; at: number; vpa: string; ticket: Ticket }

// A mock UPI payment: a QR to scan, a UPI id, a stand-in for the bank's own approval screen and a receipt.
// No money moves. The UPI id is what the server ties to the seat, one id for one seat, exactly like a card.
export default function UpiPortal({
  drop, email, disabled, pay, onFinish,
}: {
  drop: Drop
  email?: string
  disabled?: boolean
  pay: (testCard: string, name: string, info: PayInfo) => Promise<Ticket>
  onFinish: () => void
}) {
  const [step, setStep] = useState<Step>('details')
  const [vpa, setVpa] = useState('')
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const amount = drop.ticketPrice
  const id = vpa.trim().toLowerCase()

  const approve = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pin.length < 4) return
    setStep('processing')
    setError('')
    const utr = mockUtr()
    const at = Date.now()
    try {
      // The bank screen takes a moment, so the receipt never flashes past.
      const [ticket] = await Promise.all([
        pay(`upi:${id}`, name.trim(), { method: 'upi', masked: maskVpa(id), utr, at }),
        new Promise((r) => setTimeout(r, 1600)),
      ])
      setReceipt({ utr, at, vpa: id, ticket })
      setStep('done')
    } catch (err) {
      setError(errorMessage(err))
      setStep('failed')
    } finally {
      setPin('')
    }
  }

  if (step === 'details') {
    return (
      <form onSubmit={(e) => { e.preventDefault(); if (isVpa(vpa)) setStep('approve') }} className="space-y-4">
        <div className="flex items-center gap-4 rounded-lg border border-line p-4">
          <Qr text={upiUri(amount, `Seat ${drop.id}`)} size={104} label="UPI payment QR code for Fair Drop" />
          <div className="min-w-0">
            <p className="type-strong">Pay Fair Drop</p>
            <p className="type-caption">fairdrop@demobank, demo merchant</p>
            {amount != null && <p className="type-title mt-1 tabular-nums">{formatPrice(amount)}</p>}
          </div>
        </div>
        <p className="type-caption">Scan the code with any UPI app, or enter your UPI ID below. This is a demo, no money moves.</p>
        <Field label="Your UPI ID" error={vpa && !isVpa(vpa) ? 'Use the form name@bank, for example asha@okaxis.' : undefined}>
          <Input required autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="email" autoComplete="off" placeholder="name@okaxis" value={vpa} onChange={(e) => setVpa(e.target.value)} />
        </Field>
        <Field label="Name on the ticket" hint="The ticket is issued in this name and cannot be transferred.">
          <Input required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>
        <Button size="lg" disabled={disabled || !isVpa(vpa) || !name.trim()} className="w-full">Pay with UPI</Button>
      </form>
    )
  }

  if (step === 'approve' || step === 'processing') {
    return (
      <form onSubmit={approve} className="overflow-hidden rounded-lg border border-line">
        <div className="bg-fill px-4 py-3">
          <p className="type-strong">Demo UPI</p>
          <p className="type-caption">Approve this payment</p>
        </div>
        <dl className="divide-y divide-line px-4">
          <div className="flex justify-between gap-4 py-3"><dt className="type-body">Paying</dt><dd className="type-strong">Fair Drop (demo)</dd></div>
          {amount != null && <div className="flex justify-between gap-4 py-3"><dt className="type-body">Amount</dt><dd className="type-strong tabular-nums">{formatPrice(amount)}</dd></div>}
          <div className="flex justify-between gap-4 py-3"><dt className="type-body">From</dt><dd className="type-strong min-w-0 break-all text-right">{id}</dd></div>
        </dl>
        <div className="space-y-3 px-4 pt-3 pb-4">
          {step === 'processing' ? (
            <div role="status" className="flex items-center gap-3 py-3">
              <Loader2 className="size-5 animate-spin" aria-hidden />
              <p className="type-strong">Contacting your bank…</p>
            </div>
          ) : (
            <>
              <Field label="UPI PIN" hint="Any 4 to 6 digits works in this demo. Nothing is sent to a bank.">
                <Input required autoFocus type="password" inputMode="numeric" autoComplete="off" pattern="\d{4,6}" maxLength={6} placeholder="••••" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} className="text-center font-mono tracking-[0.4em]" />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="gray" onClick={() => { setPin(''); setStep('details') }}>Cancel</Button>
                <Button disabled={pin.length < 4}>Approve</Button>
              </div>
            </>
          )}
        </div>
      </form>
    )
  }

  if (step === 'done' && receipt) {
    return (
      <div className="space-y-4" role="status">
        <div className="flex flex-col items-center gap-2 pt-2 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-ok text-primary-fg"><Check className="size-6" strokeWidth={3} aria-hidden /></span>
          <p className="type-title">Payment successful</p>
          {amount != null && <p className="type-body tabular-nums">{formatPrice(amount)} paid to Fair Drop (demo)</p>}
        </div>
        <dl className="divide-y divide-line rounded-lg border border-line px-4">
          <div className="flex justify-between gap-4 py-3"><dt className="type-body">UPI transaction ID</dt><dd className="type-strong font-mono tabular-nums">{receipt.utr}</dd></div>
          <div className="flex justify-between gap-4 py-3"><dt className="type-body">From</dt><dd className="type-strong min-w-0 break-all text-right">{maskVpa(receipt.vpa)}</dd></div>
          <div className="flex justify-between gap-4 py-3"><dt className="type-body">Time</dt><dd className="type-strong">{formatDateTime(new Date(receipt.at).toISOString())}</dd></div>
          {email && <div className="flex justify-between gap-4 py-3"><dt className="type-body">Ticket issued to</dt><dd className="type-strong min-w-0 break-all text-right">{email}</dd></div>}
        </dl>
        <Button size="lg" className="w-full" onClick={onFinish}>View my ticket</Button>
      </div>
    )
  }

  return (
    <div className="space-y-4" role="alert">
      <div className="flex flex-col items-center gap-2 pt-2 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-danger text-primary-fg"><X className="size-6" strokeWidth={3} aria-hidden /></span>
        <p className="type-title">Payment failed</p>
        <p className="type-body">{error}</p>
      </div>
      <Button size="lg" variant="gray" className="w-full" onClick={() => setStep('details')}>Try another UPI ID</Button>
    </div>
  )
}
