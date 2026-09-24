use anchor_lang::prelude::*;

use crate::CloseEvent;
use crate::wire::EventIdArg;

pub fn handler(ctx: Context<CloseEvent>, event_id: EventIdArg) -> Result<()> {
   if !ctx.accounts.event_state.matches_id(&event_id.id) {
      return Err(ProgramError::InvalidAccountData.into());
   }
   Ok(())
}
