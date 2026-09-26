-- Forward-only disabled owner-pilot records. No vault, owner or signer is provisioned here.
CREATE TABLE c3.c3_pilot_intents (
  intent_id text PRIMARY KEY CHECK (intent_id ~ '^c3p-[a-f0-9]{32}$'),
  kind text NOT NULL CHECK (kind IN ('deposit','redemption')),
  linked_deposit_id text REFERENCES c3.c3_pilot_intents(intent_id) ON DELETE RESTRICT,
  wallet text NOT NULL CHECK (wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  cluster text NOT NULL DEFAULT 'mainnet-beta' CHECK (cluster='mainnet-beta'),
  vault text NOT NULL CHECK (vault ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  share_mint text NOT NULL CHECK (share_mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  amount_base_units numeric(20,0) NOT NULL CHECK (amount_base_units > 0 AND amount_base_units <= 18446744073709551615),
  configuration_hash text NOT NULL CHECK (configuration_hash ~ '^[a-f0-9]{64}$'),
  state text NOT NULL CHECK (state IN (
    'draft','awaiting_wallet','deposit_tx_1_approved','deposit_tx_1_submitted',
    'deposit_tx_1_confirmed','deposit_tx_2_awaiting_wallet','deposit_tx_2_approved',
    'deposit_tx_2_submitted','intent_submitted','vault_processing','shares_issued','active',
    'redemption_draft','redemption_awaiting_wallet','redemption_approved',
    'redemption_submitted','shares_locked_or_burned','rebalance_pending',
    'usdc_claimable','claim_awaiting_wallet','claim_approved','claim_submitted',
    'usdc_received','completed','cancelled','expired','failed_recoverable',
    'manual_review','partially_completed')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  manual_review_reason text CHECK (length(manual_review_reason) <= 128),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  CHECK (updated_at >= created_at AND expires_at > created_at),
  CHECK ((kind='deposit' AND linked_deposit_id IS NULL AND amount_base_units=1000000
            AND state IN ('draft','awaiting_wallet','deposit_tx_1_approved','deposit_tx_1_submitted',
              'deposit_tx_1_confirmed','deposit_tx_2_awaiting_wallet','deposit_tx_2_approved',
              'deposit_tx_2_submitted','intent_submitted','vault_processing','shares_issued',
              'active','cancelled','expired','failed_recoverable','manual_review','partially_completed'))
      OR (kind='redemption' AND linked_deposit_id IS NOT NULL
            AND state IN ('redemption_draft','redemption_awaiting_wallet','redemption_approved',
              'redemption_submitted','shares_locked_or_burned','rebalance_pending',
              'usdc_claimable','claim_awaiting_wallet','claim_approved','claim_submitted',
              'usdc_received','completed','cancelled','expired','failed_recoverable',
              'manual_review','partially_completed'))),
  CHECK (state <> 'manual_review' OR manual_review_reason IS NOT NULL)
);

-- First pilot cannot reserve more than one deposit/withdrawal. Active deposit
-- remains reserved until a later, independently reviewed closure migration.
CREATE UNIQUE INDEX c3_pilot_one_deposit ON c3.c3_pilot_intents(kind)
  WHERE kind='deposit' AND state NOT IN ('cancelled','expired');
CREATE UNIQUE INDEX c3_pilot_one_redemption ON c3.c3_pilot_intents(kind)
  WHERE kind='redemption' AND state NOT IN ('cancelled','expired');
CREATE INDEX c3_pilot_wallet_activity ON c3.c3_pilot_intents(wallet,created_at DESC);

CREATE FUNCTION c3.c3_guard_pilot_redemption_source() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog,c3,pg_temp AS $$
DECLARE source_record c3.c3_pilot_intents%ROWTYPE;
BEGIN
  IF NEW.kind='redemption' THEN
    SELECT * INTO source_record FROM c3.c3_pilot_intents
      WHERE intent_id=NEW.linked_deposit_id FOR UPDATE;
    IF NOT FOUND OR source_record.kind <> 'deposit' OR source_record.state <> 'active'
      OR source_record.wallet <> NEW.wallet OR source_record.vault <> NEW.vault
      OR source_record.share_mint <> NEW.share_mint THEN
      RAISE EXCEPTION 'C3 pilot redemption source is not verified';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER c3_pilot_redemption_source BEFORE INSERT ON c3.c3_pilot_intents
  FOR EACH ROW EXECUTE FUNCTION c3.c3_guard_pilot_redemption_source();

CREATE TABLE c3.c3_pilot_events (
  event_id uuid PRIMARY KEY,
  intent_id text NOT NULL REFERENCES c3.c3_pilot_intents(intent_id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL UNIQUE CHECK (idempotency_key ~ '^[a-f0-9]{64}$'),
  revision bigint NOT NULL CHECK (revision > 0),
  from_state text,
  to_state text NOT NULL,
  actor_kind text NOT NULL CHECK (actor_kind IN ('system','wallet','keeper','reconciler','reviewer')),
  authorization_fingerprint text CHECK (authorization_fingerprint ~ '^[a-f0-9]{64}$'),
  signature text CHECK (signature ~ '^[1-9A-HJ-NP-Za-km-z]{64,96}$'),
  finalized_evidence_hash text CHECK (finalized_evidence_hash ~ '^[a-f0-9]{64}$'),
  safe_reason_code text CHECK (length(safe_reason_code) <= 128),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (intent_id,revision)
);
CREATE INDEX c3_pilot_events_intent ON c3.c3_pilot_events(intent_id,revision);
CREATE UNIQUE INDEX c3_pilot_signature_stage ON c3.c3_pilot_events(intent_id,to_state,signature)
  WHERE signature IS NOT NULL;

CREATE TABLE c3.c3_pilot_outbox (
  event_id uuid PRIMARY KEY REFERENCES c3.c3_pilot_events(event_id) ON DELETE RESTRICT,
  intent_id text NOT NULL REFERENCES c3.c3_pilot_intents(intent_id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','delivered','dead_letter')),
  delivery_attempts smallint NOT NULL DEFAULT 0 CHECK (delivery_attempts BETWEEN 0 AND 5),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER c3_pilot_events_immutable BEFORE UPDATE OR DELETE ON c3.c3_pilot_events
  FOR EACH ROW EXECUTE FUNCTION c3.c3_reject_immutable_change();

CREATE FUNCTION c3.c3_guard_pilot_intent_update() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog,c3,pg_temp AS $$
BEGIN
  IF OLD.intent_id IS DISTINCT FROM NEW.intent_id OR OLD.kind IS DISTINCT FROM NEW.kind
    OR OLD.linked_deposit_id IS DISTINCT FROM NEW.linked_deposit_id
    OR OLD.wallet IS DISTINCT FROM NEW.wallet OR OLD.cluster IS DISTINCT FROM NEW.cluster
    OR OLD.vault IS DISTINCT FROM NEW.vault OR OLD.share_mint IS DISTINCT FROM NEW.share_mint
    OR OLD.amount_base_units IS DISTINCT FROM NEW.amount_base_units
    OR OLD.configuration_hash IS DISTINCT FROM NEW.configuration_hash
    OR OLD.created_at IS DISTINCT FROM NEW.created_at OR OLD.expires_at IS DISTINCT FROM NEW.expires_at
    OR NEW.revision <> OLD.revision+1 THEN
    RAISE EXCEPTION 'C3 pilot immutable intent or revision violated';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER c3_pilot_guard BEFORE UPDATE ON c3.c3_pilot_intents
  FOR EACH ROW EXECUTE FUNCTION c3.c3_guard_pilot_intent_update();
CREATE TRIGGER c3_pilot_no_delete BEFORE DELETE ON c3.c3_pilot_intents
  FOR EACH ROW EXECUTE FUNCTION c3.c3_reject_immutable_change();
