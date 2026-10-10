-- SHARED. Explicit expiry recovery before any settlement plan exists.
-- No historical packet/signature is deleted and this records no economic success.
BEGIN;
CREATE TABLE c3_eval.initial_plan_expirations (
 operation_id text PRIMARY KEY REFERENCES c3_eval.service_contexts(operation_id),
 intent_id uuid NOT NULL REFERENCES c3_eval.intents(intent_id),
 expected_db_revision bigint NOT NULL CHECK(expected_db_revision>0),
 expected_chain_revision bigint NOT NULL CHECK(expected_chain_revision>=0),
 barrier_slot bigint NOT NULL CHECK(barrier_slot>0),
 evidence_hash bytea NOT NULL CHECK(octet_length(evidence_hash)=32),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE c3_eval.initial_plan_expirations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON c3_eval.initial_plan_expirations FROM PUBLIC,anon,authenticated;
CREATE TRIGGER immutable_evaluation_initial_plan_expiry BEFORE UPDATE OR DELETE
 ON c3_eval.initial_plan_expirations FOR EACH ROW EXECUTE FUNCTION c3_eval.reject_immutable();
COMMIT;
