// Checks every rule that must hold for a drop at any moment.
// Returns a list of violations; an empty list means everything is fine.
export async function checkInvariants(db, dropId) {
  const bad = [];
  const rows = async (sql) => (await db.query(sql, [dropId])).rows;
  const count = async (sql) => (await rows(sql))[0].n;
  const drop = (await rows('SELECT seats, state, cursor_rank FROM drops WHERE id = $1'))[0];

  const slots = await count('SELECT COUNT(*)::int AS n FROM seat_slots WHERE drop_id = $1');
  if (slots > drop.seats) bad.push(`oversold: ${slots} slots for ${drop.seats} seats`);

  const confirmed = await count("SELECT COUNT(*)::int AS n FROM seat_slots WHERE drop_id = $1 AND state = 'CONFIRMED'");
  if (confirmed > drop.seats) bad.push(`oversold: ${confirmed} confirmed for ${drop.seats} seats`);

  const tickets = await count('SELECT COUNT(*)::int AS n FROM tickets t JOIN seat_slots s ON s.id = t.slot_id WHERE s.drop_id = $1');
  if (tickets !== confirmed) bad.push(`tickets ${tickets} != confirmed slots ${confirmed}`);

  const checks = [
    ["SELECT COUNT(*)::int AS n FROM seat_slots s JOIN entries e ON e.id = s.entry_id WHERE s.drop_id = $1 AND s.state = 'CONFIRMED' AND e.state <> 'CONFIRMED'", 'confirmed slot whose entry is not CONFIRMED'],
    ["SELECT COUNT(*)::int AS n FROM seat_slots s JOIN entries e ON e.id = s.entry_id WHERE s.drop_id = $1 AND s.state = 'PENDING' AND e.state <> 'WON'", 'pending slot whose entry is not WON'],
    ["SELECT COUNT(*)::int AS n FROM entries e WHERE e.drop_id = $1 AND e.state = 'WON' AND NOT EXISTS (SELECT 1 FROM seat_slots s WHERE s.entry_id = e.id AND s.state = 'PENDING')", 'WON entry without a pending slot'],
    ["SELECT COUNT(*)::int AS n FROM entries e WHERE e.drop_id = $1 AND e.state = 'CONFIRMED' AND NOT EXISTS (SELECT 1 FROM seat_slots s WHERE s.entry_id = e.id AND s.state = 'CONFIRMED')", 'CONFIRMED entry without a confirmed slot'],
    ["SELECT COUNT(*)::int AS n FROM entries e WHERE e.drop_id = $1 AND e.state = 'EXPIRED' AND EXISTS (SELECT 1 FROM seat_slots s WHERE s.entry_id = e.id AND s.state IN ('PENDING','CONFIRMED'))", 'EXPIRED entry still holds a live slot'],
    ["SELECT COUNT(*)::int AS n FROM seat_slots WHERE drop_id = $1 AND state = 'CONFIRMED' AND (anchor_hash IS NULL OR payer_name IS NULL)", 'confirmed slot without card or name'],
    ['SELECT COUNT(*)::int AS n FROM (SELECT anchor_hash FROM seat_slots WHERE drop_id = $1 AND anchor_hash IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1) x', 'card used on two seats'],
    ['SELECT COUNT(*)::int AS n FROM (SELECT user_id FROM entries WHERE drop_id = $1 GROUP BY 1 HAVING COUNT(*) > 1) x', 'user with two entries'],
    ["SELECT COUNT(*)::int AS n FROM entries WHERE drop_id = $1 AND state = 'ENTERED' AND rank IS NOT NULL", 'undrawn entry with a rank'],
  ];
  for (const [sql, label] of checks) {
    const n = await count(sql);
    if (n) bad.push(`${label}: ${n}`);
  }

  // The waitlist leaves strictly in rank order: everything at or below the cursor has left it,
  // everything above is still waiting (until the drop completes).
  if (drop.state === 'DRAWN') {
    const early = await count("SELECT COUNT(*)::int AS n FROM entries WHERE drop_id = $1 AND state = 'WAITLISTED' AND rank <= (SELECT cursor_rank FROM drops WHERE id = $1)");
    if (early) bad.push(`waitlisted entries at or below the cursor: ${early}`);
    const skipped = await count("SELECT COUNT(*)::int AS n FROM entries WHERE drop_id = $1 AND state IN ('WON','CONFIRMED','EXPIRED') AND rank > (SELECT cursor_rank FROM drops WHERE id = $1)");
    if (skipped) bad.push(`seat holders above the cursor (waitlist order broken): ${skipped}`);
  }
  return bad;
}
