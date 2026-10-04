// Read-only queries for evaluation (user fairdrop_ro).
export async function withDb(url, fn) {
  const pg = (await import('pg')).default;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function entryEmails(client, dropId) {
  const r = await client.query(
    'SELECT e.id, u.email FROM entries e JOIN users u ON u.id = e.user_id WHERE e.drop_id = $1',
    [dropId]
  );
  return r.rows;
}

export async function guarantees(client, dropId, seats) {
  const r = await client.query(
    `SELECT
       (SELECT count(*) FROM seat_slots WHERE drop_id = $1) AS slots,
       (SELECT count(*) FROM seat_slots WHERE drop_id = $1 AND state = 'CONFIRMED') AS confirmed,
       (SELECT count(*) FROM (SELECT anchor_hash FROM seat_slots
          WHERE drop_id = $1 AND anchor_hash IS NOT NULL
          GROUP BY anchor_hash HAVING count(*) > 1) t) AS card_dups,
       (SELECT count(*) FROM (SELECT user_id FROM entries
          WHERE drop_id = $1 GROUP BY user_id HAVING count(*) > 1) t) AS user_dups`,
    [dropId]
  );
  const row = r.rows[0];
  return {
    oversoldSeats: Math.max(0, Number(row.slots) - seats, Number(row.confirmed) - seats),
    cardsWithTwoSeats: Number(row.card_dups),
    usersWithTwoEntries: Number(row.user_dups),
  };
}
