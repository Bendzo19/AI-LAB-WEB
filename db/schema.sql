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

-- ============================================================
-- AI LAB WEB : generovanie — kredity + fronta úloh
--
-- Prečo to takto vyzerá:
--
-- Stará cesta bola „jeden beh naraz" — na jednom účte u poskytovateľa
-- sa čakalo, kým doprednej úlohe nedôjde. To nie je limit poskytovateľa,
-- to je limit architektúry: request držal spojenie, kým sa negeneruje.
--
-- Tu je generovanie rozdelené na TRI nezávislé kroky, ktoré sa nikdy
-- navzájom neblokujú:
--     1. odoslanie   -> rezervácia kreditov + riadok v generation_jobs
--     2. odoslanie k poskytovateľovi -> uloží sa provider_task_id
--     3. dokončenie  -> callback od poskytovateľa doúčtuje kredity
--
-- Jediné miesto, kde sa čokoľvek serializuje, je riadok credit_accounts
-- JEDNÉHO užívateľa. Dvaja rôzni užívatelia sa nestretnú nikdy, takže
-- 100 ľudí naraz je 100 paralelných behov, nie fronta.
-- ============================================================

-- ------------------------------------------------------------
-- 4) Kreditový účet (jeden riadok na užívateľa)
--
-- `balance`  = voľné kredity, ktoré môže minúť
-- `reserved` = kredity držané pre práve bežiace úlohy (už nie sú voľné,
--              ale ešte nie sú minuté — pri zlyhaní sa vrátia)
--
-- CHECK (balance >= 0) je posledná poistka proti mínusu. Rezervácia sama
-- je jeden UPDATE s podmienkou `balance >= cena`, takže dva súbežné
-- požiadavky toho istého človeka nemôžu minúť tie isté kredity dvakrát —
-- Postgres zamkne riadok a druhý počká pár mikrosekúnd.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credit_accounts (
  user_id        BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance        BIGINT      NOT NULL DEFAULT 0 CHECK (balance  >= 0),
  reserved       BIGINT      NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  lifetime_topup BIGINT      NOT NULL DEFAULT 0,
  lifetime_spent BIGINT      NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 5) Účtovná kniha — append-only, nikdy sa needituje
--
-- `balance_delta`  zmena voľného zostatku
-- `reserved_delta` zmena držanej čiastky
-- `ref`            kľúč idempotencie: to isté `ref` v tom istom `kind`
--                  sa nezapíše dvakrát ani keď webhook príde trikrát
-- ------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE credit_entry_kind AS ENUM
    ('topup', 'grant', 'reserve', 'charge', 'refund', 'adjust');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS credit_ledger (
  id             BIGSERIAL PRIMARY KEY,
  user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind           credit_entry_kind NOT NULL,
  balance_delta  BIGINT NOT NULL,
  reserved_delta BIGINT NOT NULL DEFAULT 0,
  balance_after  BIGINT NOT NULL,
  reserved_after BIGINT NOT NULL,
  job_id         UUID,
  ref            TEXT   NOT NULL,
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT credit_ledger_ref_key UNIQUE (user_id, kind, ref)
);

CREATE INDEX IF NOT EXISTS credit_ledger_user_idx
  ON credit_ledger (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS credit_ledger_job_idx
  ON credit_ledger (job_id);

-- ------------------------------------------------------------
-- 6) Úlohy generovania
--
-- Stavy:
--   queued      čaká na odoslanie (buď hneď, alebo keď sa uvoľní strop)
--   dispatching práve sa odosiela k poskytovateľovi (krátky medzistav,
--               ktorý zabráni dvojitému odoslaniu tej istej úlohy)
--   running     poskytovateľ generuje, čakáme na callback
--   succeeded / failed / canceled  konečné stavy
--
-- `callback_token` je náhodných 32 bajtov. Callback URL ho nesie so sebou
-- a bez zhody sa payload zahodí — inak by hocikto mohol poslať „hotovo"
-- a nechať si doúčtovať cudziu úlohu.
-- ------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE generation_status AS ENUM
    ('queued', 'dispatching', 'running', 'succeeded', 'failed', 'canceled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS generation_jobs (
  id               UUID PRIMARY KEY,
  user_id          BIGINT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status           generation_status NOT NULL DEFAULT 'queued',

  model_id         TEXT    NOT NULL,
  provider         TEXT    NOT NULL,
  provider_model   TEXT    NOT NULL,
  input            JSONB   NOT NULL,

  price_credits    INTEGER NOT NULL CHECK (price_credits >= 0),
  charged_credits  INTEGER,

  provider_task_id TEXT,
  callback_token   TEXT    NOT NULL,

  attempts         SMALLINT    NOT NULL DEFAULT 0,
  next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  result           JSONB,
  error_code       TEXT,
  error_message    TEXT,

  idempotency_key  TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  dispatched_at    TIMESTAMPTZ,
  finished_at      TIMESTAMPTZ
);

-- Dvojité kliknutie na „Generuj" nesmie stáť dvakrát.
CREATE UNIQUE INDEX IF NOT EXISTS generation_jobs_idem_idx
  ON generation_jobs (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Callback od poskytovateľa nájde úlohu podľa jeho vlastného id.
CREATE UNIQUE INDEX IF NOT EXISTS generation_jobs_task_idx
  ON generation_jobs (provider, provider_task_id)
  WHERE provider_task_id IS NOT NULL;

-- Dispatcher berie najstaršie čakajúce (FOR UPDATE SKIP LOCKED).
CREATE INDEX IF NOT EXISTS generation_jobs_queue_idx
  ON generation_jobs (next_attempt_at)
  WHERE status = 'queued';

-- Počítanie rozbehnutých úloh (stropy) a dohľadávanie zabudnutých.
CREATE INDEX IF NOT EXISTS generation_jobs_inflight_idx
  ON generation_jobs (provider, dispatched_at)
  WHERE status IN ('dispatching', 'running');

CREATE INDEX IF NOT EXISTS generation_jobs_user_idx
  ON generation_jobs (user_id, created_at DESC);

-- ------------------------------------------------------------
-- 7) Denník úloh — čo sa s úlohou dialo (podpora + hľadanie príčin)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS generation_events (
  id         BIGSERIAL PRIMARY KEY,
  job_id     UUID NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  detail     JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS generation_events_job_idx
  ON generation_events (job_id, created_at);

-- ------------------------------------------------------------
-- Prevádzkový pohľad: koľko toho práve beží a u koho
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW v_generation_inflight AS
SELECT provider,
       count(*)                                        AS jobs,
       count(DISTINCT user_id)                         AS users,
       min(dispatched_at)                              AS oldest_dispatch
FROM generation_jobs
WHERE status IN ('dispatching', 'running')
GROUP BY provider;

-- Admisia podľa poradia: „koľko rozbehnutých úloh je starších než moja".
-- Bez tohto indexu by sa pri každom odoslaní prechádzali všetky bežiace.
CREATE INDEX IF NOT EXISTS generation_jobs_inflight_poradie_idx
  ON generation_jobs (created_at, id)
  WHERE status IN ('dispatching', 'running');
