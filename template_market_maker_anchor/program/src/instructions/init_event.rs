use anchor_lang::prelude::*;

use crate::InitEvent;
use crate::state::{EventState, GameStateWire};
use crate::wire::EventIdArg;

pub fn handler(ctx: Context<InitEvent>, event_id: EventIdArg) -> Result<()> {
   ctx.accounts.event_state.set_inner(EventState {
      bump: ctx.bumps.event_state,
      event: event_id.id.event,
      league: event_id.id.league,
      sport: event_id.id.sport,
      sequence: 0,
      game_state: GameStateWire::default(),
   });
   Ok(())
}
