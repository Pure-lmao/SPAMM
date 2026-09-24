use anchor_lang::prelude::*;

use crate::UpdateEventState;
use crate::state::GameStateWire;
use crate::wire::{EventGameStateArg, EventIdArg};

pub fn handler(
   ctx: Context<UpdateEventState>,
   event_id: EventIdArg,
   sequence: u16,
   game_state: EventGameStateArg,
) -> Result<()> {
   let event = &mut ctx.accounts.event_state;
   if !event.matches_id(&event_id.id) {
      return Err(ProgramError::InvalidAccountData.into());
   }
   event.sequence = sequence;
   event.game_state = GameStateWire::from_state(&game_state.0);
   Ok(())
}
