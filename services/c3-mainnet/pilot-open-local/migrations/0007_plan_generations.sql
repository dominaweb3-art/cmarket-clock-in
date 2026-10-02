-- Isolated validator only. Existing intents and signing deadlines are NOT renewed.
CREATE TABLE c3_open.renewal_requests (
  request_id uuid PRIMARY KEY,
  intent_id uuid NOT NULL REFERENCES c3_open.intents(intent_id),
  plan text NOT NULL,
  expected_db_revision bigint NOT NULL CHECK(expected_db_revision>0),
  expected_chain_revision bigint NOT NULL CHECK(expected_chain_revision>=0),
  expires_at bigint NOT NULL,
  pre_state bytea NOT NULL CHECK(octet_length(pre_state)=901),
  message_hash bytea NOT NULL CHECK(octet_length(message_hash)=32),
  observed_slot bigint NOT NULL CHECK(observed_slot>0),
  blockhash text NOT NULL,
  last_valid_block_height bigint NOT NULL CHECK(last_valid_block_height>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER immutable_renewal_request BEFORE UPDATE OR DELETE ON c3_open.renewal_requests
 FOR EACH ROW EXECUTE FUNCTION c3_open.reject_immutable();
-- Verify the owner's exact signed message BEFORE adding its public signature.
-- No transaction payload is stored. An unresolved signature is never replaced.
CREATE TABLE c3_open.renewal_submissions (
  request_id uuid PRIMARY KEY REFERENCES c3_open.renewal_requests(request_id),
  signature text UNIQUE NOT NULL,
  message_hash bytea NOT NULL CHECK(octet_length(message_hash)=32),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER immutable_renewal_submission BEFORE UPDATE OR DELETE ON c3_open.renewal_submissions
 FOR EACH ROW EXECUTE FUNCTION c3_open.reject_immutable();
CREATE TABLE c3_open.renewal_outcomes (
  request_id uuid PRIMARY KEY REFERENCES c3_open.renewal_submissions(request_id),
  disposition text NOT NULL CHECK(disposition IN ('failed_finalized','expired_unexecuted')),
  finalized_slot bigint NOT NULL CHECK(finalized_slot>0),
  db_revision bigint NOT NULL CHECK(db_revision>0),
  evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object'),
  evidence_hash bytea NOT NULL CHECK(octet_length(evidence_hash)=32),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER immutable_renewal_outcome BEFORE UPDATE OR DELETE ON c3_open.renewal_outcomes
 FOR EACH ROW EXECUTE FUNCTION c3_open.reject_immutable();
CREATE TABLE c3_open.plan_generations (
  intent_id uuid NOT NULL REFERENCES c3_open.intents(intent_id),
  plan text NOT NULL,
  generation bigint NOT NULL CHECK(generation>0),
  base_revision bigint NOT NULL CHECK(base_revision>0),
  request_id uuid UNIQUE NOT NULL REFERENCES c3_open.renewal_requests(request_id),
  renewal_signature text UNIQUE NOT NULL,
  finalized_slot bigint NOT NULL CHECK(finalized_slot>0),
  post_state bytea NOT NULL CHECK(octet_length(post_state)=901),
  evidence_hash bytea NOT NULL CHECK(octet_length(evidence_hash)=32),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(intent_id,plan,generation),
  UNIQUE(intent_id,plan,base_revision)
);
CREATE TRIGGER immutable_generation BEFORE UPDATE OR DELETE ON c3_open.plan_generations
 FOR EACH ROW EXECUTE FUNCTION c3_open.reject_immutable();
CREATE FUNCTION c3_open.exclusive_renewal_result() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,c3_open,pg_temp AS $$
DECLARE target uuid;
BEGIN
 SELECT intent_id INTO STRICT target FROM c3_open.renewal_requests WHERE request_id=NEW.request_id;
 PERFORM 1 FROM c3_open.intents WHERE intent_id=target FOR UPDATE;
 IF (TG_TABLE_NAME='plan_generations' AND EXISTS(SELECT 1 FROM c3_open.renewal_outcomes WHERE request_id=NEW.request_id))
  OR (TG_TABLE_NAME='renewal_outcomes' AND EXISTS(SELECT 1 FROM c3_open.plan_generations WHERE request_id=NEW.request_id))
 THEN RAISE EXCEPTION 'C3_OPEN_RENEWAL_RESULT_CONFLICT'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER exclusive_renewal_generation BEFORE INSERT ON c3_open.plan_generations
 FOR EACH ROW EXECUTE FUNCTION c3_open.exclusive_renewal_result();
CREATE TRIGGER exclusive_renewal_outcome BEFORE INSERT ON c3_open.renewal_outcomes
 FOR EACH ROW EXECUTE FUNCTION c3_open.exclusive_renewal_result();
CREATE TABLE c3_open.leg_attempt_history (
  intent_id uuid NOT NULL,
  ordinal smallint NOT NULL,
  generation bigint NOT NULL,
  plan text NOT NULL,
  prior_leg jsonb NOT NULL,
  PRIMARY KEY(intent_id,ordinal,plan,generation),
  FOREIGN KEY(intent_id,ordinal) REFERENCES c3_open.legs(intent_id,ordinal),
  FOREIGN KEY(intent_id,plan,generation) REFERENCES c3_open.plan_generations(intent_id,plan,generation)
);
CREATE TRIGGER immutable_attempt_history BEFORE UPDATE OR DELETE ON c3_open.leg_attempt_history
 FOR EACH ROW EXECUTE FUNCTION c3_open.reject_immutable();
CREATE TABLE c3_open.quote_generations (
  quote_id bytea PRIMARY KEY REFERENCES c3_open.quote_authorizations(quote_id),
  intent_id uuid NOT NULL,
  plan text NOT NULL,
  generation bigint NOT NULL CHECK(generation>=0),
  plan_revision bigint NOT NULL CHECK(plan_revision>=0)
);
CREATE TRIGGER immutable_quote_generation BEFORE UPDATE OR DELETE ON c3_open.quote_generations
 FOR EACH ROW EXECUTE FUNCTION c3_open.reject_immutable();
CREATE FUNCTION c3_open.bind_quote_generation() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,c3_open,pg_temp AS $$
DECLARE ctx jsonb; gen bigint; base bigint;
BEGIN
 SELECT context INTO STRICT ctx FROM c3_open.quote_contexts
  WHERE intent_id=NEW.intent_id AND ordinal=NEW.ordinal AND intent_revision=NEW.intent_revision;
 SELECT generation,base_revision INTO gen,base FROM c3_open.plan_generations
  WHERE intent_id=NEW.intent_id AND plan=ctx->>'plan' ORDER BY generation DESC LIMIT 1;
 IF (ctx->>'planRevision')::bigint < COALESCE(base,0) THEN
  RAISE EXCEPTION 'C3_OPEN_OBSOLETE_GENERATION'; END IF;
 INSERT INTO c3_open.quote_generations VALUES(NEW.quote_id,NEW.intent_id,ctx->>'plan',COALESCE(gen,0),(ctx->>'planRevision')::bigint);
 RETURN NEW;
END; $$;
CREATE TRIGGER bind_quote_generation AFTER INSERT ON c3_open.quote_authorizations
 FOR EACH ROW EXECUTE FUNCTION c3_open.bind_quote_generation();
INSERT INTO c3_open.quote_generations
 SELECT q.quote_id,q.intent_id,ctx.context->>'plan',0,(ctx.context->>'planRevision')::bigint
 FROM c3_open.quote_authorizations q JOIN c3_open.quote_contexts ctx USING(intent_id,ordinal,intent_revision);
-- No relaxation of the historical guard. A narrowly defined rollover can clear
-- ONLY an unsigned, unsubmitted attempt after its exact old row was archived.
ALTER FUNCTION c3_open.guard_leg() RENAME TO guard_leg_before_generations;
CREATE FUNCTION c3_open.guard_leg() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,c3_open,pg_temp AS $$
BEGIN
 IF NEW.state='pending' AND OLD.state IN ('pending','leased','prepared')
  AND OLD.submitted_signature IS NULL AND NEW.submitted_signature IS NULL
  AND OLD.submitted_at IS NULL AND OLD.evidence_hash IS NULL AND OLD.observed_effects IS NULL
  AND NEW.submitted_at IS NULL AND NEW.evidence_hash IS NULL AND NEW.observed_effects IS NULL
  AND NEW.recovery_attempts=OLD.recovery_attempts AND NEW.chain_revision=OLD.chain_revision
  AND NEW.intent_id=OLD.intent_id AND NEW.ordinal=OLD.ordinal
  AND NEW.route_hash IS NULL AND NEW.instruction_hash IS NULL AND NEW.authorization_hash IS NULL
  AND NEW.input_mint IS NULL AND NEW.output_mint IS NULL AND NEW.source_account IS NULL
  AND NEW.destination_account IS NULL AND NEW.input_amount IS NULL AND NEW.minimum_output IS NULL
  AND NEW.quote_expires_at IS NULL AND NEW.expected_effects IS NULL
  AND NEW.lease_owner IS NULL AND NEW.lease_expires_at IS NULL AND NEW.reason_code IS NULL
  AND EXISTS(SELECT 1 FROM c3_open.leg_attempt_history h JOIN c3_open.intents i USING(intent_id)
   JOIN c3_open.plan_generations g USING(intent_id,plan,generation)
   WHERE h.intent_id=OLD.intent_id AND h.ordinal=OLD.ordinal AND h.prior_leg=to_jsonb(OLD)
    AND h.plan=CASE WHEN OLD.ordinal<3 THEN i.deposit_plan ELSE i.redemption_plan END
    AND g.base_revision=i.chain_revision AND h.generation=(SELECT max(generation) FROM c3_open.plan_generations
      WHERE intent_id=h.intent_id AND plan=h.plan))
 THEN RETURN NEW; END IF;
 -- Same immutable fields and terminal rules as migration 0002.
 IF OLD.intent_id IS DISTINCT FROM NEW.intent_id OR OLD.ordinal IS DISTINCT FROM NEW.ordinal
  OR (OLD.submitted_signature IS NOT NULL AND OLD.submitted_signature IS DISTINCT FROM NEW.submitted_signature)
  OR (OLD.submitted_at IS NOT NULL AND OLD.submitted_at IS DISTINCT FROM NEW.submitted_at)
  OR (OLD.evidence_hash IS NOT NULL AND OLD.evidence_hash IS DISTINCT FROM NEW.evidence_hash)
  OR NEW.recovery_attempts<OLD.recovery_attempts
  OR (OLD.state IN ('confirmed','failed_finalized') AND NEW.state<>OLD.state)
  OR EXISTS(SELECT 1 FROM jsonb_each(to_jsonb(OLD)) e WHERE e.key=ANY(ARRAY['route_hash','instruction_hash','authorization_hash',
   'input_mint','output_mint','source_account','destination_account','input_amount','minimum_output','quote_expires_at','expected_effects'])
   AND e.value<>'null'::jsonb AND e.value IS DISTINCT FROM to_jsonb(NEW)->e.key)
 THEN RAISE EXCEPTION 'C3_OPEN_IMMUTABLE_LEG'; END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER guard_leg ON c3_open.legs;
CREATE TRIGGER guard_leg BEFORE UPDATE ON c3_open.legs FOR EACH ROW EXECUTE FUNCTION c3_open.guard_leg();
CREATE FUNCTION c3_open.freeze_original_expiry() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,c3_open,pg_temp AS $$
BEGIN
 IF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN RAISE EXCEPTION 'C3_OPEN_ORIGINAL_EXPIRY_IMMUTABLE'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER freeze_original_expiry BEFORE UPDATE ON c3_open.intents
 FOR EACH ROW EXECUTE FUNCTION c3_open.freeze_original_expiry();
