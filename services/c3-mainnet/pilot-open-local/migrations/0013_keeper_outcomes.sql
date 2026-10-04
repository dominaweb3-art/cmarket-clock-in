-- Additive non-execution outcomes. Neither packets nor signatures are deleted.
CREATE TABLE c3_open.keeper_request_outcomes (
 request_id uuid PRIMARY KEY REFERENCES c3_open.keeper_packets,
 outcome text NOT NULL CHECK(outcome IN ('FAILED_FINALIZED','EXPIRED_UNEXECUTED')),
 signature text, finalized_slot bigint NOT NULL CHECK(finalized_slot>0),
 evidence_hash bytea NOT NULL CHECK(octet_length(evidence_hash)=32),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER keeper_request_outcomes_immutable BEFORE UPDATE OR DELETE ON c3_open.keeper_request_outcomes FOR EACH ROW EXECUTE FUNCTION c3_open.keeper_immutable();
CREATE OR REPLACE FUNCTION c3_open.keeper_pending_barrier() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,c3_open,pg_temp AS $$
BEGIN
 PERFORM 1 FROM c3_open.intents WHERE intent_id=NEW.intent_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM c3_open.keeper_packets p LEFT JOIN c3_open.keeper_effect_receipts r USING(request_id)
 LEFT JOIN c3_open.keeper_request_outcomes o USING(request_id)
 WHERE p.intent_id=NEW.intent_id AND r.request_id IS NULL AND o.request_id IS NULL) THEN RAISE EXCEPTION 'C3_KEEPER_RECONCILE_PENDING'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION c3_open.keeper_terminal_exclusive() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,c3_open,pg_temp AS $$
DECLARE v_intent uuid;
BEGIN
 SELECT intent_id INTO STRICT v_intent FROM c3_open.keeper_packets WHERE request_id=NEW.request_id;
 PERFORM 1 FROM c3_open.intents WHERE intent_id=v_intent FOR UPDATE;
 IF TG_TABLE_NAME='keeper_request_outcomes' THEN
  IF EXISTS(SELECT 1 FROM c3_open.keeper_effect_receipts WHERE request_id=NEW.request_id) THEN RAISE EXCEPTION 'C3_KEEPER_TERMINAL_CONFLICT'; END IF;
  IF NEW.signature IS DISTINCT FROM (SELECT signature FROM c3_open.keeper_signatures WHERE request_id=NEW.request_id) THEN RAISE EXCEPTION 'C3_KEEPER_SIGNATURE_CONFLICT'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM c3_open.keeper_request_outcomes WHERE request_id=NEW.request_id) THEN RAISE EXCEPTION 'C3_KEEPER_TERMINAL_CONFLICT'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER keeper_outcome_exclusive BEFORE INSERT ON c3_open.keeper_request_outcomes FOR EACH ROW EXECUTE FUNCTION c3_open.keeper_terminal_exclusive();
CREATE TRIGGER keeper_effect_exclusive BEFORE INSERT ON c3_open.keeper_effect_receipts FOR EACH ROW EXECUTE FUNCTION c3_open.keeper_terminal_exclusive();
REVOKE ALL ON c3_open.keeper_request_outcomes FROM PUBLIC;
