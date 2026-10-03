-- Additive protocol over the SAME open-vault intents. No second ownership ledger.
ALTER TABLE c3_open.owner_requests DROP CONSTRAINT owner_requests_intent_id_action_key;
ALTER TABLE c3_open.owner_requests ADD COLUMN generation bigint NOT NULL DEFAULT 1 CHECK(generation>0);
ALTER TABLE c3_open.owner_requests ADD COLUMN predecessor uuid REFERENCES c3_open.owner_requests(request_id);
CREATE UNIQUE INDEX owner_request_generation ON c3_open.owner_requests(intent_id,action,generation);
CREATE UNIQUE INDEX owner_request_successor ON c3_open.owner_requests(predecessor) WHERE predecessor IS NOT NULL;
CREATE TABLE c3_open.owner_challenges (
 challenge_id uuid PRIMARY KEY,
 intent_id uuid NOT NULL REFERENCES c3_open.intents(intent_id),
 wallet text NOT NULL,
 audience text NOT NULL,
 nonce_hash bytea NOT NULL CHECK(octet_length(nonce_hash)=32),
 message_hash bytea NOT NULL CHECK(octet_length(message_hash)=32),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE c3_open.owner_sessions (
 session_hash bytea PRIMARY KEY CHECK(octet_length(session_hash)=32),
 challenge_id uuid NOT NULL UNIQUE REFERENCES c3_open.owner_challenges(challenge_id),
 intent_id uuid NOT NULL REFERENCES c3_open.intents(intent_id),
 wallet text NOT NULL,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE c3_open.owner_request_sessions (
 request_id uuid NOT NULL REFERENCES c3_open.owner_requests(request_id),
 session_hash bytea NOT NULL REFERENCES c3_open.owner_sessions(session_hash),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(request_id,session_hash)
);
-- Claim committed BEFORE a single explicit transport invocation. A crash here
-- is uncertain, not permission for a second send. Packet/signing keys never stored.
CREATE TABLE c3_open.owner_send_attempts (
 request_id uuid PRIMARY KEY REFERENCES c3_open.owner_submissions(request_id),
 signature text NOT NULL,
 message_hash bytea NOT NULL CHECK(octet_length(message_hash)=32),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE c3_open.owner_send_results (
 request_id uuid PRIMARY KEY REFERENCES c3_open.owner_send_attempts(request_id),
 result text NOT NULL CHECK(result IN ('accepted','uncertain')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE c3_open.owner_request_outcomes (
 request_id uuid PRIMARY KEY REFERENCES c3_open.owner_requests(request_id),
 outcome text NOT NULL CHECK(outcome IN ('expired_unexecuted','cancelled_unexecuted')),
 evidence_hash bytea NOT NULL CHECK(octet_length(evidence_hash)=32),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE c3_open.owner_economic_manifests (
 request_id uuid PRIMARY KEY REFERENCES c3_open.owner_requests(request_id),
 manifest jsonb NOT NULL,
 manifest_hash bytea NOT NULL CHECK(octet_length(manifest_hash)=32),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE c3_open.owner_expiry_barriers (
 request_id uuid PRIMARY KEY REFERENCES c3_open.owner_requests(request_id),
 accounts text[] NOT NULL CHECK(cardinality(accounts)>1),
 state_hash bytea NOT NULL CHECK(octet_length(state_hash)=32),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION c3_open.guard_owner_terminal_evidence() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,c3_open,pg_temp AS $$
BEGIN
 PERFORM 1 FROM c3_open.intents i JOIN c3_open.owner_requests r USING(intent_id) WHERE r.request_id=NEW.request_id FOR UPDATE OF i;
 IF TG_TABLE_NAME='owner_request_outcomes' AND EXISTS(SELECT 1 FROM c3_open.owner_message_receipts WHERE request_id=NEW.request_id) OR
    TG_TABLE_NAME='owner_message_receipts' AND EXISTS(SELECT 1 FROM c3_open.owner_request_outcomes WHERE request_id=NEW.request_id) THEN
  RAISE EXCEPTION 'C3_OWNER_CONTRADICTORY_FINALITY';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_closed_owner BEFORE INSERT ON c3_open.owner_request_outcomes FOR EACH ROW EXECUTE FUNCTION c3_open.guard_owner_terminal_evidence();
CREATE TRIGGER guard_finalized_owner BEFORE INSERT ON c3_open.owner_message_receipts FOR EACH ROW EXECUTE FUNCTION c3_open.guard_owner_terminal_evidence();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['owner_challenges','owner_sessions','owner_request_sessions','owner_send_attempts','owner_send_results','owner_request_outcomes','owner_economic_manifests','owner_expiry_barriers'] LOOP
  EXECUTE format('CREATE TRIGGER immutable_%I BEFORE UPDATE OR DELETE ON c3_open.%I FOR EACH ROW EXECUTE FUNCTION c3_open.reject_owner_mutation()',t,t);
  EXECUTE format('REVOKE ALL ON c3_open.%I FROM PUBLIC',t);
 END LOOP;
END $$;
