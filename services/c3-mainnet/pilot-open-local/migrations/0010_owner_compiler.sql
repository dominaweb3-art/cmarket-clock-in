-- Additive shared compiler enrollment. Existing request/signature/evidence rows
-- are not rewritten. Renewal is an explicitly owner-signed request, not a retry.
ALTER TABLE c3_open.owner_requests DROP CONSTRAINT owner_requests_action_check;
ALTER TABLE c3_open.owner_requests ADD CONSTRAINT owner_requests_action_check CHECK(action IN ('deposit','issue_shares','request_redemption','claim','renew_plan'));
ALTER TABLE c3_open.owner_request_outcomes DROP CONSTRAINT owner_request_outcomes_outcome_check;
ALTER TABLE c3_open.owner_request_outcomes ADD CONSTRAINT owner_request_outcomes_outcome_check CHECK(outcome IN ('expired_unexecuted','cancelled_unexecuted','failed_finalized'));
CREATE TABLE c3_open.owner_authorization_manifests (
 request_id uuid PRIMARY KEY REFERENCES c3_open.owner_requests(request_id),
 policy_hash text NOT NULL CHECK(policy_hash ~ '^[a-f0-9]{64}$'),
 manifest jsonb NOT NULL CHECK(jsonb_typeof(manifest)='object'),
 manifest_hash bytea NOT NULL CHECK(octet_length(manifest_hash)=32),
 pre_accounts jsonb NOT NULL CHECK(jsonb_typeof(pre_accounts)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER immutable_owner_authorization_manifest BEFORE UPDATE OR DELETE ON c3_open.owner_authorization_manifests
 FOR EACH ROW EXECUTE FUNCTION c3_open.reject_owner_mutation();
CREATE TABLE c3_open.production_enrollments (
 intent_id uuid PRIMARY KEY REFERENCES c3_open.intents(intent_id),
 policy_hash text NOT NULL CHECK(policy_hash ~ '^[a-f0-9]{64}$'),
 configuration_evidence_hash text NOT NULL CHECK(configuration_evidence_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER immutable_production_enrollment BEFORE UPDATE OR DELETE ON c3_open.production_enrollments
 FOR EACH ROW EXECUTE FUNCTION c3_open.reject_owner_mutation();
REVOKE ALL ON c3_open.owner_authorization_manifests,c3_open.production_enrollments FROM PUBLIC;
