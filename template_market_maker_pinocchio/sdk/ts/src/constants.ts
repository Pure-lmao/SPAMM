import { address, type Address } from '@solana/kit';

/** Pinocchio template SPAMM. `3YwnUYagW5WK8sN5i8e9UCcvipHKifxgmF7ajUbuDuGA`. */
export const PINOCCHIO_TEMPLATE_MM_PROGRAM_ID: Address = address(
   '3YwnUYagW5WK8sN5i8e9UCcvipHKifxgmF7ajUbuDuGA',
);

/** `["config"]` under the pinocchio template program. */
export const PINOCCHIO_TEMPLATE_MM_CONFIG_PDA: Address = address(
   'Bg466MjsEm74FvwFWzH7rPNwaEGxCvkM5EVx7xr97igF',
);

/** `["mm_quote_buffer"]`. */
export const PINOCCHIO_TEMPLATE_MM_QUOTE_BUFFER_PDA: Address = address(
   'F5p8hXqmsG2hWt7giXejKiMWZTYsD4RpewKNvsHNLLYw',
);

/** `["mm_parlay_quote_buffer"]`. */
export const PINOCCHIO_TEMPLATE_MM_PARLAY_QUOTE_BUFFER_PDA: Address = address(
   'BaBjAxyMzCb1b2hzDNsysPZAH56XedDLQB1e5SngoBvg',
);

/** Aggregator `["encumbrance", program id]`. Liability ATA authority. */
export const PINOCCHIO_TEMPLATE_MM_ENCUMBRANCE_PDA: Address = address(
   '2XNi16GzroHkt4Wd6kxo7EciXZoFnUaA849fFA9pRCat',
);

export const INIT_PROGRAM_IX_DISCRIMINATOR = 100;
export const SET_RFQ_SIGNER_IX_DISCRIMINATOR = 101;
export const INIT_EVENT_IX_DISCRIMINATOR = 110;
export const INIT_MARKET_IX_DISCRIMINATOR = 111;
export const CLOSE_EVENT_IX_DISCRIMINATOR = 112;
export const CLOSE_MARKET_IX_DISCRIMINATOR = 113;
export const UPDATE_EVENT_STATE_IX_DISCRIMINATOR = 114;
export const UPDATE_MARKET_IX_DISCRIMINATOR = 115;
export const WITHDRAW_FROM_TOKEN_ACCOUNT_IX_DISCRIMINATOR = 150;
