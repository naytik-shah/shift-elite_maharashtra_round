CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            text NOT NULL,
  normalised_email text NOT NULL UNIQUE,
  role             text NOT NULL DEFAULT 'participant' CHECK (role IN ('participant', 'organiser')),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE drops (
  id                  text PRIMARY KEY,
  name                text NOT NULL,
  seats               int  NOT NULL CHECK (seats > 0),
  state               text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN', 'CLOSED', 'DRAWN', 'COMPLETE')),
  window_opens_at     timestamptz NOT NULL,
  window_closes_at    timestamptz NOT NULL,
  draw_at             timestamptz NOT NULL,
  confirm_window_min  int  NOT NULL CHECK (confirm_window_min > 0),
  ticket_price        int  NOT NULL,
  seed_commit         text NOT NULL,
  manifest_hash       text,
  seed_revealed       text,
  -- highest rank already handed a seat; waitlist position = rank - cursor_rank
  cursor_rank         int  NOT NULL DEFAULT 0,
  scoring_started_at  timestamptz,
  scored_at           timestamptz,
  category            text,
  venue               text,
  city                text,
  description         text,
  event_at            timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE drop_secrets (
  drop_id text PRIMARY KEY REFERENCES drops(id),
  seed    text NOT NULL
);

CREATE TABLE entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_id        text NOT NULL REFERENCES drops(id),
  user_id        uuid NOT NULL REFERENCES users(id),
  device_fp      text,
  ip             inet,
  subnet         text,
  pow_server_ms  int,
  created_at     timestamptz NOT NULL DEFAULT now(),
  state          text NOT NULL DEFAULT 'ENTERED'
                 CHECK (state IN ('ENTERED', 'WON', 'WAITLISTED', 'CONFIRMED', 'EXPIRED', 'NOT_SELECTED')),
  risk           smallint,
  weight         numeric(4,2) NOT NULL DEFAULT 1.00 CHECK (weight > 0 AND weight <= 1),
  rank           int,
  UNIQUE (drop_id, user_id)
);
CREATE INDEX entries_drop_state_rank ON entries (drop_id, state, rank);
CREATE INDEX entries_drop_fp ON entries (drop_id, device_fp);
CREATE INDEX entries_drop_subnet ON entries (drop_id, subnet);

CREATE TABLE seat_slots (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_id      text NOT NULL REFERENCES drops(id),
  slot_no      int  NOT NULL,
  entry_id     uuid NOT NULL REFERENCES entries(id),
  state        text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING', 'CONFIRMED', 'UNFILLED')),
  confirm_by   timestamptz NOT NULL,
  anchor_hash  text,
  payer_name   text,
  confirmed_at timestamptz,
  UNIQUE (drop_id, slot_no),
  UNIQUE (drop_id, entry_id),
  UNIQUE (drop_id, anchor_hash)
);
CREATE INDEX seat_slots_expiry ON seat_slots (state, confirm_by);

CREATE TABLE tickets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id        uuid NOT NULL UNIQUE REFERENCES seat_slots(id),
  holder_user_id uuid NOT NULL REFERENCES users(id),
  payer_name     text NOT NULL,
  issued_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tickets_holder ON tickets (holder_user_id);

CREATE TABLE risk_signals (
  entry_id     uuid PRIMARY KEY REFERENCES entries(id),
  device       real NOT NULL,
  ip           real NOT NULL,
  timing       real NOT NULL,
  email        real NOT NULL,
  cluster_id   text,
  cluster_size int,
  reasons      jsonb NOT NULL DEFAULT '[]',
  linked       jsonb NOT NULL DEFAULT '[]',
  scored_at    timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE audit_seq;

CREATE TABLE audit_log (
  seq       bigint PRIMARY KEY,
  drop_id   text,
  type      text NOT NULL,
  payload   text NOT NULL,
  at        timestamptz NOT NULL DEFAULT now(),
  prev_hash char(64) NOT NULL,
  hash      char(64) NOT NULL
);
CREATE INDEX audit_log_drop ON audit_log (drop_id, seq);

CREATE TABLE sim_runs (
  run_id      text PRIMARY KEY,
  scenario    text NOT NULL,
  payload     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
