-- Isolated MOCK_LOCAL_ONLY settlement journal. Never applied by production bootstrap.
CREATE SCHEMA c3_open;
CREATE TABLE c3_open.schema_migrations (
  migration_id text PRIMARY KEY,
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[a-f0-9]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE c3_open.intents (
  intent_id uuid PRIMARY KEY,
  wallet text NOT NULL CHECK (wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  vault text NOT NULL CHECK (vault ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  share_mint text NOT NULL CHECK (share_mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  deposit_plan text NOT NULL UNIQUE CHECK (deposit_plan ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  redemption_plan text UNIQUE CHECK (redemption_plan ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  configuration_hash text NOT NULL CHECK (configuration_hash ~ '^[a-f0-9]{64}$'),
  deposit_amount numeric(20,0) NOT NULL CHECK (deposit_amount = 1000000),
  btc_bps smallint NOT NULL DEFAULT 4000 CHECK (btc_bps = 4000),
  eth_bps smallint NOT NULL DEFAULT 3000 CHECK (eth_bps = 3000),
  sol_bps smallint NOT NULL DEFAULT 3000 CHECK (sol_bps = 3000),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN (
    'draft','funded','buying','active','redemption_requested','selling',
    'claimable','redeemed','expired','cancelled','failed_recoverable',
    'partially_completed','manual_review','paused')),
  chain_revision bigint NOT NULL DEFAULT 0 CHECK (chain_revision >= 0),
  db_revision bigint NOT NULL DEFAULT 1 CHECK (db_revision > 0),
  expires_at timestamptz NOT NULL,
  reason_code text CHECK (reason_code ~ '^[A-Z0-9_]{3,64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (expires_at > created_at),
  CHECK ((state NOT IN ('redemption_requested','selling','claimable','redeemed')
    OR redemption_plan IS NOT NULL)
    AND (state NOT IN ('draft','funded','buying','active') OR redemption_plan IS NULL))
);
CREATE UNIQUE INDEX one_open_owner_pilot ON c3_open.intents (wallet)
  WHERE state NOT IN ('redeemed','expired','cancelled');
CREATE TABLE c3_open.legs (
  intent_id uuid NOT NULL REFERENCES c3_open.intents(intent_id) ON DELETE RESTRICT,
  ordinal smallint NOT NULL CHECK (ordinal BETWEEN 0 AND 5),
  direction text GENERATED ALWAYS AS (CASE WHEN ordinal < 3 THEN 'buy' ELSE 'sell' END) STORED,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN
    ('pending','leased','prepared','signed','submitted','uncertain','confirmed','manual_review')),
  chain_revision bigint NOT NULL DEFAULT 0 CHECK (chain_revision >= 0),
  route_hash text CHECK (route_hash ~ '^[a-f0-9]{64}$'),
  instruction_hash text CHECK (instruction_hash ~ '^[a-f0-9]{64}$'),
  authorization_hash text CHECK (authorization_hash ~ '^[a-f0-9]{64}$'),
  input_mint text CHECK (input_mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  output_mint text CHECK (output_mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  source_account text CHECK (source_account ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  destination_account text CHECK (destination_account ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  input_amount numeric(20,0) CHECK (input_amount > 0),
  minimum_output numeric(20,0) CHECK (minimum_output > 0),
  quote_expires_at timestamptz,
  lease_owner uuid,
  lease_expires_at timestamptz,
  submitted_signature text UNIQUE CHECK (submitted_signature ~ '^[1-9A-HJ-NP-Za-km-z]{64,96}$'),
  submitted_at timestamptz,
  evidence_hash text CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  expected_effects jsonb,
  observed_effects jsonb,
  reason_code text CHECK (reason_code ~ '^[A-Z0-9_]{3,64}$'),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (intent_id,ordinal),
  CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL)),
  CHECK (state NOT IN ('prepared','signed','submitted','uncertain','confirmed')
    OR (route_hash IS NOT NULL AND instruction_hash IS NOT NULL
      AND authorization_hash IS NOT NULL AND minimum_output IS NOT NULL
      AND quote_expires_at IS NOT NULL)),
  CHECK (state NOT IN ('signed','submitted','uncertain','confirmed')
    OR submitted_signature IS NOT NULL),
  CHECK (state <> 'confirmed' OR (evidence_hash IS NOT NULL AND observed_effects IS NOT NULL))
);
CREATE TABLE c3_open.events (
  event_id uuid PRIMARY KEY,
  intent_id uuid NOT NULL REFERENCES c3_open.intents(intent_id) ON DELETE RESTRICT,
  idempotency_hash text NOT NULL UNIQUE CHECK (idempotency_hash ~ '^[a-f0-9]{64}$'),
  db_revision bigint NOT NULL CHECK (db_revision > 0),
  state text NOT NULL,
  ordinal smallint CHECK (ordinal BETWEEN 0 AND 5),
  evidence_hash text CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  safe_reason text CHECK (safe_reason ~ '^[A-Z0-9_]{3,64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (intent_id,db_revision)
);
CREATE TABLE c3_open.outbox (
  event_id uuid PRIMARY KEY REFERENCES c3_open.events(event_id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','manual_review')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION c3_open.reject_immutable() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,c3_open,pg_temp AS $$
BEGIN RAISE EXCEPTION 'C3_OPEN_IMMUTABLE_AUDIT'; END; $$;
CREATE TRIGGER immutable_events BEFORE UPDATE OR DELETE ON c3_open.events
  FOR EACH ROW EXECUTE FUNCTION c3_open.reject_immutable();
CREATE TRIGGER immutable_migrations BEFORE UPDATE OR DELETE ON c3_open.schema_migrations
  FOR EACH ROW EXECUTE FUNCTION c3_open.reject_immutable();
CREATE FUNCTION c3_open.guard_intent() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,c3_open,pg_temp AS $$
BEGIN
  IF OLD.intent_id IS DISTINCT FROM NEW.intent_id OR OLD.wallet IS DISTINCT FROM NEW.wallet
    OR OLD.vault IS DISTINCT FROM NEW.vault OR OLD.share_mint IS DISTINCT FROM NEW.share_mint
    OR OLD.deposit_plan IS DISTINCT FROM NEW.deposit_plan
    OR (OLD.redemption_plan IS NOT NULL AND OLD.redemption_plan IS DISTINCT FROM NEW.redemption_plan)
    OR OLD.configuration_hash IS DISTINCT FROM NEW.configuration_hash
    OR OLD.deposit_amount IS DISTINCT FROM NEW.deposit_amount
    OR OLD.btc_bps IS DISTINCT FROM NEW.btc_bps OR OLD.eth_bps IS DISTINCT FROM NEW.eth_bps
    OR OLD.sol_bps IS DISTINCT FROM NEW.sol_bps OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR NEW.db_revision <> OLD.db_revision + 1
    OR (NEW.chain_revision < OLD.chain_revision
      AND NOT (OLD.state='active' AND NEW.state='redemption_requested'
        AND OLD.redemption_plan IS NULL AND NEW.redemption_plan IS NOT NULL
        AND NEW.chain_revision=0)) THEN
    RAISE EXCEPTION 'C3_OPEN_IMMUTABLE_INTENT';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER guard_intent BEFORE UPDATE ON c3_open.intents
  FOR EACH ROW EXECUTE FUNCTION c3_open.guard_intent();
CREATE TRIGGER no_delete_intent BEFORE DELETE ON c3_open.intents
  FOR EACH ROW EXECUTE FUNCTION c3_open.reject_immutable();
CREATE FUNCTION c3_open.guard_leg() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,c3_open,pg_temp AS $$
BEGIN
  IF OLD.intent_id IS DISTINCT FROM NEW.intent_id OR OLD.ordinal IS DISTINCT FROM NEW.ordinal
    OR (OLD.submitted_signature IS NOT NULL AND OLD.submitted_signature IS DISTINCT FROM NEW.submitted_signature)
    OR (OLD.evidence_hash IS NOT NULL AND OLD.evidence_hash IS DISTINCT FROM NEW.evidence_hash)
    OR (OLD.state='confirmed' AND NEW.state <> 'confirmed') THEN
    RAISE EXCEPTION 'C3_OPEN_IMMUTABLE_LEG';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER guard_leg BEFORE UPDATE ON c3_open.legs
  FOR EACH ROW EXECUTE FUNCTION c3_open.guard_leg();
CREATE TRIGGER no_delete_leg BEFORE DELETE ON c3_open.legs
  FOR EACH ROW EXECUTE FUNCTION c3_open.reject_immutable();
