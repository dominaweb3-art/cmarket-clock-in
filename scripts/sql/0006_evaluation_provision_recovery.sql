-- Explicit, authenticated recovery of an expired, unexecuted Unpause only.
BEGIN;
CREATE TABLE c3_eval.evaluation_provision_attempts (
 base_operation text NOT NULL REFERENCES c3_eval.service_packets(operation_id),
 generation integer NOT NULL CHECK(generation BETWEEN 2 AND 3),
 operation_id text NOT NULL UNIQUE,
 predecessor text NOT NULL REFERENCES c3_eval.service_packets(operation_id),
 challenge_id uuid NOT NULL REFERENCES c3_eval.wallet_proofs(challenge_id),
 evidence_hash bytea NOT NULL CHECK(octet_length(evidence_hash)=32),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(base_operation,generation), UNIQUE(predecessor)
);
ALTER TABLE c3_eval.evaluation_provision_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON c3_eval.evaluation_provision_attempts FROM PUBLIC,anon,authenticated;
CREATE TRIGGER immutable_provision_attempts BEFORE UPDATE OR DELETE ON c3_eval.evaluation_provision_attempts
 FOR EACH ROW EXECUTE FUNCTION c3_eval.reject_immutable();
COMMIT;
