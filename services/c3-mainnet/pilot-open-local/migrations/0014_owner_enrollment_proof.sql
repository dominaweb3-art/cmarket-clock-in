-- Additive pre-intent proof only. Existing intents/history are not rewritten.
CREATE TABLE c3_open.owner_enrollment_challenges (
 challenge_id uuid PRIMARY KEY,
 wallet text NOT NULL,
 audience text NOT NULL CHECK(audience LIKE 'https://%'),
 policy_hash text NOT NULL CHECK(policy_hash ~ '^[a-f0-9]{64}$'),
 nonce_hash bytea NOT NULL CHECK(octet_length(nonce_hash)=32),
 message_hash bytea NOT NULL CHECK(octet_length(message_hash)=32),
 request_hash bytea NOT NULL UNIQUE CHECK(octet_length(request_hash)=32),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE c3_open.owner_enrollment_consumptions (
 challenge_id uuid PRIMARY KEY REFERENCES c3_open.owner_enrollment_challenges(challenge_id),
 intent_id uuid NOT NULL REFERENCES c3_open.production_enrollments(intent_id),
 signature_hash bytea NOT NULL CHECK(octet_length(signature_hash)=32),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX owner_enrollment_consumptions_intent ON c3_open.owner_enrollment_consumptions(intent_id);
CREATE INDEX owner_enrollment_challenges_wallet_time ON c3_open.owner_enrollment_challenges(wallet,created_at);
CREATE TABLE c3_open.owner_enrollment_rpc_attempts (
 challenge_id uuid NOT NULL REFERENCES c3_open.owner_enrollment_challenges(challenge_id),
 attempt smallint NOT NULL CHECK(attempt BETWEEN 1 AND 3),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(challenge_id,attempt)
);
CREATE TRIGGER immutable_owner_enrollment_challenge BEFORE UPDATE OR DELETE ON c3_open.owner_enrollment_challenges
 FOR EACH ROW EXECUTE FUNCTION c3_open.reject_owner_mutation();
CREATE TRIGGER immutable_owner_enrollment_consumption BEFORE UPDATE OR DELETE ON c3_open.owner_enrollment_consumptions
 FOR EACH ROW EXECUTE FUNCTION c3_open.reject_owner_mutation();
CREATE TRIGGER immutable_owner_enrollment_rpc_attempt BEFORE UPDATE OR DELETE ON c3_open.owner_enrollment_rpc_attempts
 FOR EACH ROW EXECUTE FUNCTION c3_open.reject_owner_mutation();
REVOKE ALL ON c3_open.owner_enrollment_challenges,c3_open.owner_enrollment_consumptions,c3_open.owner_enrollment_rpc_attempts FROM PUBLIC;
