-- Additive MOCK_LOCAL_ONLY recovery migration. Never applied by production bootstrap.
ALTER TABLE c3_open.intents DROP CONSTRAINT intents_state_check;
ALTER TABLE c3_open.intents ADD CONSTRAINT intents_state_check CHECK (state IN (
  'draft','funded','buying','active','redemption_requested','selling',
  'claimable','redeemed','expired','cancelled','failed_recoverable',
  'partially_completed','reconciliation_required','manual_review','paused'));

ALTER TABLE c3_open.legs DROP CONSTRAINT legs_state_check;
ALTER TABLE c3_open.legs ADD CONSTRAINT legs_state_check CHECK (state IN (
  'pending','leased','prepared','signed','submitted','uncertain',
  'reconciliation_required','confirmed','failed_finalized','manual_review'));
ALTER TABLE c3_open.legs ADD COLUMN recovery_attempts smallint NOT NULL DEFAULT 0
  CHECK (recovery_attempts BETWEEN 0 AND 3);
ALTER TABLE c3_open.legs ADD CONSTRAINT reconciliation_has_signature CHECK (
  state NOT IN ('reconciliation_required','failed_finalized','manual_review')
  OR submitted_signature IS NOT NULL);

CREATE OR REPLACE FUNCTION c3_open.guard_leg() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,c3_open,pg_temp AS $$
BEGIN
  IF OLD.intent_id IS DISTINCT FROM NEW.intent_id OR OLD.ordinal IS DISTINCT FROM NEW.ordinal
    OR (OLD.submitted_signature IS NOT NULL AND OLD.submitted_signature IS DISTINCT FROM NEW.submitted_signature)
    OR (OLD.submitted_at IS NOT NULL AND OLD.submitted_at IS DISTINCT FROM NEW.submitted_at)
    OR (OLD.route_hash IS NOT NULL AND OLD.route_hash IS DISTINCT FROM NEW.route_hash)
    OR (OLD.instruction_hash IS NOT NULL AND OLD.instruction_hash IS DISTINCT FROM NEW.instruction_hash)
    OR (OLD.authorization_hash IS NOT NULL AND OLD.authorization_hash IS DISTINCT FROM NEW.authorization_hash)
    OR (OLD.input_mint IS NOT NULL AND OLD.input_mint IS DISTINCT FROM NEW.input_mint)
    OR (OLD.output_mint IS NOT NULL AND OLD.output_mint IS DISTINCT FROM NEW.output_mint)
    OR (OLD.source_account IS NOT NULL AND OLD.source_account IS DISTINCT FROM NEW.source_account)
    OR (OLD.destination_account IS NOT NULL AND OLD.destination_account IS DISTINCT FROM NEW.destination_account)
    OR (OLD.input_amount IS NOT NULL AND OLD.input_amount IS DISTINCT FROM NEW.input_amount)
    OR (OLD.minimum_output IS NOT NULL AND OLD.minimum_output IS DISTINCT FROM NEW.minimum_output)
    OR (OLD.quote_expires_at IS NOT NULL AND OLD.quote_expires_at IS DISTINCT FROM NEW.quote_expires_at)
    OR (OLD.expected_effects IS NOT NULL AND OLD.expected_effects IS DISTINCT FROM NEW.expected_effects)
    OR (OLD.evidence_hash IS NOT NULL AND OLD.evidence_hash IS DISTINCT FROM NEW.evidence_hash)
    OR NEW.recovery_attempts < OLD.recovery_attempts
    OR (OLD.state='confirmed' AND NEW.state <> 'confirmed')
    OR (OLD.state='failed_finalized' AND NEW.state <> 'failed_finalized') THEN
    RAISE EXCEPTION 'C3_OPEN_IMMUTABLE_LEG';
  END IF;
  RETURN NEW;
END; $$;
