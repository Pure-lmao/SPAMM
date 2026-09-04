use core::mem::offset_of;

use pinocchio::Address;
use zeropod::{ZeroPod, ZeroPodFixed};

/// MM-owned config PDA body (`["config"]` under the MM program). Discriminator `101`; `admin`
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
pub const MM_ACCOUNT_CONFIG_DISCRIMINATOR: u8 = 101;
/// Packed header size (`discriminator` + `bump` + `admin` + `rfq_signer`). Account may be longer.
pub const MM_CONFIG_PDA_HEADER_LEN: usize = <MmAccountConfig as ZeroPodFixed>::SIZE;
pub const MM_CONFIG_PDA_BUMP_OFFSET: usize = offset_of!(MmAccountConfigZc, bump);
pub const MM_CONFIG_PDA_ADMIN_OFFSET: usize = offset_of!(MmAccountConfigZc, admin);
pub const MM_CONFIG_PDA_RFQ_SIGNER_OFFSET: usize = offset_of!(MmAccountConfigZc, rfq_signer);
