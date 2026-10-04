import { Check, Fingerprint, Gauge, Hand, Layers, ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card, SectionTitle } from '@/components/ui/card'
import { useProtection } from '@/lib/protection'

function Row({ icon, title, body, live }: { icon: ReactNode; title: string; body: string; live?: string }) {
  return (
    <li className="flex gap-3 py-3">
      <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-fill text-ink">{icon}</span>
      <div className="min-w-0">
        <p className="type-strong">{title}</p>
        <p className="type-body">{body}</p>
        {live && (
          <p className="type-caption mt-1 inline-flex items-center gap-1 text-ok">
            <Check className="size-3.5" strokeWidth={3} /> {live}
          </p>
        )}
      </div>
    </li>
  )
}

// Explains the defences in plain words and shows what the current session has actually been through.
export default function ProtectionsCard() {
  const p = useProtection()
  return (
    <section>
      <SectionTitle>How bots are kept out</SectionTitle>
      <Card className="py-1 sm:py-1">
        <ul className="divide-y divide-line">
          <Row
            icon={<Layers className="size-4" />}
            title="Speed does not help"
            body="Everyone who enters during the window has the same chance. Arriving first gains nothing."
          />
          <Row
            icon={<Hand className="size-4" />}
            title="Human check"
            body="A short drag puzzle before you log in or enter. It also looks at how the piece was moved."
            live={p.humanCheck ? `Passed this session, ${p.humanCheck.method === 'drag' ? `${(p.humanCheck.ms / 1000).toFixed(1)} s of dragging` : 'by keyboard'}` : undefined}
          />
          <Row
            icon={<ShieldCheck className="size-4" />}
            title="Puzzle in your browser"
            body="Your device solves a small maths puzzle for every login and entry. One person barely notices, thousands of fake accounts get expensive."
            live={p.pow ? `${p.powCount} solved, last one ${p.pow.bits} bits in ${p.pow.ms} ms` : undefined}
          />
          <Row
            icon={<Gauge className="size-4" />}
            title="Rate limits"
            body="Repeated requests from one address or network are slowed down."
            live={p.rateLimitHits ? `Slowed down ${p.rateLimitHits} time${p.rateLimitHits === 1 ? '' : 's'} this session` : undefined}
          />
          <Row
            icon={<Fingerprint className="size-4" />}
            title="Cluster scoring"
            body="After entries close, accounts that share devices, networks, timing or email patterns get a lower weight. Nobody is banned."
          />
          <Row
            icon={<Check className="size-4" />}
            title="One card, one seat"
            body="Each payment card can confirm only one seat, and the ticket carries your name."
          />
        </ul>
      </Card>
    </section>
  )
}
