-- Forward-only: no duplicated intent namespace and no private signing material.
CREATE TABLE c3_open.signing_requests (
  request_id bytea PRIMARY KEY CHECK(octet_length(request_id)=32),
  quote_id bytea UNIQUE NOT NULL REFERENCES c3_open.quote_authorizations(quote_id) ON DELETE RESTRICT,
  payload_hash bytea NOT NULL CHECK(octet_length(payload_hash)=32),
  authority bytea NOT NULL CHECK(octet_length(authority)=32),
  state text NOT NULL CHECK(state IN ('dispatched','uncertain','result','manual_review')),
  signature bytea CHECK(octet_length(signature)=64),
  recovery_attempts smallint NOT NULL DEFAULT 0 CHECK(recovery_attempts BETWEEN 0 AND 3),
  revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  recovery_deadline timestamptz NOT NULL DEFAULT clock_timestamp()+interval '24 hours',
  CHECK((state='result')=(signature IS NOT NULL)),
  CHECK(recovery_deadline>created_at AND recovery_deadline<=created_at+interval '24 hours')
);
CREATE FUNCTION c3_open.guard_signing_request() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,c3_open,pg_temp AS $$
BEGIN
  IF (to_jsonb(OLD)-ARRAY['state','signature','recovery_attempts','revision']) IS DISTINCT FROM
     (to_jsonb(NEW)-ARRAY['state','signature','recovery_attempts','revision'])
     OR NEW.revision<>OLD.revision+1
     OR OLD.state='result'
     OR (OLD.state='manual_review' AND NEW.state<>'result')
     OR NEW.recovery_attempts<OLD.recovery_attempts
     OR NEW.recovery_attempts>OLD.recovery_attempts+1
     OR NEW.state='dispatched'
  THEN RAISE EXCEPTION 'C3_OPEN_SIGNING_JOURNAL_IMMUTABLE'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER guard_signing_request BEFORE UPDATE ON c3_open.signing_requests
 FOR EACH ROW EXECUTE FUNCTION c3_open.guard_signing_request();
CREATE TRIGGER no_delete_signing_request BEFORE DELETE ON c3_open.signing_requests
 FOR EACH ROW EXECUTE FUNCTION c3_open.reject_immutable();
