-- Same existing owner-signed on-chain recovery instruction, evaluation only.
BEGIN;
ALTER TABLE c3_eval.owner_requests DROP CONSTRAINT owner_requests_action_check;
ALTER TABLE c3_eval.owner_requests ADD CONSTRAINT owner_requests_action_check
 CHECK(action IN ('deposit','issue_shares','request_redemption','claim','renew_plan','recover_deposit_plan'));
COMMIT;
