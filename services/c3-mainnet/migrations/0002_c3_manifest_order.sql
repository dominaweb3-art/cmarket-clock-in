-- Forward-only database ordering guard; this does not certify governance evidence.
CREATE UNIQUE INDEX c3_manifest_hash_unique ON c3.c3_manifest_events(manifest_hash);
CREATE UNIQUE INDEX c3_manifest_predecessor_unique ON c3.c3_manifest_events(previous_hash) WHERE previous_hash IS NOT NULL;

CREATE FUNCTION c3.c3_guard_manifest_insert() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, c3, pg_temp AS $$
DECLARE previous_status text;
BEGIN
  IF NEW.status = 'proposed' THEN
    IF NEW.revision <> 1 OR NEW.previous_hash IS NOT NULL THEN
      RAISE EXCEPTION 'C3 proposal must start at revision one without a predecessor';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.revision <= 1 OR NEW.previous_hash IS NULL THEN
    RAISE EXCEPTION 'C3 manifest transition lacks predecessor';
  END IF;
  SELECT status INTO previous_status FROM c3.c3_manifest_events
    WHERE manifest_hash=NEW.previous_hash
      AND revision=NEW.revision-1
      AND configuration_version=NEW.configuration_version
    FOR SHARE;
  IF previous_status IS NULL OR NOT (
    (previous_status='proposed' AND NEW.status='verified') OR
    (previous_status='verified' AND NEW.status='security_approved') OR
    (previous_status='security_approved' AND NEW.status='governance_approved') OR
    (previous_status='governance_approved' AND NEW.status='deployment_ready') OR
    (previous_status='deployment_ready' AND NEW.status='deployed') OR
    (previous_status='deployed' AND NEW.status='paused') OR
    (previous_status='paused' AND NEW.status='deployed')
  ) THEN
    RAISE EXCEPTION 'C3 manifest predecessor or transition is invalid';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER c3_manifest_order BEFORE INSERT ON c3.c3_manifest_events
FOR EACH ROW EXECUTE FUNCTION c3.c3_guard_manifest_insert();
