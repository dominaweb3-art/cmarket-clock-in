use crate::{constants::*, errors::VaultError, state::*};
use anchor_lang::prelude::*;

#[allow(clippy::too_many_arguments)]
pub fn initialize(
    plan: &mut SettlementPlan,
    config: &VaultConfig,
    vault: Pubkey,
    intent: Pubkey,
    wallet: Pubkey,
    direction: u8,
    inputs: [Pubkey; 3],
    outputs: [Pubkey; 3],
    sources: [Pubkey; 3],
    destinations: [Pubkey; 3],
    route_hashes: [[u8; 32]; 3],
    minimum_outputs: [u64; 3],
    quote_created_at: i64,
    expires_at: i64,
    max_slippage_bps: u16,
    idempotency: [u8; 32],
    bump: u8,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(
        !config.paused
            && config.allowlisted_owner == wallet
            && config.lifecycle
                == (if direction == plan_direction::DEPOSIT {
                    1
                } else {
                    3
                }),
        VaultError::InvalidState
    );
    require!(
        direction == plan_direction::DEPOSIT || direction == plan_direction::REDEMPTION,
        VaultError::InvalidPlan
    );
    let quote_age = now
        .checked_sub(quote_created_at)
        .ok_or(VaultError::Expired)?;
    let remaining = expires_at.checked_sub(now).ok_or(VaultError::Expired)?;
    require!(
        (0..=MAX_QUOTE_AGE_SECONDS).contains(&quote_age)
            && remaining > 0
            && remaining <= MAX_PLAN_SECONDS,
        VaultError::Expired
    );
    require!(
        max_slippage_bps > 0 && max_slippage_bps <= MAX_SLIPPAGE_BPS,
        VaultError::InvalidPlan
    );
    require!(
        idempotency != [0; 32]
            && route_hashes.iter().all(|hash| *hash != [0; 32])
            && minimum_outputs.iter().all(|minimum| *minimum > 0),
        VaultError::InvalidPlan
    );
    require!(
        config.btc_bps == BTC_BPS
            && config.eth_bps == ETH_BPS
            && config.sol_bps == SOL_BPS
            && u32::from(BTC_BPS) + u32::from(ETH_BPS) + u32::from(SOL_BPS) == u32::from(TOTAL_BPS),
        VaultError::InvalidConfig
    );
    require_keys_eq!(config.allowlisted_owner, wallet, VaultError::Unauthorized);
    plan.schema_version = 2;
    plan.config_version = config.config_version;
    plan.vault = vault;
    plan.intent = intent;
    plan.wallet = wallet;
    plan.share_mint = config.share_mint;
    plan.direction = direction;
    plan.amount = ONE_USDC;
    plan.weights = [BTC_BPS, ETH_BPS, SOL_BPS];
    plan.input_mints = inputs;
    plan.output_mints = outputs;
    plan.source_accounts = sources;
    plan.destination_accounts = destinations;
    // Bind the real plan before its first server-side quote is enrolled. The
    // historical mock shortcut keeps its own program ID; it is not Jupiter.
    plan.router_program = initial_router_program()?;
    plan.route_hashes = route_hashes;
    plan.minimum_outputs = minimum_outputs;
    plan.max_slippage_bps = max_slippage_bps;
    plan.quote_created_at = quote_created_at;
    plan.expires_at = expires_at;
    plan.executed_bitmap = 0;
    plan.lifecycle = if direction == plan_direction::DEPOSIT {
        plan_lifecycle::FUNDED
    } else {
        plan_lifecycle::REDEMPTION_REQUESTED
    };
    plan.revision = 0;
    plan.idempotency = idempotency;
    plan.actual_inputs = [0; 3];
    plan.input_budgets = if direction == plan_direction::DEPOSIT {
        [400_000, 300_000, 300_000]
    } else {
        // Caller binds this immediately from the verified redemption intent.
        [0; 3]
    };
    plan.actual_outputs = [0; 3];
    plan.failure_evidence = [0; 32];
    plan.active_swap_authorization = [0; 32];
    plan.active_swap_expires_at = 0;
    plan.bump = bump;
    Ok(())
}

fn initial_router_program() -> Result<Pubkey> {
    #[cfg(feature = "local-mock")]
    {
        Ok(crate::ID)
    }
    #[cfg(not(feature = "local-mock"))]
    {
        crate::swap_leg::reviewed_router()
    }
}

#[cfg(test)]
mod router_binding_tests {
    use super::*;
    #[test]
    fn first_quote_context_has_the_reviewed_router_without_enabling_execution() {
        #[cfg(not(feature = "local-mock"))]
        {
            assert_eq!(
                initial_router_program().unwrap(),
                crate::swap_leg::reviewed_router().unwrap()
            );
            assert_ne!(initial_router_program().unwrap(), crate::ID);
            assert!(!ROUTER_EXECUTION_ENABLED);
        }
        #[cfg(feature = "local-mock")]
        assert_eq!(initial_router_program().unwrap(), crate::ID);
    }
    #[test]
    fn recovery_preserves_partial_inventory_and_invalidates_old_seals() {
        for (bitmap, lifecycle) in [
            (0, plan_lifecycle::FUNDED),
            (1, plan_lifecycle::BUYING),
            (3, plan_lifecycle::SELLING),
        ] {
            let mut p = SettlementPlan {
                schema_version: 2,
                revision: 7,
                expires_at: 100,
                executed_bitmap: bitmap,
                lifecycle,
                direction: if lifecycle == plan_lifecycle::SELLING {
                    plan_direction::REDEMPTION
                } else {
                    plan_direction::DEPOSIT
                },
                input_budgets: [40, 30, 30],
                actual_inputs: if bitmap == 0 {
                    [0; 3]
                } else if bitmap == 1 {
                    [40, 0, 0]
                } else {
                    [40, 30, 0]
                },
                actual_outputs: if bitmap == 0 {
                    [0; 3]
                } else if bitmap == 1 {
                    [8, 0, 0]
                } else {
                    [8, 9, 0]
                },
                minimum_outputs: [1, 2, 3],
                active_swap_authorization: [9; 32],
                active_swap_expires_at: 100,
                ..Default::default()
            };
            assert!(renew(&mut p, 6, 100, 120).is_err());
            assert!(renew(&mut p, 7, 99, 120).is_err());
            assert!(renew(&mut p, 7, 100, 221).is_err());
            renew(&mut p, 7, 100, 220).unwrap();
            assert_eq!(p.revision, 8);
            assert_eq!(p.executed_bitmap, bitmap);
            assert_eq!(p.input_budgets, [40, 30, 30]);
            assert_eq!(
                p.actual_outputs,
                if bitmap == 0 {
                    [0; 3]
                } else if bitmap == 1 {
                    [8, 0, 0]
                } else {
                    [8, 9, 0]
                }
            );
            assert_eq!(p.minimum_outputs, [1, 2, 3]);
            assert_eq!(p.active_swap_authorization, [0; 32]);
            assert!(renew(&mut p, 7, 220, 240).is_err());
        }
        let mut finished = SettlementPlan {
            schema_version: 2,
            revision: 3,
            expires_at: 100,
            executed_bitmap: 7,
            lifecycle: plan_lifecycle::ACTIVE,
            ..Default::default()
        };
        assert!(renew(&mut finished, 3, 100, 120).is_err());
        finished.executed_bitmap = 2;
        assert!(renew(&mut finished, 3, 100, 120).is_err());
    }
}

pub fn check_next_leg(
    plan: &SettlementPlan,
    direction: u8,
    leg: u8,
    expected_revision: u64,
    route_hash: [u8; 32],
) -> Result<()> {
    require_eq!(plan.direction, direction, VaultError::InvalidPlan);
    require_eq!(plan.revision, expected_revision, VaultError::InvalidState);
    require!(leg < 3, VaultError::InvalidLeg);
    require_eq!(
        plan.executed_bitmap,
        (1u8 << leg) - 1,
        VaultError::InvalidLeg
    );
    require!(
        plan.route_hashes[usize::from(leg)] == route_hash,
        VaultError::InvalidPlan
    );
    require!(
        Clock::get()?.unix_timestamp < plan.expires_at,
        VaultError::Expired
    );
    require!(
        plan.lifecycle == plan_lifecycle::FUNDED
            || plan.lifecycle == plan_lifecycle::BUYING
            || plan.lifecycle == plan_lifecycle::REDEMPTION_REQUESTED
            || plan.lifecycle == plan_lifecycle::SELLING
            || plan.lifecycle == plan_lifecycle::PARTIALLY_COMPLETED,
        VaultError::InvalidState
    );
    Ok(())
}

pub fn record_leg(plan: &mut SettlementPlan, leg: u8, input: u64, output: u64) -> Result<()> {
    require!(
        output >= plan.minimum_outputs[usize::from(leg)],
        VaultError::MinimumOutput
    );
    plan.actual_inputs[usize::from(leg)] = input;
    plan.actual_outputs[usize::from(leg)] = output;
    plan.executed_bitmap |= 1u8 << leg;
    plan.revision = plan.revision.checked_add(1).ok_or(VaultError::Math)?;
    plan.lifecycle = if plan.executed_bitmap == 0b111 {
        if plan.direction == plan_direction::DEPOSIT {
            plan_lifecycle::ACTIVE
        } else {
            plan_lifecycle::CLAIMABLE
        }
    } else if plan.direction == plan_direction::DEPOSIT {
        plan_lifecycle::BUYING
    } else {
        plan_lifecycle::SELLING
    };
    Ok(())
}

pub fn renew(
    plan: &mut SettlementPlan,
    expected_revision: u64,
    now: i64,
    expires_at: i64,
) -> Result<()> {
    require!(
        plan.schema_version == 2 && plan.revision == expected_revision,
        VaultError::InvalidPlan
    );
    require!(
        now >= plan.expires_at
            && expires_at > now
            && expires_at.checked_sub(now).ok_or(VaultError::Math)? <= MAX_PLAN_SECONDS,
        VaultError::Expired
    );
    require!(
        matches!(plan.executed_bitmap, 0 | 1 | 3)
            && matches!(
                plan.lifecycle,
                plan_lifecycle::FUNDED
                    | plan_lifecycle::BUYING
                    | plan_lifecycle::REDEMPTION_REQUESTED
                    | plan_lifecycle::SELLING
                    | plan_lifecycle::PARTIALLY_COMPLETED
            ),
        VaultError::InvalidState
    );
    let initial = if plan.direction == plan_direction::DEPOSIT {
        plan_lifecycle::FUNDED
    } else {
        require_eq!(
            plan.direction,
            plan_direction::REDEMPTION,
            VaultError::InvalidPlan
        );
        plan_lifecycle::REDEMPTION_REQUESTED
    };
    require!(
        (plan.executed_bitmap == 0 && plan.lifecycle == initial)
            || (plan.executed_bitmap != 0
                && plan.lifecycle
                    == if plan.direction == plan_direction::DEPOSIT {
                        plan_lifecycle::BUYING
                    } else {
                        plan_lifecycle::SELLING
                    })
            || (plan.executed_bitmap != 0 && plan.lifecycle == plan_lifecycle::PARTIALLY_COMPLETED),
        VaultError::InvalidState
    );
    for leg in 0..3 {
        require!(
            plan.input_budgets[leg] > 0 && plan.minimum_outputs[leg] > 0,
            VaultError::InvalidPlan
        );
        if plan.executed_bitmap & (1 << leg) != 0 {
            require!(
                plan.actual_inputs[leg] == plan.input_budgets[leg]
                    && plan.actual_outputs[leg] >= plan.minimum_outputs[leg],
                VaultError::InvalidPlan
            );
        } else {
            require!(
                plan.actual_inputs[leg] == 0 && plan.actual_outputs[leg] == 0,
                VaultError::InvalidPlan
            );
        }
    }
    // A monotonic generation binds fresh seals. Account locks decide whether an
    // uncertain swap landed first; old signed envelopes can never replay.
    plan.revision = plan.revision.checked_add(1).ok_or(VaultError::Math)?;
    plan.expires_at = expires_at;
    plan.active_swap_authorization = [0; 32];
    plan.active_swap_expires_at = 0;
    Ok(())
}
