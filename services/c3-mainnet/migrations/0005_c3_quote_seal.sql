-- Forward-only sealed-quote evidence. This migration creates no authority or key.
CREATE TABLE c3.c3_quote_authorizations (
  quote_id bytea PRIMARY KEY CHECK (octet_length(quote_id)=32),
  nonce bytea NOT NULL UNIQUE CHECK (octet_length(nonce)=32),
  intent_id text NOT NULL REFERENCES c3.c3_pilot_intents(intent_id) ON DELETE RESTRICT,
  leg smallint NOT NULL CHECK (leg BETWEEN 0 AND 2),
  policy_revision bigint NOT NULL CHECK (policy_revision > 0),
  registry_revision bigint NOT NULL CHECK (registry_revision > 0),
  registry_hash bytea NOT NULL CHECK (octet_length(registry_hash)=32),
  payload bytea NOT NULL CHECK (octet_length(payload)=300),
  payload_sha256 bytea NOT NULL CHECK (octet_length(payload_sha256)=32),
  authority_pubkey bytea NOT NULL CHECK (octet_length(authority_pubkey)=32),
  signature bytea CHECK (signature IS NULL OR octet_length(signature)=64),
  state text NOT NULL DEFAULT 'prepared' CHECK (state IN ('prepared','signed','consumed','expired','manual_review')),
  consumed_transaction_signature text CHECK (consumed_transaction_signature ~ '^[1-9A-HJ-NP-Za-km-z]{64,96}$'),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  signed_at timestamptz,
  consumed_at timestamptz,
  UNIQUE(intent_id,leg,nonce),
  CHECK ((state IN ('prepared','expired','manual_review') AND signature IS NULL AND signed_at IS NULL)
      OR (state IN ('signed','consumed','expired','manual_review') AND signature IS NOT NULL AND signed_at IS NOT NULL)),
  CHECK (state <> 'consumed' OR (consumed_transaction_signature IS NOT NULL AND consumed_at IS NOT NULL)),
  CHECK (state = 'consumed' OR (consumed_transaction_signature IS NULL AND consumed_at IS NULL))
);

CREATE UNIQUE INDEX c3_quote_one_live_leg ON c3.c3_quote_authorizations(intent_id,leg)
  WHERE state IN ('prepared','signed');

CREATE FUNCTION c3.c3_guard_quote_insert() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog,c3,pg_temp AS $$
BEGIN
  NEW.created_at := clock_timestamp();
  IF NEW.state <> 'prepared' OR NEW.revision <> 1 OR NEW.signature IS NOT NULL
    OR NEW.signed_at IS NOT NULL OR NEW.consumed_at IS NOT NULL
    OR NEW.consumed_transaction_signature IS NOT NULL
    OR NEW.quote_id <> sha256(convert_to('c3-quote-id-v1','UTF8') || NEW.nonce)
    OR substring(NEW.payload from 1 for 16) <> convert_to('C3QUOTESEAL-V1!!','UTF8')
    OR get_byte(NEW.payload,16) <> 1
    OR substring(NEW.payload from 50 for 32) <> NEW.quote_id
    OR substring(NEW.payload from 82 for 32) <> NEW.nonce
    OR NEW.expires_at <= NEW.created_at
    OR NEW.expires_at > clock_timestamp() + interval '30 seconds'
    OR sha256(NEW.payload) <> NEW.payload_sha256 THEN
    RAISE EXCEPTION 'C3 quote evidence invalid or expired';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER c3_quote_insert BEFORE INSERT ON c3.c3_quote_authorizations
  FOR EACH ROW EXECUTE FUNCTION c3.c3_guard_quote_insert();

CREATE FUNCTION c3.c3_guard_quote_update() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog,c3,pg_temp AS $$
BEGIN
  IF OLD.quote_id IS DISTINCT FROM NEW.quote_id OR OLD.nonce IS DISTINCT FROM NEW.nonce
    OR OLD.intent_id IS DISTINCT FROM NEW.intent_id OR OLD.leg IS DISTINCT FROM NEW.leg
    OR OLD.policy_revision IS DISTINCT FROM NEW.policy_revision
    OR OLD.registry_revision IS DISTINCT FROM NEW.registry_revision
    OR OLD.registry_hash IS DISTINCT FROM NEW.registry_hash
    OR OLD.payload IS DISTINCT FROM NEW.payload
    OR OLD.payload_sha256 IS DISTINCT FROM NEW.payload_sha256
    OR OLD.authority_pubkey IS DISTINCT FROM NEW.authority_pubkey
    OR OLD.created_at IS DISTINCT FROM NEW.created_at OR OLD.expires_at IS DISTINCT FROM NEW.expires_at
    OR NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'C3 quote immutable evidence or CAS violated';
  END IF;
  IF OLD.state='prepared' THEN
    IF NEW.state='signed' THEN
      NEW.signed_at := clock_timestamp();
      IF OLD.expires_at <= NEW.signed_at THEN
        RAISE EXCEPTION 'C3 quote expired before signing';
      END IF;
    ELSIF NEW.state='expired' AND OLD.expires_at > clock_timestamp() THEN
      RAISE EXCEPTION 'C3 quote cannot expire before database time';
    END IF;
    IF NEW.state NOT IN ('signed','expired','manual_review') OR
       (NEW.state='signed' AND NEW.signature IS NULL) OR
       (NEW.state IN ('expired','manual_review') AND
        (NEW.signature IS NOT NULL OR NEW.signed_at IS NOT NULL)) THEN
      RAISE EXCEPTION 'C3 quote invalid signing transition';
    END IF;
  ELSIF OLD.state='signed' THEN
    IF NEW.state='consumed' THEN NEW.consumed_at := clock_timestamp(); END IF;
    IF NEW.state='expired' AND OLD.expires_at > clock_timestamp() THEN
      RAISE EXCEPTION 'C3 quote cannot expire before database time';
    END IF;
    IF NEW.state NOT IN ('consumed','expired','manual_review')
      OR OLD.signature IS DISTINCT FROM NEW.signature
      OR OLD.signed_at IS DISTINCT FROM NEW.signed_at THEN
      RAISE EXCEPTION 'C3 quote invalid final transition';
    END IF;
  ELSE
    RAISE EXCEPTION 'C3 quote terminal evidence is immutable';
  END IF;
  IF OLD.consumed_transaction_signature IS NOT NULL AND
      OLD.consumed_transaction_signature IS DISTINCT FROM NEW.consumed_transaction_signature THEN
    RAISE EXCEPTION 'C3 quote submitted signature cannot be removed';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER c3_quote_guard BEFORE UPDATE ON c3.c3_quote_authorizations
  FOR EACH ROW EXECUTE FUNCTION c3.c3_guard_quote_update();
CREATE TRIGGER c3_quote_no_delete BEFORE DELETE ON c3.c3_quote_authorizations
  FOR EACH ROW EXECUTE FUNCTION c3.c3_reject_immutable_change();

CREATE TABLE c3.c3_quote_events (
  event_id uuid PRIMARY KEY,
  quote_id bytea NOT NULL REFERENCES c3.c3_quote_authorizations(quote_id) ON DELETE RESTRICT,
  revision bigint NOT NULL CHECK (revision > 0),
  action text NOT NULL CHECK (action IN ('prepared','signed','consumed','expired','manual_review')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(quote_id,revision)
);
CREATE TRIGGER c3_quote_events_immutable BEFORE UPDATE OR DELETE ON c3.c3_quote_events
  FOR EACH ROW EXECUTE FUNCTION c3.c3_reject_immutable_change();
CREATE TABLE c3.c3_quote_outbox (
  event_id uuid PRIMARY KEY REFERENCES c3.c3_quote_events(event_id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','dead_letter')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION c3.c3_emit_quote_event() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog,c3,pg_temp AS $$
DECLARE event_identity uuid;
BEGIN
  event_identity := gen_random_uuid();
  INSERT INTO c3.c3_quote_events(event_id,quote_id,revision,action)
    VALUES(event_identity,NEW.quote_id,NEW.revision,NEW.state);
  INSERT INTO c3.c3_quote_outbox(event_id) VALUES(event_identity);
  RETURN NEW;
END;
$$;
CREATE TRIGGER c3_quote_event_insert AFTER INSERT ON c3.c3_quote_authorizations
  FOR EACH ROW EXECUTE FUNCTION c3.c3_emit_quote_event();
CREATE TRIGGER c3_quote_event_update AFTER UPDATE ON c3.c3_quote_authorizations
  FOR EACH ROW EXECUTE FUNCTION c3.c3_emit_quote_event();
