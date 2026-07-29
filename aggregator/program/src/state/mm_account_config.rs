use pinocchio::Address;
use zeropod::{ZeroPod, ZeroPodFixed};

/// MM-owned config PDA body (`["config"]` under the MM program). Discriminator `1`; `admin`
/// is the key allowed to invoke this aggregator for non-quoting flows that pass `config_pda`.
/// `rfq_signer` verifies off-chain RFQ quote ed25519 signatures.
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct MmAccountConfig {
   pub discriminator: u8,
   pub bump: u8,
   pub admin: Address,
   pub rfq_signer: Address,
}

pub const MM_ACCOUNT_CONFIG_SEED: &[u8] = b"config";
pub const MM_ACCOUNT_CONFIG_DISCRIMINATOR: u8 = 1;
pub const MM_ACCOUNT_CONFIG_MIN_LEN: usize = <MmAccountConfig as ZeroPodFixed>::SIZE;
pub const MM_CONFIG_PDA_BUMP_OFFSET: usize = 1;
pub const MM_CONFIG_PDA_ADMIN_OFFSET: usize = 2;
pub const MM_CONFIG_PDA_RFQ_SIGNER_OFFSET: usize = 34;

const _: () = assert!(core::mem::size_of::<MmAccountConfig>() == MM_ACCOUNT_CONFIG_MIN_LEN);
