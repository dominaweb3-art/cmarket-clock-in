-- Forward-only namespace resolution. Open-vault authorizations reference the
-- ORIGINAL c3_open intent/leg; historical c3.c3_pilot_intents and their seals
-- are neither copied nor reinterpreted as open-vault purchases.
-- Explicit isolated migration only; production bootstrap does not apply it.
CREATE TABLE c3_open.quote_contexts (
  intent_id uuid NOT NULL,
  ordinal smallint NOT NULL,
  intent_revision bigint NOT NULL CHECK(intent_revision > 0),
  context jsonb NOT NULL CHECK(jsonb_typeof(context)='object'),
  context_hash bytea NOT NULL CHECK(octet_length(context_hash)=32),
  scope text NOT NULL CHECK(scope IN ('LOCAL_CLONE','LOCAL_MOCK')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(intent_id,ordinal,intent_revision),
  FOREIGN KEY(intent_id,ordinal) REFERENCES c3_open.legs(intent_id,ordinal) ON DELETE RESTRICT
);
CREATE TRIGGER immutable_quote_context BEFORE UPDATE OR DELETE ON c3_open.quote_contexts
  FOR EACH ROW EXECUTE FUNCTION c3_open.reject_immutable();
CREATE TABLE c3_open.quote_authorizations (
  quote_id bytea PRIMARY KEY CHECK(octet_length(quote_id)=32),
  nonce bytea UNIQUE NOT NULL CHECK(octet_length(nonce)=32),
  intent_id uuid NOT NULL,
  ordinal smallint NOT NULL,
  intent_revision bigint NOT NULL,
  canonical_payload bytea NOT NULL CHECK(octet_length(canonical_payload)=300),
  payload_hash bytea NOT NULL CHECK(octet_length(payload_hash)=32),
  evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object'),
  authority bytea NOT NULL CHECK(octet_length(authority)=32),
  signature bytea CHECK(octet_length(signature)=64),
  state text NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared','signed','consumed','expired','manual_review')),
  revision bigint NOT NULL DEFAULT 1 CHECK(revision > 0),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(intent_id,ordinal,intent_revision)
    REFERENCES c3_open.quote_contexts(intent_id,ordinal,intent_revision) ON DELETE RESTRICT,
  CHECK((state NOT IN ('signed','consumed') OR signature IS NOT NULL)
    AND (state NOT IN ('prepared','expired') OR signature IS NULL)),
  CHECK(expires_at > created_at AND expires_at <= created_at + interval '30 seconds'),
  CHECK(substring(canonical_payload FROM 50 FOR 32)=quote_id),
  CHECK(substring(canonical_payload FROM 82 FOR 32)=nonce)
);
CREATE UNIQUE INDEX one_open_quote_per_leg ON c3_open.quote_authorizations(intent_id,ordinal)
  WHERE state IN ('prepared','signed','consumed');
CREATE FUNCTION c3_open.guard_quote() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,c3_open,pg_temp AS $$
BEGIN
  IF (to_jsonb(OLD)-ARRAY['signature','state','revision']) IS DISTINCT FROM
     (to_jsonb(NEW)-ARRAY['signature','state','revision'])
     OR NEW.revision <> OLD.revision+1
     OR OLD.state IN ('consumed','expired','manual_review')
     OR (OLD.signature IS NOT NULL AND OLD.signature IS DISTINCT FROM NEW.signature)
     OR NOT ((OLD.state='prepared' AND NEW.state IN ('signed','expired','manual_review'))
       OR (OLD.state='signed' AND NEW.state IN ('consumed','manual_review')))
     OR (NEW.state='signed' AND clock_timestamp() >= OLD.expires_at)
  THEN RAISE EXCEPTION 'C3_OPEN_QUOTE_IMMUTABLE_OR_EXPIRED'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER guard_quote BEFORE UPDATE ON c3_open.quote_authorizations
  FOR EACH ROW EXECUTE FUNCTION c3_open.guard_quote();
CREATE TRIGGER no_delete_quote BEFORE DELETE ON c3_open.quote_authorizations
  FOR EACH ROW EXECUTE FUNCTION c3_open.reject_immutable();
COMMENT ON TABLE c3_open.quote_contexts IS
  'Isolated reconciler snapshots, NOT public client policy. Mainnet contexts unsupported. No duplicate historical pilot intents.';
