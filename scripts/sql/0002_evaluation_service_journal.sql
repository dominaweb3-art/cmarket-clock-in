-- SHARED: evaluation-only privileged-operation journal. No production schema.
BEGIN;
ALTER TABLE c3_eval.owner_effect_receipts DROP CONSTRAINT owner_effect_receipts_lifecycle_stage_check;
ALTER TABLE c3_eval.owner_effect_receipts ADD CONSTRAINT owner_effect_receipts_lifecycle_stage_check
 CHECK(lifecycle_stage IN ('funded','active','redemption_requested','redeemed','buying','selling'));
CREATE TABLE c3_eval.provisioning_slots (
  slot smallint PRIMARY KEY CHECK(slot BETWEEN 1 AND 50),
  wallet text NOT NULL UNIQUE CHECK(wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  challenge_id uuid NOT NULL REFERENCES c3_eval.wallet_proofs(challenge_id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE c3_eval.service_packets (
  operation_id text PRIMARY KEY CHECK(operation_id ~ '^[a-f0-9]{64}$'),
  scope text NOT NULL CHECK(length(scope) BETWEEN 1 AND 160),
  purpose text NOT NULL CHECK(purpose IN ('assets','wallet','faucet','plan','authorize','execute','record')),
  signer text NOT NULL CHECK(signer IN (
    '6zjEHckd2nM4bMYwnisS2quE1Zw8VYZTqhwWjM6mtQC',
    'AKjLi6aSrQLTTnRSzshCEhXfjxhRM6fTdDGvi6suNTk7',
    'FUfbAJQMsm6fvmdfduNLBDDZajjZTSmjhaKq6Eew3tZq')),
  message_hash bytea NOT NULL CHECK(octet_length(message_hash)=32),
  unsigned_packet bytea NOT NULL CHECK(octet_length(unsigned_packet) BETWEEN 100 AND 1232),
  last_valid_height bigint NOT NULL CHECK(last_valid_height>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE c3_eval.service_submissions (
  operation_id text PRIMARY KEY REFERENCES c3_eval.service_packets(operation_id),
  signature text NOT NULL UNIQUE CHECK(signature ~ '^[1-9A-HJ-NP-Za-km-z]{64,96}$'),
  signed_message_hash bytea NOT NULL CHECK(octet_length(signed_message_hash)=32),
  -- Recording dispatch precedes broadcasting. Lost process/reply never retries.
  dispatch_recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE c3_eval.service_contexts (
  operation_id text PRIMARY KEY REFERENCES c3_eval.service_packets(operation_id),
  intent_id uuid NOT NULL REFERENCES c3_eval.intents(intent_id),
  db_revision bigint NOT NULL CHECK(db_revision>0),
  chain_revision bigint NOT NULL CHECK(chain_revision>=0),
  context jsonb NOT NULL CHECK(jsonb_typeof(context)='object'),
  context_hash bytea NOT NULL CHECK(octet_length(context_hash)=32),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX evaluation_service_intent_order ON c3_eval.service_contexts(intent_id,created_at);
CREATE TABLE c3_eval.service_receipts (
  operation_id text PRIMARY KEY REFERENCES c3_eval.service_submissions(operation_id),
  finalized_slot bigint NOT NULL CHECK(finalized_slot>0),
  outcome text NOT NULL CHECK(outcome IN ('effects_verified','failed')),
  evidence_hash bytea NOT NULL CHECK(octet_length(evidence_hash)=32),
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- Explicit owner renewal retires only a proven unexecuted old reservation.
-- Original packets, signatures and receipts are never removed or overwritten.
CREATE TABLE c3_eval.service_retirements (
  operation_id text PRIMARY KEY REFERENCES c3_eval.service_contexts(operation_id),
  intent_id uuid NOT NULL,
  plan text NOT NULL,
  generation bigint NOT NULL,
  evidence_hash bytea NOT NULL CHECK(octet_length(evidence_hash)=32),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(intent_id,plan,generation) REFERENCES c3_eval.plan_generations(intent_id,plan,generation)
);
CREATE TABLE c3_eval.evaluation_renewal_contexts (
  request_id uuid PRIMARY KEY REFERENCES c3_eval.renewal_requests(request_id),
  direction smallint NOT NULL CHECK(direction IN (1,2)),
  retired_operations jsonb NOT NULL CHECK(jsonb_typeof(retired_operations)='array'),
  barrier_slot bigint NOT NULL CHECK(barrier_slot>0),
  evidence_hash bytea NOT NULL CHECK(octet_length(evidence_hash)=32)
);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['provisioning_slots','service_packets','service_submissions','service_contexts','service_receipts','service_retirements','evaluation_renewal_contexts'] LOOP
    EXECUTE format('ALTER TABLE c3_eval.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON c3_eval.%I FROM PUBLIC,anon,authenticated',t);
    EXECUTE format('CREATE TRIGGER immutable_evaluation_journal BEFORE UPDATE OR DELETE ON c3_eval.%I FOR EACH ROW EXECUTE FUNCTION c3_eval.reject_immutable()',t);
  END LOOP;
END $$;
COMMIT;
