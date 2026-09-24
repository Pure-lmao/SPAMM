use anchor_lang::prelude::*;

#[error_code]
pub enum TemplateError {
   #[msg("signer is not the config admin")]
   NotAdmin,
   #[msg("token vault is empty")]
   EmptyVault,
   #[msg("quote buffer does not match the fill")]
   QuoteMismatch,
}
