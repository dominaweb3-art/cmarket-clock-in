-- Independent verified contexts. Historical LOCAL_* rows and constraints remain
-- untouched. No intent/position ledger is copied or reclassified.
CREATE TABLE c3_open.leg_context_verifications (
 verification_id uuid PRIMARY KEY,
 intent_id uuid NOT NULL,
 ordinal smallint NOT NULL,
 intent_revision bigint NOT NULL,
 context_hash bytea NOT NULL CHECK(octet_length(context_hash)=32),
 policy_hash bytea NOT NULL CHECK(octet_length(policy_hash)=32),
 evidence_hash bytea NOT NULL CHECK(octet_length(evidence_hash)=32),
 genesis_hash text NOT NULL,
 scope text NOT NULL CHECK(scope IN ('MAINNET_REVIEWED','ISOLATED_VERIFIED')),
 finalized_slot bigint NOT NULL CHECK(finalized_slot>0),
 context jsonb NOT NULL CHECK(jsonb_typeof(context)='object'),
 evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(intent_id,ordinal,intent_revision),
 FOREIGN KEY(intent_id,ordinal) REFERENCES c3_open.legs(intent_id,ordinal),
 CHECK((scope='MAINNET_REVIEWED')=(genesis_hash='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'))
);
CREATE TRIGGER immutable_leg_verification BEFORE UPDATE OR DELETE ON c3_open.leg_context_verifications
 FOR EACH ROW EXECUTE FUNCTION c3_open.reject_immutable();
CREATE VIEW c3_open.all_quote_contexts AS
 SELECT intent_id,ordinal,intent_revision,context,context_hash,scope FROM c3_open.quote_contexts
 UNION ALL SELECT intent_id,ordinal,intent_revision,context,context_hash,scope FROM c3_open.leg_context_verifications;
-- One identity registry ensures the two historical/verified namespaces cannot
-- collide and maintains an actual FK from authorizations to existing contexts.
CREATE TABLE c3_open.quote_context_keys (
 intent_id uuid NOT NULL,ordinal smallint NOT NULL,intent_revision bigint NOT NULL,
 context_hash bytea NOT NULL CHECK(octet_length(context_hash)=32),
 PRIMARY KEY(intent_id,ordinal,intent_revision),
 FOREIGN KEY(intent_id,ordinal) REFERENCES c3_open.legs(intent_id,ordinal)
);
INSERT INTO c3_open.quote_context_keys SELECT intent_id,ordinal,intent_revision,context_hash FROM c3_open.quote_contexts;
CREATE TRIGGER immutable_context_key BEFORE UPDATE OR DELETE ON c3_open.quote_context_keys
 FOR EACH ROW EXECUTE FUNCTION c3_open.reject_immutable();
CREATE FUNCTION c3_open.register_context_key() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,c3_open,pg_temp AS $$
BEGIN
 PERFORM 1 FROM c3_open.intents WHERE intent_id=NEW.intent_id FOR UPDATE;
 INSERT INTO c3_open.quote_context_keys VALUES(NEW.intent_id,NEW.ordinal,NEW.intent_revision,NEW.context_hash);
 RETURN NEW;
END; $$;
CREATE TRIGGER legacy_context_key AFTER INSERT ON c3_open.quote_contexts
 FOR EACH ROW EXECUTE FUNCTION c3_open.register_context_key();
CREATE TRIGGER verified_context_key AFTER INSERT ON c3_open.leg_context_verifications
 FOR EACH ROW EXECUTE FUNCTION c3_open.register_context_key();
ALTER TABLE c3_open.quote_authorizations DROP CONSTRAINT quote_authorizations_intent_id_ordinal_intent_revision_fkey;
ALTER TABLE c3_open.quote_authorizations ADD CONSTRAINT authorization_verified_context_fk
 FOREIGN KEY(intent_id,ordinal,intent_revision) REFERENCES c3_open.quote_context_keys(intent_id,ordinal,intent_revision);
CREATE OR REPLACE FUNCTION c3_open.bind_quote_generation() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,c3_open,pg_temp AS $$
DECLARE ctx jsonb; ctxhash bytea; gen bigint; base bigint;
BEGIN
 SELECT context,context_hash INTO STRICT ctx,ctxhash FROM c3_open.all_quote_contexts
 WHERE intent_id=NEW.intent_id AND ordinal=NEW.ordinal AND intent_revision=NEW.intent_revision;
 IF substring(NEW.canonical_payload FROM 18 FOR 32)<>ctxhash THEN RAISE EXCEPTION 'C3_OPEN_CONTEXT_BYTES'; END IF;
 SELECT generation,base_revision INTO gen,base FROM c3_open.plan_generations
 WHERE intent_id=NEW.intent_id AND plan=ctx->>'plan' ORDER BY generation DESC LIMIT 1;
 IF (ctx->>'planRevision')::bigint<COALESCE(base,0) THEN RAISE EXCEPTION 'C3_OPEN_OBSOLETE_GENERATION'; END IF;
 INSERT INTO c3_open.quote_generations VALUES(NEW.quote_id,NEW.intent_id,ctx->>'plan',COALESCE(gen,0),(ctx->>'planRevision')::bigint);
 RETURN NEW;
END; $$;
REVOKE ALL ON c3_open.leg_context_verifications,c3_open.quote_context_keys,c3_open.all_quote_contexts FROM PUBLIC;
