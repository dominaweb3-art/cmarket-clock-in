-- Additive evaluation-only enrollment. No production rows or credentials.
BEGIN;
CREATE TABLE c3_eval.wallet_challenges (
  challenge_id uuid PRIMARY KEY,
  wallet text NOT NULL CHECK(wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  audience text NOT NULL CHECK(audience = 'https://cmarket-nine.vercel.app'),
  genesis text NOT NULL CHECK(genesis = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'),
  message_hash bytea NOT NULL UNIQUE CHECK(octet_length(message_hash)=32),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(expires_at>created_at AND expires_at<=created_at+interval '2 minutes')
);
CREATE INDEX evaluation_wallet_challenge_limit ON c3_eval.wallet_challenges(wallet,created_at);
CREATE TABLE c3_eval.wallet_proofs (
  challenge_id uuid PRIMARY KEY REFERENCES c3_eval.wallet_challenges(challenge_id),
  signature bytea NOT NULL CHECK(octet_length(signature)=64),
  verified_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE c3_eval.wallet_sessions (
  session_hash bytea PRIMARY KEY CHECK(octet_length(session_hash)=32),
  challenge_id uuid NOT NULL UNIQUE REFERENCES c3_eval.wallet_proofs(challenge_id),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(expires_at>created_at AND expires_at<=created_at+interval '10 minutes')
);
CREATE TABLE c3_eval.asset_configuration (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  genesis text NOT NULL CHECK(genesis='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'),
  usdc_mint text NOT NULL UNIQUE CHECK(usdc_mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  btc_mint text NOT NULL UNIQUE CHECK(btc_mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  eth_mint text NOT NULL UNIQUE CHECK(eth_mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  sol_mint text NOT NULL UNIQUE CHECK(sol_mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  simulated_assets boolean NOT NULL CHECK(simulated_assets),
  mainnet_enabled boolean NOT NULL CHECK(NOT mainnet_enabled),
  provisioning_evidence_hash bytea NOT NULL CHECK(octet_length(provisioning_evidence_hash)=32),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(usdc_mint<>btc_mint AND usdc_mint<>eth_mint AND usdc_mint<>sol_mint
    AND btc_mint<>eth_mint AND btc_mint<>sol_mint AND eth_mint<>sol_mint)
);
CREATE TABLE c3_eval.wallet_vaults (
  wallet text PRIMARY KEY CHECK(wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  vault text NOT NULL UNIQUE CHECK(vault ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  share_mint text NOT NULL UNIQUE CHECK(share_mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  challenge_id uuid NOT NULL UNIQUE REFERENCES c3_eval.wallet_proofs(challenge_id),
  provisioning_signature text NOT NULL UNIQUE CHECK(provisioning_signature ~ '^[1-9A-HJ-NP-Za-km-z]{64,96}$'),
  provisioning_evidence_hash bytea NOT NULL CHECK(octet_length(provisioning_evidence_hash)=32),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE c3_eval.owner_packet_contexts (
  request_id uuid PRIMARY KEY REFERENCES c3_eval.owner_requests(request_id),
  chain_time bigint NOT NULL CHECK(chain_time>0),
  configuration_hash text NOT NULL CHECK(configuration_hash ~ '^[a-f0-9]{64}$'),
  pre_accounts jsonb NOT NULL CHECK(jsonb_typeof(pre_accounts)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['wallet_challenges','wallet_proofs','wallet_sessions','asset_configuration','wallet_vaults','owner_packet_contexts'] LOOP
    EXECUTE format('ALTER TABLE c3_eval.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON c3_eval.%I FROM PUBLIC,anon,authenticated',t);
    EXECUTE format('CREATE TRIGGER immutable_evaluation_identity BEFORE UPDATE OR DELETE ON c3_eval.%I FOR EACH ROW EXECUTE FUNCTION c3_eval.reject_immutable()',t);
  END LOOP;
END $$;
COMMIT;
