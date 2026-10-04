import json
import os

import pandas as pd
import psycopg

CHUNK = 10000

ENTRY_QUERY = """
SELECT e.id::text AS id, e.user_id::text AS user_id, e.device_fp, host(e.ip) AS ip,
       e.pow_server_ms, e.created_at, u.normalised_email AS email
FROM entries e JOIN users u ON u.id = e.user_id
WHERE e.drop_id = %s
"""


def connect(url=None):
    return psycopg.connect(url or os.environ["DATABASE_URL"])


def drop_state(conn, drop_id):
    row = conn.execute("SELECT state FROM drops WHERE id = %s", (drop_id,)).fetchone()
    return row[0] if row else None


def load_entries(conn, drop_id):
    cur = conn.execute(ENTRY_QUERY, (drop_id,))
    cols = [c.name for c in cur.description]
    return pd.DataFrame(cur.fetchall(), columns=cols)


def write_results(conn, res):
    """Bulk update entries and upsert risk_signals in one transaction."""
    ids = res["id"].tolist()
    for s in range(0, len(ids), CHUNK):
        e = s + CHUNK
        part = res.iloc[s:e]
        conn.execute(
            """UPDATE entries e SET risk = t.risk, weight = t.weight
               FROM unnest(%s::uuid[], %s::smallint[], %s::numeric[]) AS t(id, risk, weight)
               WHERE e.id = t.id""",
            (part["id"].tolist(), part["risk"].tolist(), part["weight"].tolist()),
        )
        conn.execute(
            """INSERT INTO risk_signals
                 (entry_id, device, ip, timing, email, cluster_id, cluster_size, reasons, linked)
               SELECT entry_id, device, ip, timing, email, cluster_id, cluster_size,
                      reasons::jsonb, linked::jsonb
               FROM unnest(%s::uuid[], %s::real[], %s::real[], %s::real[], %s::real[],
                           %s::text[], %s::int[], %s::text[], %s::text[])
                    AS t(entry_id, device, ip, timing, email, cluster_id, cluster_size, reasons, linked)
               ON CONFLICT (entry_id) DO UPDATE SET
                 device = EXCLUDED.device, ip = EXCLUDED.ip, timing = EXCLUDED.timing,
                 email = EXCLUDED.email, cluster_id = EXCLUDED.cluster_id,
                 cluster_size = EXCLUDED.cluster_size, reasons = EXCLUDED.reasons,
                 linked = EXCLUDED.linked, scored_at = now()""",
            (
                part["id"].tolist(),
                part["device"].tolist(), part["ip"].tolist(),
                part["timing"].tolist(), part["email"].tolist(),
                [None if c is None else str(c) for c in part["cluster_id"]],
                part["cluster_size"].tolist(),
                [json.dumps(r) for r in part["reasons"]],
                [json.dumps(l) for l in part["linked"]],
            ),
        )
    conn.commit()
