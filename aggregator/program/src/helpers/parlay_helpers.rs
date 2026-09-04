//! Shared parlay odds layout, ticket folding, and modified-win settlement math.

use pinocchio::{error::ProgramError, hint::unlikely};
use pinocchio_log::log;

use crate::{
   constants::{MAX_RFQ_PARLAY_LEGS, ODDS_SCALE},
   errors::SpammError,
   state::{
      account_bet::BetResult,
      account_cashout_parlay::CashoutParlayAccountData,
      account_parlay_bet::{ParlayBetAccountData, ParlayLegSettleView},
      ids::EventId,
      mm_parlay_quote::{ParlayLegQuoted, ParlayLegSel, ParlayLegWire},
      MarketId, Sport,
   },
};

/// Market id on any packed parlay-leg layout.
pub trait HasParlayMarketId {
   fn market_id(&self) -> &MarketId;
}

impl HasParlayMarketId for ParlayLegSel {
   #[inline(always)]
   fn market_id(&self) -> &MarketId {
      &self.market_id
   }
}

impl HasParlayMarketId for ParlayLegQuoted {
   #[inline(always)]
   fn market_id(&self) -> &MarketId {
      &self.market_id
   }
}

impl HasParlayMarketId for ParlayLegWire {
   #[inline(always)]
   fn market_id(&self) -> &MarketId {
      &self.market_id
   }
}

/// Per-leg odds + market (quoted / stored legs).
pub trait ParlayLegOddsView: HasParlayMarketId {
   fn odds_scaled(&self) -> u32;
}

impl ParlayLegOddsView for ParlayLegQuoted {
   #[inline(always)]
   fn odds_scaled(&self) -> u32 {
      self.odds_scaled
   }
}

impl ParlayLegOddsView for ParlayLegWire {
   #[inline(always)]
   fn odds_scaled(&self) -> u32 {
      self.odds_scaled
   }
}

/// Fold ticket result from per-leg result bytes already on the account.
#[inline(always)]
pub fn fold_parlay_ticket_result_from_account(
   data: &[u8],
   num_legs: usize,
) -> Result<BetResult, ProgramError> {
   let mut fold = ParlayFoldState::default();
   for i in 0..num_legs {
      fold.observe(ParlayBetAccountData::read_leg_result(data, i)?)?;
   }
   Ok(fold.finish())
}

/// Fold ticket result from per-leg result bytes on a cashout-parlay account.
#[inline(always)]
pub fn fold_cashout_parlay_ticket_result_from_account(
   data: &[u8],
   num_legs: usize,
) -> Result<BetResult, ProgramError> {
   let mut fold = ParlayFoldState::default();
   for i in 0..num_legs {
      fold.observe(CashoutParlayAccountData::read_leg_result(data, i)?)?;
   }
   Ok(fold.finish())
}

#[derive(Default)]
struct ParlayFoldState {
   any_lost: bool,
   any_modified: bool,
   all_won: bool,
   all_void: bool,
   all_rolled_back: bool,
   any_pending: bool,
}

impl ParlayFoldState {
   fn observe(&mut self, result: BetResult) -> Result<(), ProgramError> {
      match result {
         BetResult::Pending => {
            self.any_pending = true;
            self.all_won = false;
            self.all_void = false;
            self.all_rolled_back = false;
         }
         BetResult::Lost => {
            self.any_lost = true;
            self.all_won = false;
            self.all_void = false;
            self.all_rolled_back = false;
         }
         BetResult::Won => {
            self.all_void = false;
            self.all_rolled_back = false;
         }
         BetResult::HalfWon | BetResult::HalfLost => {
            self.any_modified = true;
            self.all_won = false;
            self.all_void = false;
            self.all_rolled_back = false;
         }
         BetResult::Push | BetResult::Cancelled => {
            self.any_modified = true;
            self.all_won = false;
            self.all_rolled_back = false;
         }
         BetResult::RolledBack => {
            self.any_modified = true;
            self.all_won = false;
         }
         BetResult::ModifiedWin | BetResult::CashedOut => {
            log!("ParlayFoldState::observe: invalid leg result (ModifiedWin or CashedOut)");
            return Err(ProgramError::InvalidAccountData);
         }
      }
      Ok(())
   }

   fn finish(self) -> BetResult {
      if self.any_lost {
         return BetResult::Lost;
      }
      if self.all_void {
         if self.all_rolled_back {
            return BetResult::RolledBack;
         }
         return BetResult::Cancelled;
      }
      if self.all_won {
         return BetResult::Won;
      }
      if self.any_pending {
         return BetResult::Pending;
      }
      if self.any_modified {
         return BetResult::ModifiedWin;
      }
      BetResult::Pending
   }
}


/// Product of leg odds with `odds_scaled > 0` (one `/ ODDS_SCALE` per leg). Checked; no wrap.
pub fn product_parlay_odds<L: ParlayLegOddsView>(num_legs: usize, legs: &[L]) -> Result<u32, ProgramError> {
   let mut prod = ODDS_SCALE;
   for i in 0..num_legs {
      let leg = legs.get(i).ok_or(ProgramError::InvalidInstructionData)?;
      if leg.odds_scaled() > 0 {
         prod = prod
            .checked_mul(leg.odds_scaled() as u128).ok_or(ProgramError::ArithmeticOverflow)?
            .checked_div(ODDS_SCALE).ok_or(ProgramError::ArithmeticOverflow)?;
      }
   }
   prod.try_into().map_err(|_| ProgramError::ArithmeticOverflow)
}

/// Same-event companion rules for active legs (`0..num_legs`) — O(n) group scan.
pub fn validate_parlay_same_event_odds<L: ParlayLegOddsView>(
   num_legs: usize,
   legs: &[L],
) -> Result<(), ProgramError> {
   let mut groups: [Option<(EventId, bool)>; MAX_RFQ_PARLAY_LEGS] = [None; MAX_RFQ_PARLAY_LEGS];
   let mut group_count = 0usize;

   for i in 0..num_legs {
      let leg = legs.get(i).ok_or(ProgramError::InvalidInstructionData)?;
      let eid = leg.market_id().event_id;
      let positive = leg.odds_scaled() > 0;
      let mut found = false;
      for g in groups.iter_mut().take(group_count) {
         if let Some((ref ge, ref mut has_pos)) = g {
            if ge.eq(&eid) {
               *has_pos |= positive;
               found = true;
               break;
            }
         }
      }
      if !found {
         if unlikely(group_count >= MAX_RFQ_PARLAY_LEGS) {
            return Err(ProgramError::InvalidInstructionData);
         }
         groups[group_count] = Some((eid, positive));
         group_count += 1;
      }
   }

   for g in groups.iter().take(group_count) {
      let Some((_, has_positive)) = g else {
         continue;
      };
      // Implies every zero-odds leg shares its event with a positive-odds companion.
      if !*has_positive {
         log!("validate_parlay_same_event_odds: each event group needs at least one positive-odds leg");
         return Err(SpammError::ParlayEventRuleViolation.into());
      }
   }

   Ok(())
}

/// Reject two live legs that share the same `MarketId` (including opposite sides).
#[inline(always)]
pub fn validate_unique_parlay_market_ids<L: HasParlayMarketId>(
   num_legs: usize,
   legs: &[L],
) -> Result<(), ProgramError> {
   for i in 0..num_legs {
      let a = legs.get(i).ok_or(ProgramError::InvalidInstructionData)?;
      for j in (i + 1)..num_legs {
         let b = legs.get(j).ok_or(ProgramError::InvalidInstructionData)?;
         if a.market_id().eq(b.market_id()) {
            log!("validate_unique_parlay_market_ids: duplicate market_id at legs {} and {}", i, j);
            return Err(SpammError::ParlayEventRuleViolation.into());
         }
      }
   }
   Ok(())
}

pub fn ensure_parlay_odds_product_matches<L: ParlayLegOddsView>(
   num_legs: usize,
   legs: &[L],
   expected_odds: u32,
) -> Result<(), ProgramError> {
   let product = product_parlay_odds(num_legs, legs)?;
   if unlikely(product != expected_odds) {
      log!("parlay odds product mismatch");
      return Err(SpammError::ParlayOddsMismatch.into());
   }
   Ok(())
}

/// Apply per-leg odds from MM return wire onto fill/quote selections (Pending result).
pub fn apply_leg_odds(
   num_legs: usize,
   sels: &[ParlayLegSel],
   leg_odds: &[u32],
   out: &mut [ParlayLegWire],
) {
   for i in 0..num_legs {
      let Some(sel) = sels.get(i) else {
         return;
      };
      let Some(&odds) = leg_odds.get(i) else {
         return;
      };
      if let Some(dst) = out.get_mut(i) {
         *dst = sel.with_odds_pending(odds);
      }
   }
}

/// Modified-win settlement from account bytes (reads only event_id / odds / result per leg).
pub fn compute_modified_parlay_settlement_from_account(
   stake: u64,
   data: &[u8],
   num_legs: usize,
) -> Result<(u64, bool), ProgramError> {
   let mut views = [ParlayLegSettleView {
      event_id: EventId {
         event: 0,
         league: 0,
         sport: Sport::Invalid,
      },
      odds_scaled: 0,
      result: BetResult::Pending,
   }; MAX_RFQ_PARLAY_LEGS];
   for i in 0..num_legs {
      views[i] = ParlayBetAccountData::read_leg_settle_view(data, i)?;
   }
   compute_modified_parlay_settlement(stake, num_legs, &views[..num_legs])
}

/// Modified-win settlement from cashout-parlay account bytes.
pub fn compute_modified_cashout_parlay_settlement_from_account(
   stake: u64,
   data: &[u8],
   num_legs: usize,
) -> Result<(u64, bool), ProgramError> {
   let mut views = [ParlayLegSettleView {
      event_id: EventId {
         event: 0,
         league: 0,
         sport: Sport::Invalid,
      },
      odds_scaled: 0,
      result: BetResult::Pending,
   }; MAX_RFQ_PARLAY_LEGS];
   for i in 0..num_legs {
      views[i] = CashoutParlayAccountData::read_leg_settle_view(data, i)?;
   }
   compute_modified_parlay_settlement(stake, num_legs, &views[..num_legs])
}

/// Modified-win settlement: returns `(user_return, is_full_loss)`.
pub fn compute_modified_parlay_settlement(
   stake: u64,
   num_legs: usize,
   legs: &[ParlayLegSettleView],
) -> Result<(u64, bool), ProgramError> {
   let mut dropped = [false; MAX_RFQ_PARLAY_LEGS];

   let mut group_rep = [usize::MAX; MAX_RFQ_PARLAY_LEGS];
   let mut group_drop = [false; MAX_RFQ_PARLAY_LEGS];
   let mut group_count = 0usize;

   for i in 0..num_legs {
      let leg = legs.get(i).ok_or(ProgramError::InvalidInstructionData)?;
      let eid = leg.event_id;
      let mut gidx = None;
      for g in 0..group_count {
         let rep = group_rep[g];
         let rep_leg = legs.get(rep).ok_or(ProgramError::InvalidInstructionData)?;
         if eid.eq(&rep_leg.event_id) {
            gidx = Some(g);
            break;
         }
      }
      let g = match gidx {
         Some(g) => g,
         None => {
            if unlikely(group_count >= MAX_RFQ_PARLAY_LEGS) {
               return Err(ProgramError::InvalidInstructionData);
            }
            let g = group_count;
            group_rep[g] = i;
            group_count += 1;
            g
         }
      };
      if leg.result == BetResult::Cancelled
         || (leg.odds_scaled == 0 && leg.result.is_void_like())
      {
         group_drop[g] = true;
      }
   }

   for i in 0..num_legs {
      let leg = legs.get(i).ok_or(ProgramError::InvalidInstructionData)?;
      let eid = leg.event_id;
      for g in 0..group_count {
         if !group_drop[g] {
            continue;
         }
         let rep = group_rep[g];
         let rep_leg = legs.get(rep).ok_or(ProgramError::InvalidInstructionData)?;
         if eid.eq(&rep_leg.event_id) {
            dropped[i] = true;
            break;
         }
      }
   }

   let mut acc = ODDS_SCALE;
   for i in 0..num_legs {
      if dropped[i] {
         continue;
      }
      let leg = legs.get(i).ok_or(ProgramError::InvalidInstructionData)?;
      match leg.result {
         BetResult::Lost => {
            return Ok((0, true));
         }
         BetResult::Won => {
            let odds = if leg.odds_scaled > 0 {
               leg.odds_scaled as u128
            } else {
               ODDS_SCALE
            };
            acc = acc
               .checked_mul(odds).and_then(|x| x.checked_div(ODDS_SCALE)).ok_or(ProgramError::ArithmeticOverflow)?;
         }
         BetResult::HalfWon => {
            let odds = if leg.odds_scaled > 0 {
               leg.odds_scaled as u128
            } else {
               ODDS_SCALE
            };
            let two_scale = ODDS_SCALE
               .checked_mul(2).ok_or(ProgramError::ArithmeticOverflow)?;
            let half_factor = odds
               .checked_add(ODDS_SCALE).ok_or(ProgramError::ArithmeticOverflow)?;
            acc = acc
               .checked_mul(half_factor).and_then(|x| x.checked_div(two_scale)).ok_or(ProgramError::ArithmeticOverflow)?;
         }
         BetResult::HalfLost => {
            acc = acc
               .checked_div(2).ok_or(ProgramError::ArithmeticOverflow)?;
         }
         BetResult::Push | BetResult::Cancelled | BetResult::RolledBack => {}
         BetResult::Pending | BetResult::ModifiedWin | BetResult::CashedOut => {
            log!("compute_modified_parlay_settlement: invalid leg result");
            return Err(ProgramError::InvalidAccountData);
         }
      }
   }

   let user_return = (stake as u128)
      .checked_mul(acc).and_then(|x| x.checked_div(ODDS_SCALE)).ok_or(ProgramError::ArithmeticOverflow)?
      .try_into()
      .map_err(|_| ProgramError::ArithmeticOverflow)?;

   Ok((user_return, false))
}
