CREATE TABLE IF NOT EXISTS c3_open.keeper_packets (
 request_id uuid PRIMARY KEY, intent_id uuid NOT NULL REFERENCES c3_open.intents,
 action text NOT NULL CHECK(action IN ('create_buy_plan','create_sell_plan','record_buy','record_sell')),
 scope text NOT NULL CHECK(scope IN ('ISOLATED_VERIFIED','MAINNET_REVIEWED')),
 genesis text NOT NULL CHECK((scope='MAINNET_REVIEWED')=(genesis='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')), expected_db_revision bigint NOT NULL CHECK(expected_db_revision>=0),
 expected_chain_revision bigint NOT NULL CHECK(expected_chain_revision>=0),
 packet bytea NOT NULL CHECK(octet_length(packet)<=1232), message_hash bytea NOT NULL CHECK(octet_length(message_hash)=32),
 manifest jsonb NOT NULL, manifest_hash bytea NOT NULL CHECK(octet_length(manifest_hash)=32),
 policy_hash bytea NOT NULL CHECK(octet_length(policy_hash)=32), created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS c3_open.keeper_signatures (
 request_id uuid PRIMARY KEY REFERENCES c3_open.keeper_packets,
 signature text NOT NULL UNIQUE CHECK(signature ~ '^[1-9A-HJ-NP-Za-km-z]{64,96}$'), packet bytea NOT NULL CHECK(octet_length(packet)<=1232),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS c3_open.keeper_send_attempts (
 request_id uuid PRIMARY KEY REFERENCES c3_open.keeper_signatures,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS c3_open.keeper_effect_receipts (
 request_id uuid PRIMARY KEY REFERENCES c3_open.keeper_signatures,
 signature text NOT NULL UNIQUE, finalized_slot bigint NOT NULL CHECK(finalized_slot>0),
 evidence_hash bytea NOT NULL CHECK(octet_length(evidence_hash)=32),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS keeper_intent_packets ON c3_open.keeper_packets(intent_id);
CREATE OR REPLACE FUNCTION c3_open.keeper_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,c3_open,pg_temp AS $$
BEGIN RAISE EXCEPTION 'C3_KEEPER_APPEND_ONLY'; END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['keeper_packets','keeper_signatures','keeper_send_attempts','keeper_effect_receipts'] LOOP
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname=t||'_immutable' AND tgrelid=('c3_open.'||t)::regclass) THEN
 EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON c3_open.%I FOR EACH ROW EXECUTE FUNCTION c3_open.keeper_immutable()',t||'_immutable',t);
 END IF; END LOOP;
END $$;
-- Every opposing preparation locks the same intent BEFORE checking the pending
-- keeper packet. This includes an unsigned packet and never assumes no signature
-- means no possible send. An unresolved/failed packet blocks, not silently retries.
CREATE OR REPLACE FUNCTION c3_open.keeper_pending_barrier() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,c3_open,pg_temp AS $$
BEGIN
 PERFORM 1 FROM c3_open.intents WHERE intent_id=NEW.intent_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM c3_open.keeper_packets p LEFT JOIN c3_open.keeper_effect_receipts r USING(request_id)
 WHERE p.intent_id=NEW.intent_id AND r.request_id IS NULL) THEN RAISE EXCEPTION 'C3_KEEPER_RECONCILE_PENDING'; END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['keeper_packets','owner_requests','renewal_requests','leg_context_verifications'] LOOP
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname=t||'_keeper_barrier' AND tgrelid=('c3_open.'||t)::regclass) THEN
 EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON c3_open.%I FOR EACH ROW EXECUTE FUNCTION c3_open.keeper_pending_barrier()',t||'_keeper_barrier',t);
 END IF; END LOOP;
END $$;
REVOKE ALL ON c3_open.keeper_packets,c3_open.keeper_signatures,c3_open.keeper_send_attempts,c3_open.keeper_effect_receipts FROM PUBLIC;
