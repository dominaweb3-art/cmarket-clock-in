-- Forward-only isolated journal hardening. No production role or approval.
CREATE FUNCTION c3_open.freeze_finalized_leg() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,c3_open,pg_temp AS $$
BEGIN
  IF OLD.state='confirmed' AND to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW) THEN
    RAISE EXCEPTION 'C3_OPEN_FINALIZED_EVIDENCE_IMMUTABLE';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER freeze_finalized_leg BEFORE UPDATE ON c3_open.legs
  FOR EACH ROW EXECUTE FUNCTION c3_open.freeze_finalized_leg();
