-- Disabled owner-pilot builder configuration and validated manifest storage.
-- No configuration is seeded; migration never authorizes execution.
CREATE TABLE c3.c3_pilot_builder_configurations (
  configuration_hash text PRIMARY KEY CHECK (configuration_hash ~ '^[a-f0-9]{64}$'),
  configuration_version text NOT NULL UNIQUE CHECK (length(configuration_version) BETWEEN 3 AND 96),
  cluster text NOT NULL CHECK (cluster='mainnet-beta'),
  vault text NOT NULL CHECK (vault ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  share_mint text NOT NULL CHECK (share_mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  owner_wallet text NOT NULL CHECK (owner_wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  usdc_mint text NOT NULL CHECK (usdc_mint='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  symmetry_program text NOT NULL CHECK (symmetry_program='BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate'),
  btc_target_bps integer NOT NULL CHECK (btc_target_bps=4000),
  eth_target_bps integer NOT NULL CHECK (eth_target_bps=3000),
  sol_target_bps integer NOT NULL CHECK (sol_target_bps=3000),
  pilot_amount_base_units numeric(20,0) NOT NULL CHECK (pilot_amount_base_units=1000000),
  rpc_https_url text NOT NULL CHECK (rpc_https_url ~ '^https://[^/@?#[:space:]]+(/[^?#[:space:]]*)?$'),
  security_approval_hash text NOT NULL CHECK (security_approval_hash ~ '^[a-f0-9]{64}$'),
  governance_approval_hash text NOT NULL CHECK (governance_approval_hash ~ '^[a-f0-9]{64}$'),
  deployment_evidence_hash text NOT NULL CHECK (deployment_evidence_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER c3_pilot_config_immutable BEFORE UPDATE OR DELETE ON c3.c3_pilot_builder_configurations
  FOR EACH ROW EXECUTE FUNCTION c3.c3_reject_immutable_change();

CREATE TABLE c3.c3_pilot_authorization_manifests (
  intent_id text PRIMARY KEY REFERENCES c3.c3_pilot_intents(intent_id) ON DELETE RESTRICT,
  configuration_hash text NOT NULL REFERENCES c3.c3_pilot_builder_configurations(configuration_hash) ON DELETE RESTRICT,
  intent_revision bigint NOT NULL CHECK (intent_revision > 0),
  operation text NOT NULL CHECK (operation IN ('deposit','redemption')),
  manifest_hash text NOT NULL UNIQUE CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  canonical_json text NOT NULL CHECK (octet_length(canonical_json) BETWEEN 100 AND 64000),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (expires_at > created_at)
);
CREATE TRIGGER c3_pilot_manifest_immutable BEFORE UPDATE OR DELETE ON c3.c3_pilot_authorization_manifests
  FOR EACH ROW EXECUTE FUNCTION c3.c3_reject_immutable_change();
