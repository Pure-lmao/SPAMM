use pinocchio::Address;
use zeropod::{ZeroPod, ZeroPodFixed};

/// MM-owned config PDA body (`["config"]` under the MM program). Discriminator `1`; `auth_signer`
/// is the key allowed to invoke this aggregator for non-quoting flows that pass `config_pda`.
#[derive(Copy, Clone, ZeroPod)]
pub struct MmAccountConfig {
   pub discriminator: u8,
   pub bump: u8,
   pub auth_signer: Address,
   // MM config can have more if it wants to
}

pub const MM_ACCOUNT_CONFIG_SEED: &[u8] = b"config";
pub const MM_ACCOUNT_CONFIG_DISCRIMINATOR: u8 = 1;
pub const MM_ACCOUNT_CONFIG_MIN_LEN: usize = <MmAccountConfig as ZeroPodFixed>::SIZE;
pub const MM_CONFIG_PDA_BUMP_OFFSET: usize = 1;
pub const MM_CONFIG_PDA_AUTHORITY_OFFSET: usize = 2;
