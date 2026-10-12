-- CLOCKIN_ONLY: bounded test-unit amounts only. Preserve all old intents,
-- immutable triggers, CAS, signatures, and private-schema privileges.
BEGIN;
ALTER TABLE c3_eval.intents DROP CONSTRAINT intents_deposit_amount_check;
ALTER TABLE c3_eval.intents ADD CONSTRAINT intents_deposit_amount_check
 CHECK (deposit_amount BETWEEN 1000000 AND 1000000000000);
COMMIT;
