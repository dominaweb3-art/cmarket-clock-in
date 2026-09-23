-- Forward-only C3 state schema. No transaction payloads or wallet secrets.
CREATE SCHEMA c3;
SET LOCAL search_path = c3, pg_catalog, pg_temp;
CREATE TABLE c3_intents (
  intent_id text PRIMARY KEY CHECK (intent_id ~ '^c3-[a-f0-9]{32,64}$'),
  idempotency_key text NOT NULL UNIQUE CHECK (idempotency_key ~ '^[a-f0-9]{64}$'),
  configuration_version text NOT NULL,
  configuration_hash text NOT NULL CHECK (configuration_hash ~ '^[a-f0-9]{64}$'),
  cluster text NOT NULL CHECK (cluster = 'mainnet-beta'),
  wallet text NOT NULL CHECK (wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  operation text NOT NULL CHECK (operation IN ('seed_deposit','deposit_intent','rebalance_intent','redemption_intent','usdc_withdrawal','emergency_pause')),
  input_amount numeric(20,0) NOT NULL CHECK (input_amount > 0 AND input_amount <= 18446744073709551615),
  state text NOT NULL CHECK (state IN ('draft','awaiting_wallet','intent_submitted','keeper_pending','partially_completed','settled','failed_recoverable','manual_review','cancelled','expired')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  authorization_id uuid,
  authorization_hash text CHECK (authorization_hash ~ '^[a-f0-9]{64}$'),
  submitted_signature text CHECK (submitted_signature ~ '^[1-9A-HJ-NP-Za-km-z]{64,96}$'),
  settled_effects_hash text CHECK (settled_effects_hash ~ '^[a-f0-9]{64}$'),
  partial_completion_hash text CHECK (partial_completion_hash ~ '^[a-f0-9]{64}$'),
  manual_review_reason text,
  recovery_attempts smallint NOT NULL DEFAULT 0 CHECK (recovery_attempts BETWEEN 0 AND 3),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  CHECK (updated_at >= created_at AND expires_at > created_at),
  CHECK ((authorization_id IS NULL) = (authorization_hash IS NULL)),
  CHECK (state NOT IN ('intent_submitted','keeper_pending','partially_completed','settled') OR (authorization_id IS NOT NULL AND submitted_signature IS NOT NULL)),
  CHECK (state <> 'failed_recoverable' OR (authorization_id IS NOT NULL AND submitted_signature IS NOT NULL)),
  CHECK (state <> 'settled' OR settled_effects_hash IS NOT NULL),
  CHECK (state <> 'partially_completed' OR partial_completion_hash IS NOT NULL),
  CHECK (state <> 'manual_review' OR manual_review_reason IS NOT NULL)
);

CREATE TABLE c3_authorizations (
  authorization_id uuid PRIMARY KEY,
  intent_id text NOT NULL REFERENCES c3_intents(intent_id) ON DELETE RESTRICT,
  intent_revision bigint NOT NULL CHECK (intent_revision > 0),
  authorization_hash text NOT NULL CHECK (authorization_hash ~ '^[a-f0-9]{64}$'),
  canonical_json text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (intent_id, intent_revision),
  UNIQUE (intent_id, authorization_hash),
  UNIQUE (intent_id, authorization_id, authorization_hash)
);
ALTER TABLE c3_intents ADD CONSTRAINT c3_intent_authorization_binding
  FOREIGN KEY (intent_id, authorization_id, authorization_hash)
  REFERENCES c3_authorizations(intent_id, authorization_id, authorization_hash) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE c3_idempotency_keys (
  key_hash text PRIMARY KEY CHECK (key_hash ~ '^[a-f0-9]{64}$'),
  intent_id text NOT NULL UNIQUE REFERENCES c3_intents(intent_id) ON DELETE RESTRICT,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE c3_evidence (
  evidence_id uuid PRIMARY KEY,
  intent_id text NOT NULL REFERENCES c3_intents(intent_id) ON DELETE RESTRICT,
  evidence_kind text NOT NULL CHECK (evidence_kind IN ('submission','settlement','share_mint','share_burn','vault_snapshot','manual_review')),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  signature text CHECK (signature ~ '^[1-9A-HJ-NP-Za-km-z]{64,96}$'),
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(safe_metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (intent_id, evidence_kind, fingerprint)
);

CREATE TABLE c3_rpc_observations (
  observation_id uuid PRIMARY KEY,
  intent_id text NOT NULL REFERENCES c3_intents(intent_id) ON DELETE RESTRICT,
  evidence_id uuid REFERENCES c3_evidence(evidence_id) ON DELETE RESTRICT,
  provider_id text NOT NULL,
  operator_id text NOT NULL,
  slot numeric(20,0) CHECK (slot >= 0),
  observation_hash text NOT NULL CHECK (observation_hash ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (intent_id, provider_id, observation_hash)
);

CREATE TABLE c3_reconciled_snapshots (
  snapshot_id uuid PRIMARY KEY,
  intent_id text NOT NULL REFERENCES c3_intents(intent_id) ON DELETE RESTRICT,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[a-f0-9]{64}$'),
  evidence_id uuid NOT NULL REFERENCES c3_evidence(evidence_id) ON DELETE RESTRICT,
  nav_base_units numeric(39,0) NOT NULL CHECK (nav_base_units >= 0 AND nav_base_units <= 340282366920938463463374607431768211455),
  share_supply_base_units numeric(20,0) NOT NULL CHECK (share_supply_base_units >= 0 AND share_supply_base_units <= 18446744073709551615),
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (intent_id, snapshot_hash)
);

CREATE TABLE c3_manifest_events (
  event_id uuid PRIMARY KEY,
  intent_id text REFERENCES c3_intents(intent_id) ON DELETE RESTRICT,
  manifest_hash text NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  previous_hash text CHECK (previous_hash ~ '^[a-f0-9]{64}$'),
  configuration_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('proposed','verified','security_approved','governance_approved','deployment_ready','deployed','paused')),
  revision bigint NOT NULL CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (manifest_hash, revision)
);

CREATE TABLE c3_recovery_attempts (
  attempt_id uuid PRIMARY KEY,
  intent_id text NOT NULL REFERENCES c3_intents(intent_id) ON DELETE RESTRICT,
  attempt_number smallint NOT NULL CHECK (attempt_number BETWEEN 1 AND 3),
  submitted_signature text NOT NULL CHECK (submitted_signature ~ '^[1-9A-HJ-NP-Za-km-z]{64,96}$'),
  evidence_hash text NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (intent_id, attempt_number)
);

CREATE TABLE c3_outbox_events (
  event_id uuid PRIMARY KEY,
  intent_id text NOT NULL REFERENCES c3_intents(intent_id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL UNIQUE CHECK (idempotency_key ~ '^[a-f0-9]{64}$'),
  event_type text NOT NULL CHECK (event_type IN ('state_transition','authorization_created','evidence_registered','reconciliation_decision','recovery_attempt','manifest_transition','configuration_reference')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','delivered','dead_letter')),
  delivery_attempts smallint NOT NULL DEFAULT 0 CHECK (delivery_attempts BETWEEN 0 AND 5),
  lease_until timestamptz,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE c3_audit_log (
  audit_id uuid PRIMARY KEY,
  intent_id text REFERENCES c3_intents(intent_id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('state_transition','authorization_created','evidence_registered','reconciliation_decision','recovery_attempt','manifest_transition','configuration_reference')),
  event_hash text NOT NULL CHECK (event_hash ~ '^[a-f0-9]{64}$'),
  actor_kind text NOT NULL CHECK (actor_kind IN ('system','wallet','keeper','reviewer')),
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(safe_metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION c3.c3_reject_immutable_change() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, c3, pg_temp AS $$
BEGIN RAISE EXCEPTION 'C3 immutable record cannot be updated or deleted'; END;
$$;
CREATE TRIGGER c3_authorizations_immutable BEFORE UPDATE OR DELETE ON c3_authorizations FOR EACH ROW EXECUTE FUNCTION c3.c3_reject_immutable_change();
CREATE TRIGGER c3_idempotency_immutable BEFORE UPDATE OR DELETE ON c3_idempotency_keys FOR EACH ROW EXECUTE FUNCTION c3.c3_reject_immutable_change();
CREATE TRIGGER c3_evidence_immutable BEFORE UPDATE OR DELETE ON c3_evidence FOR EACH ROW EXECUTE FUNCTION c3.c3_reject_immutable_change();
CREATE TRIGGER c3_rpc_observations_immutable BEFORE UPDATE OR DELETE ON c3_rpc_observations FOR EACH ROW EXECUTE FUNCTION c3.c3_reject_immutable_change();
CREATE TRIGGER c3_manifest_events_immutable BEFORE UPDATE OR DELETE ON c3_manifest_events FOR EACH ROW EXECUTE FUNCTION c3.c3_reject_immutable_change();
CREATE TRIGGER c3_recovery_attempts_immutable BEFORE UPDATE OR DELETE ON c3_recovery_attempts FOR EACH ROW EXECUTE FUNCTION c3.c3_reject_immutable_change();
CREATE TRIGGER c3_audit_immutable BEFORE UPDATE OR DELETE ON c3_audit_log FOR EACH ROW EXECUTE FUNCTION c3.c3_reject_immutable_change();

CREATE FUNCTION c3.c3_guard_intent_update() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, c3, pg_temp AS $$
BEGIN
  IF OLD.intent_id IS DISTINCT FROM NEW.intent_id OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key
    OR OLD.configuration_version IS DISTINCT FROM NEW.configuration_version OR OLD.configuration_hash IS DISTINCT FROM NEW.configuration_hash
    OR OLD.cluster IS DISTINCT FROM NEW.cluster OR OLD.wallet IS DISTINCT FROM NEW.wallet
    OR OLD.operation IS DISTINCT FROM NEW.operation OR OLD.input_amount IS DISTINCT FROM NEW.input_amount
    OR OLD.created_at IS DISTINCT FROM NEW.created_at OR OLD.expires_at IS DISTINCT FROM NEW.expires_at
    OR (OLD.authorization_id IS NOT NULL AND OLD.authorization_id IS DISTINCT FROM NEW.authorization_id)
    OR (OLD.authorization_hash IS NOT NULL AND OLD.authorization_hash IS DISTINCT FROM NEW.authorization_hash)
    OR (OLD.submitted_signature IS NOT NULL AND OLD.submitted_signature IS DISTINCT FROM NEW.submitted_signature)
    OR (OLD.settled_effects_hash IS NOT NULL AND OLD.settled_effects_hash IS DISTINCT FROM NEW.settled_effects_hash)
    OR (OLD.partial_completion_hash IS NOT NULL AND OLD.partial_completion_hash IS DISTINCT FROM NEW.partial_completion_hash)
    OR NEW.revision <> OLD.revision + 1 OR NEW.recovery_attempts < OLD.recovery_attempts
    OR NEW.recovery_attempts > OLD.recovery_attempts + 1 THEN
    RAISE EXCEPTION 'C3 intent immutable fields or revision violated';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER c3_intent_guard BEFORE UPDATE ON c3_intents FOR EACH ROW EXECUTE FUNCTION c3.c3_guard_intent_update();
CREATE TRIGGER c3_intent_no_delete BEFORE DELETE ON c3_intents FOR EACH ROW EXECUTE FUNCTION c3.c3_reject_immutable_change();

CREATE INDEX c3_evidence_intent_idx ON c3_evidence(intent_id);
CREATE INDEX c3_rpc_observations_intent_idx ON c3_rpc_observations(intent_id);
CREATE INDEX c3_rpc_observations_evidence_idx ON c3_rpc_observations(evidence_id) WHERE evidence_id IS NOT NULL;
CREATE INDEX c3_snapshots_intent_idx ON c3_reconciled_snapshots(intent_id);
CREATE INDEX c3_snapshots_evidence_idx ON c3_reconciled_snapshots(evidence_id);
CREATE INDEX c3_manifest_events_intent_idx ON c3_manifest_events(intent_id) WHERE intent_id IS NOT NULL;
CREATE INDEX c3_recovery_attempts_intent_idx ON c3_recovery_attempts(intent_id);
CREATE INDEX c3_outbox_pending_idx ON c3_outbox_events(status,lease_until,created_at) WHERE status IN ('pending','processing');
CREATE INDEX c3_outbox_intent_idx ON c3_outbox_events(intent_id);
CREATE INDEX c3_audit_intent_idx ON c3_audit_log(intent_id) WHERE intent_id IS NOT NULL;
CREATE INDEX c3_intents_recovery_idx ON c3_intents(state,updated_at) WHERE state IN ('failed_recoverable','manual_review');
