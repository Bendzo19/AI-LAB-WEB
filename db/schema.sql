-- ============================================================
-- AI LAB WEB : Discord account linking + subscription roles
-- PostgreSQL
-- ============================================================

-- Your existing users table is assumed to look roughly like this.
-- If you already have one, only run the ALTER/CREATE parts below it.
CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 1) Discord account link (one Discord account <-> one website user)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS discord_links (
  user_id            BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

  -- Discord snowflakes are 64-bit; store as TEXT to avoid JS precision loss.
  discord_id         TEXT        NOT NULL,
  discord_username   TEXT,
  discord_avatar     TEXT,

  -- OAuth tokens. Needed for `guilds.join` (auto-add to server).
  -- Encrypt at rest if your threat model requires it.
  access_token       TEXT,
  refresh_token      TEXT,
  token_expires_at   TIMESTAMPTZ,

  linked_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One Discord account cannot be linked to two website accounts.
  CONSTRAINT discord_links_discord_id_key UNIQUE (discord_id)
);

CREATE INDEX IF NOT EXISTS discord_links_discord_id_idx ON discord_links (discord_id);

-- ------------------------------------------------------------
-- 2) Subscription state (source of truth for "has paid")
-- ------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE subscription_status AS ENUM
    ('active', 'trialing', 'past_due', 'canceled', 'incomplete', 'unpaid');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS subscriptions (
  id                     BIGSERIAL PRIMARY KEY,
  user_id                BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider               TEXT   NOT NULL DEFAULT 'stripe',
  provider_customer_id   TEXT,
  provider_subscription_id TEXT UNIQUE,
  status                 subscription_status NOT NULL,
  current_period_end     TIMESTAMPTZ,
  cancel_at_period_end   BOOLEAN NOT NULL DEFAULT false,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscriptions_user_id_idx ON subscriptions (user_id);

-- A user "has an active subscription" if ANY row is active/trialing
-- and the period has not ended.
CREATE OR REPLACE VIEW v_active_subscribers AS
SELECT DISTINCT s.user_id
FROM subscriptions s
WHERE s.status IN ('active', 'trialing')
  AND (s.current_period_end IS NULL OR s.current_period_end > now());

-- ------------------------------------------------------------
-- 3) Audit log of role grants/revokes (debugging + support)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS discord_role_events (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  discord_id  TEXT NOT NULL,
  role_id     TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('grant', 'revoke', 'join')),
  reason      TEXT,
  success     BOOLEAN NOT NULL,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS discord_role_events_discord_id_idx
  ON discord_role_events (discord_id, created_at DESC);

-- ------------------------------------------------------------
-- Handy query: who SHOULD have the role vs who is linked
-- ------------------------------------------------------------
-- SELECT dl.discord_id,
--        (a.user_id IS NOT NULL) AS should_have_role
-- FROM discord_links dl
-- LEFT JOIN v_active_subscribers a ON a.user_id = dl.user_id;
