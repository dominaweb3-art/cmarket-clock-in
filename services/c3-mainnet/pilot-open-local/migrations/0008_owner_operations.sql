-- Additive owner journal. Public hashes/signatures only; no payloads or keys.
CREATE TABLE c3_open.owner_requests (
  request_id uuid PRIMARY KEY,
  intent_id uuid NOT NULL REFERENCES c3_open.intents(intent_id),
  action text NOT NULL CHECK (action IN ('deposit','issue_shares','request_redemption','claim')),
  expected_db_revision bigint NOT NULL CHECK (expected_db_revision > 0),
  expected_chain_revision bigint NOT NULL CHECK (expected_chain_revision >= 0),
  message_hash bytea NOT NULL CHECK (octet_length(message_hash)=32),
  blockhash text NOT NULL,
  last_valid_height bigint NOT NULL CHECK (last_valid_height > 0),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(intent_id,action)
);
CREATE TABLE c3_open.owner_submissions (
  request_id uuid PRIMARY KEY REFERENCES c3_open.owner_requests(request_id),
  signature text NOT NULL UNIQUE CHECK (signature ~ '^[1-9A-HJ-NP-Za-km-z]{64,96}$'),
  message_hash bytea NOT NULL CHECK (octet_length(message_hash)=32),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- A finalized MESSAGE is not a verified economic effect or lifecycle promotion.
CREATE TABLE c3_open.owner_message_receipts (
  request_id uuid PRIMARY KEY REFERENCES c3_open.owner_submissions(request_id),
  slot bigint NOT NULL CHECK (slot > 0),
  evidence_hash bytea NOT NULL CHECK (octet_length(evidence_hash)=32),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE c3_open.owner_effect_receipts (
  request_id uuid PRIMARY KEY REFERENCES c3_open.owner_message_receipts(request_id),
  lifecycle_stage text NOT NULL CHECK(lifecycle_stage IN ('funded','active','redemption_requested','redeemed')),
  evidence_hash bytea NOT NULL CHECK(octet_length(evidence_hash)=32),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION c3_open.reject_owner_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'C3_OWNER_JOURNAL_IMMUTABLE'; END $$;
CREATE TRIGGER immutable_owner_request BEFORE UPDATE OR DELETE ON c3_open.owner_requests
FOR EACH ROW EXECUTE FUNCTION c3_open.reject_owner_mutation();
CREATE TRIGGER immutable_owner_submission BEFORE UPDATE OR DELETE ON c3_open.owner_submissions
FOR EACH ROW EXECUTE FUNCTION c3_open.reject_owner_mutation();
CREATE TRIGGER immutable_owner_receipt BEFORE UPDATE OR DELETE ON c3_open.owner_message_receipts
FOR EACH ROW EXECUTE FUNCTION c3_open.reject_owner_mutation();
CREATE TRIGGER immutable_owner_effect BEFORE UPDATE OR DELETE ON c3_open.owner_effect_receipts
FOR EACH ROW EXECUTE FUNCTION c3_open.reject_owner_mutation();
REVOKE ALL ON c3_open.owner_requests,c3_open.owner_submissions,c3_open.owner_message_receipts,c3_open.owner_effect_receipts FROM PUBLIC;
