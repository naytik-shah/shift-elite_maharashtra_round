import type { DrawInfo, Drop } from '@/api'
import { isDrawn } from '@/lib/eventStatus'
import { href } from '@/lib/router'
import CopyRow from './CopyRow'
import { Button } from './ui/button'
import { Rows, SectionTitle } from './ui/card'

export default function FairnessCard({ drop, draw }: { drop: Drop; draw?: DrawInfo | null }) {
  const drawn = isDrawn(drop)
  return (
    <section>
      <SectionTitle>Fair draw</SectionTitle>
      <Rows>
        <CopyRow label="Seed hash" value={draw?.seedCommit ?? drop.seedCommit} pending="Loading" />
        {drawn && <CopyRow label="Revealed seed" value={draw?.seed} pending="Loading" />}
      </Rows>
      {drawn ? (
        <Button asChild variant="tinted" size="lg" className="mt-3 w-full">
          <a href={href('verify', drop.id)}>Verify the draw</a>
        </Button>
      ) : (
        <p className="type-caption mt-2 px-1">Published before the draw. The seed is revealed after, so anyone can run the draw again.</p>
      )}
    </section>
  )
}
