use pinocchio::Address;
use spamm_aggregator::state::{MM_ACCOUNT_CONFIG_DISCRIMINATOR, MM_CONFIG_PDA_HEADER_LEN};
use zeropod::{ZeroPod, ZeroPodFixed};

/// Promo MM config: aggregator `MmAccountConfig` header then a local `status` flag.
#[derive(Copy, Clone, ZeroPod)]
#[repr(C)]
pub struct Config {
   pub discriminator: u8,
   pub bump: u8,
   pub admin: Address,
   pub rfq_signer: Address,
   pub status: bool,
}

pub const CONFIG_DISCRIMINATOR: u8 = MM_ACCOUNT_CONFIG_DISCRIMINATOR;
pub const CONFIG_SIZE: usize = <Config as ZeroPodFixed>::SIZE;
pub const CONFIG_ADMIN_OFFSET: usize = 2;
pub const STATUS_OFFSET: usize = MM_CONFIG_PDA_HEADER_LEN;

const _: () = assert!(CONFIG_SIZE == MM_CONFIG_PDA_HEADER_LEN + 1);
const _: () = assert!(STATUS_OFFSET == 66);

impl Config {
   pub fn from_account_data(data: &[u8]) -> Result<Self, ()> {
      if data.len() < CONFIG_SIZE {
         return Err(());
      }
      <Self as ZeroPodFixed>::from_bytes(&data[..CONFIG_SIZE])
         .map(|zc| Self::from_zc(*zc))
         .map_err(|_| ())
   }

   pub fn to_zc(self) -> ConfigZc {
      ConfigZc {
         discriminator: self.discriminator,
         bump: self.bump,
         admin: self.admin,
         rfq_signer: self.rfq_signer,
         status: self.status.into(),
      }
   }

   pub fn from_zc(zc: ConfigZc) -> Self {
      Self {
         discriminator: zc.discriminator,
         bump: zc.bump,
         admin: zc.admin,
         rfq_signer: zc.rfq_signer,
         status: zc.status.get(),
      }
   }

   pub unsafe fn write_zc_to_ptr(self, dst: *mut u8) {
      core::ptr::write(dst.cast(), self.to_zc());
   }
}
