import { ArrowLeft } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api, errorCode, errorMessage, type User } from '@/api'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { withPow } from '@/lib/pow'

const RESEND_SECONDS = 30
// Demo builds show the fixed demo code, which the server accepts when it is switched on there.
const DEMO_CODE = import.meta.env.VITE_DEMO_LOGIN === 'true' ? import.meta.env.VITE_DEMO_CODE || '' : ''

// Login is email plus a one time code. The browser solves a small puzzle before the
// code is requested, which is what makes mass requests expensive.
export default function Register({ onDone }: { onDone: (u: User) => void }) {
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [devCode, setDevCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [locked, setLocked] = useState(false)
  const [resendIn, setResendIn] = useState(0)
  const codeRef = useRef<HTMLInputElement>(null)
  const running = useRef(false)

  useEffect(() => {
    if (resendIn <= 0) return
    const id = setTimeout(() => setResendIn((s) => s - 1), 1000)
    return () => clearTimeout(id)
  }, [resendIn])

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus()
  }, [step])

  const sendCode = async () => {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError('')
    try {
      const res = await withPow('otp', (pow) => api.requestOtp(email.trim(), pow))
      // Only present when the server is in test mode.
      setDevCode(res.devCode ?? '')
      setStep('code')
      setCode('')
      setLocked(false)
      setResendIn(RESEND_SECONDS)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      running.current = false
      setBusy(false)
    }
  }

  const verify = async (value: string) => {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError('')
    try {
      onDone(await api.verifyOtp(email.trim(), value))
    } catch (err) {
      setError(errorMessage(err))
      // After five wrong tries the code is dead, only a new one will work.
      if (errorCode(err) === 'OTP_LOCKED') { setLocked(true); setResendIn(0) }
      setCode('')
      codeRef.current?.focus()
    } finally {
      running.current = false
      setBusy(false)
    }
  }

  if (step === 'email') {
    return (
      <form onSubmit={(e) => { e.preventDefault(); sendCode() }} className="space-y-4">
        <Field label="Email" error={error || undefined} hint="We will email you a six digit code.">
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
        <Button size="lg" busy={busy} className="w-full">{busy ? 'Getting ready…' : 'Send code'}</Button>
      </form>
    )
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (code.length === 6 && !locked) verify(code) }} className="space-y-4">
      <button type="button" onClick={() => { setStep('email'); setError('') }} className="type-strong -ml-1 flex h-11 items-center gap-1 text-primary-text">
        <ArrowLeft className="size-4" /> {email}
      </button>
      {devCode && (
        <button
          type="button"
          onClick={() => { setCode(devCode); verify(devCode) }}
          className="flex h-12 w-full items-center justify-between rounded-lg bg-fill px-4 text-left"
        >
          <span className="type-body">Test mode code, tap to use</span>
          <span className="type-strong font-mono tracking-widest">{devCode}</span>
        </button>
      )}
      {DEMO_CODE && !devCode && (
        <button type="button" onClick={() => { setCode(DEMO_CODE); verify(DEMO_CODE) }} className="flex h-12 w-full items-center justify-between rounded-lg bg-fill px-4 text-left">
          <span className="type-body">Demo code, tap to use</span>
          <span className="type-strong font-mono tracking-widest">{DEMO_CODE}</span>
        </button>
      )}
      <Field label="Six digit code" error={error || undefined} hint={devCode ? undefined : 'Check your inbox.'}>
        <Input
          ref={codeRef}
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          placeholder="••••••"
          value={code}
          disabled={locked}
          aria-invalid={!!error}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '').slice(0, 6)
            setCode(v)
            // Submit as soon as the code is complete, which is also what mail autofill expects.
            if (v.length === 6) verify(v)
          }}
          className="h-15 text-center font-mono text-2xl tracking-[0.4em]"
        />
      </Field>
      {!locked && <Button size="lg" busy={busy} disabled={code.length !== 6} className="w-full">{busy ? 'Checking' : 'Verify'}</Button>}
      <Button type="button" variant={locked ? 'primary' : 'plain'} size={locked ? 'lg' : 'md'} busy={locked && busy} disabled={resendIn > 0 || busy} onClick={sendCode} className="w-full">
        {resendIn > 0 ? `Send again in ${resendIn}s` : 'Send a new code'}
      </Button>
    </form>
  )
}
