import { ArrowLeft } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api, errorMessage, usingMock, type User } from '@/api'
import { Bar } from '@/components/Progress'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { solvePow } from '@/lib/pow'

const RESEND_SECONDS = 30

// Sign in is email plus a one time code. The browser solves a small puzzle before
// the code is requested, which is what makes mass requests expensive.
export default function Register({ onDone }: { onDone: (u: User) => void }) {
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [resendIn, setResendIn] = useState(0)
  const codeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (resendIn <= 0) return
    const id = setTimeout(() => setResendIn((s) => s - 1), 1000)
    return () => clearTimeout(id)
  }, [resendIn])

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus()
  }, [step])

  const sendCode = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      setProgress(0)
      const challenge = await api.getPowChallenge('otp')
      const pow = await solvePow(challenge, setProgress)
      await api.requestOtp(email.trim(), pow)
      setStep('code')
      setCode('')
      setResendIn(RESEND_SECONDS)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setProgress(null)
      setBusy(false)
    }
  }

  const verify = async (value: string) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      onDone(await api.verifyOtp(email.trim(), value))
    } catch (err) {
      setError(errorMessage(err))
      setCode('')
      codeRef.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  if (step === 'email') {
    return (
      <form onSubmit={(e) => { e.preventDefault(); sendCode() }} className="space-y-4">
        <Field label="Email" error={error || undefined} hint="One account per email. We send a six digit code.">
          <Input
            required
            autoFocus
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!error}
          />
        </Field>
        {progress !== null && (
          <div className="space-y-2">
            <Bar value={progress} />
            <p className="text-xs text-muted">Running a quick security check on this device</p>
          </div>
        )}
        <Button size="lg" busy={busy} className="w-full">{busy ? 'Sending code' : 'Send code'}</Button>
      </form>
    )
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (code.length === 6) verify(code) }} className="space-y-4">
      <button type="button" onClick={() => { setStep('email'); setError('') }} className="-ml-1 flex h-11 items-center gap-1 text-sm font-semibold text-primary-text">
        <ArrowLeft className="size-4" /> {email}
      </button>
      <Field
        label="Six digit code"
        error={error || undefined}
        hint={usingMock ? 'Demo mode: any six digits work, 000000 shows the error.' : 'Check your inbox. It can take a few seconds.'}
      >
        <Input
          ref={codeRef}
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          placeholder="••••••"
          value={code}
          aria-invalid={!!error}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '').slice(0, 6)
            setCode(v)
            // Submit as soon as the code is complete, which is also what SMS and mail autofill expect.
            if (v.length === 6) verify(v)
          }}
          className="h-15 text-center font-mono text-2xl tracking-[0.4em]"
        />
      </Field>
      <Button size="lg" busy={busy} disabled={code.length !== 6} className="w-full">{busy ? 'Checking' : 'Verify'}</Button>
      <Button type="button" variant="plain" disabled={resendIn > 0 || busy} onClick={sendCode} className="w-full">
        {resendIn > 0 ? `Send again in ${resendIn}s` : 'Send a new code'}
      </Button>
    </form>
  )
}
