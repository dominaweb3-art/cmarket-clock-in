-- Additive correction: both insertion timestamps come from ONE server clock.
-- Already applied migration checksums remain unchanged.
CREATE FUNCTION c3_open.initialize_signing_clock() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,c3_open,pg_temp AS $$
BEGIN
  NEW.created_at := clock_timestamp();
  NEW.recovery_deadline := NEW.created_at + interval '24 hours';
  RETURN NEW;
END; $$;
CREATE TRIGGER initialize_signing_clock BEFORE INSERT ON c3_open.signing_requests
 FOR EACH ROW EXECUTE FUNCTION c3_open.initialize_signing_clock();
