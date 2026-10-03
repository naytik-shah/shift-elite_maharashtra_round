import { useState } from 'react'
import { api, type Session } from '../api'

export default function Register({ onDone }: { onDone: (s: Session) => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      onDone(await api.register(name.trim(), email.trim()))
    } catch {
      setError('Could not register right now. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <h2 className="text-xl font-semibold">Join the drop</h2>
      <p className="text-sm text-indigo-200">
        Everyone who enters before the window closes has the same chance. Being fast does not help.
      </p>
      <label className="block text-sm">
        Name
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-lg bg-white/10 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-400"
        />
      </label>
      <label className="block text-sm">
        Email
        <input
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-lg bg-white/10 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-400"
        />
      </label>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <button
        disabled={busy}
        className="w-full rounded-lg bg-indigo-500 py-3 font-medium disabled:opacity-60"
      >
        {busy ? 'Registering...' : 'Register'}
      </button>
    </form>
  )
}
