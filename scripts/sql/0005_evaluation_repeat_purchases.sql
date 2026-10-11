-- CLOCKIN_ONLY. Existing vaults, signatures, intents and proofs remain immutable.
-- This schema is private: never grant the anonymous/client roles access.
BEGIN;
ALTER TABLE c3_eval.intents DROP CONSTRAINT intents_deposit_amount_check;
ALTER TABLE c3_eval.intents ADD CONSTRAINT intents_deposit_amount_check
 CHECK (deposit_amount BETWEEN 1000000 AND 200000000);
DROP INDEX c3_eval.eval_one_lifetime_position_per_wallet;
CREATE UNIQUE INDEX eval_one_intent_per_vault ON c3_eval.intents(wallet,vault);
CREATE TABLE c3_eval.evaluation_round_requests (
 wallet text NOT NULL REFERENCES c3_eval.provisioning_slots(wallet),
 round bigint NOT NULL CHECK(round BETWEEN 2 AND 10),
 challenge_id uuid NOT NULL REFERENCES c3_eval.wallet_proofs(challenge_id),
 predecessor_vault text,
 predecessor_evidence_hash bytea CHECK(predecessor_evidence_hash IS NULL OR octet_length(predecessor_evidence_hash)=32),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(wallet,round),
 CHECK((predecessor_vault IS NULL)=(predecessor_evidence_hash IS NULL))
);
CREATE TABLE c3_eval.evaluation_wallet_rounds (
 wallet text NOT NULL, round bigint NOT NULL,
 vault text NOT NULL UNIQUE, share_mint text NOT NULL UNIQUE,
 challenge_id uuid NOT NULL REFERENCES c3_eval.wallet_proofs(challenge_id),
 provisioning_signature text NOT NULL UNIQUE,
 provisioning_evidence_hash bytea NOT NULL CHECK(octet_length(provisioning_evidence_hash)=32),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(wallet,round),
 FOREIGN KEY(wallet,round) REFERENCES c3_eval.evaluation_round_requests(wallet,round)
);
ALTER TABLE c3_eval.evaluation_round_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE c3_eval.evaluation_wallet_rounds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON c3_eval.evaluation_round_requests,c3_eval.evaluation_wallet_rounds FROM PUBLIC,anon,authenticated;
CREATE TRIGGER immutable_round_requests BEFORE UPDATE OR DELETE ON c3_eval.evaluation_round_requests
 FOR EACH ROW EXECUTE FUNCTION c3_eval.reject_immutable();
CREATE TRIGGER immutable_wallet_rounds BEFORE UPDATE OR DELETE ON c3_eval.evaluation_wallet_rounds
 FOR EACH ROW EXECUTE FUNCTION c3_eval.reject_immutable();
CREATE VIEW c3_eval.current_wallet_vaults WITH(security_invoker=true) AS
 SELECT DISTINCT ON(v.wallet) v.*,i.deposit_amount
 FROM (
 SELECT wallet,1::bigint AS round,vault,share_mint,challenge_id,provisioning_signature,provisioning_evidence_hash,created_at FROM c3_eval.wallet_vaults
 UNION ALL
 SELECT wallet,round,vault,share_mint,challenge_id,provisioning_signature,provisioning_evidence_hash,created_at FROM c3_eval.evaluation_wallet_rounds
 ) v LEFT JOIN c3_eval.intents i USING(wallet,vault) ORDER BY v.wallet,v.round DESC;
REVOKE ALL ON c3_eval.current_wallet_vaults FROM PUBLIC,anon,authenticated;
COMMIT;
