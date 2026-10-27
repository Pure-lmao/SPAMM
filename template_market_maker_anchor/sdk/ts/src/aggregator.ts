import type { Address } from '@solana/kit';
import type { Instruction } from '@solana/instructions';

import {
   getAddLineToNettingAccountIx,
   getCloseNettingAccountIx,
   getCreateNettingAccountIx,
   getDeregisterMmIx,
   getRegisterMmIx,
   getRemoveLineFromNettingAccountIx,
   getWithdrawFromLiabilityAccountIx,
} from 'spamm-aggregator-sdk';

import { ANCHOR_TEMPLATE_MM_PROGRAM_ID } from './constants.js';
import type { EventId } from './types.js';
import { assertU64 } from './validate.js';

const PROGRAM = ANCHOR_TEMPLATE_MM_PROGRAM_ID;

/** Aggregator `register_mm` for this program. Creates the encumbrance PDA and liability ATA. */
export function getRegisterIx(mmAdmin: Address): Promise<Instruction> {
   return getRegisterMmIx(mmAdmin, PROGRAM);
}

export function getDeregisterIx(aggregatorAdmin: Address, mmAdmin: Address, mint: Address): Promise<Instruction> {
   return getDeregisterMmIx(aggregatorAdmin, mmAdmin, PROGRAM, mint);
}

export function getCreateNettingIx(eventId: EventId, operator: Address, mint: Address, mmAdmin: Address): Promise<Instruction> {
   return getCreateNettingAccountIx(eventId, operator, mint, mmAdmin, PROGRAM);
}

export function getAddNettingLineIx(
   eventId: EventId,
   operator: Address,
   mint: Address,
   period: number,
   mkt: number,
   admin: Address,
): Promise<Instruction> {
   return getAddLineToNettingAccountIx(eventId, operator, mint, period, mkt, admin, PROGRAM);
}

export function getRemoveNettingLineIx(
   eventId: EventId,
   operator: Address,
   mint: Address,
   period: number,
   mkt: number,
   admin: Address,
): Promise<Instruction> {
   return getRemoveLineFromNettingAccountIx(eventId, operator, mint, period, mkt, admin, PROGRAM);
}

export function getCloseNettingIx(eventId: EventId, operator: Address, mint: Address, mmAdmin: Address): Promise<Instruction> {
   return getCloseNettingAccountIx(eventId, operator, mint, mmAdmin, PROGRAM);
}

export function getWithdrawLiabilityIx(amount: bigint, mmAdmin: Address, mint: Address): Promise<Instruction> {
   assertU64(amount, 'amount');
   return getWithdrawFromLiabilityAccountIx(amount, mmAdmin, PROGRAM, mint);
}
