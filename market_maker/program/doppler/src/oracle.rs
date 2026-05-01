//! Oracle account / ix payload layout inside the BPF loader input buffer.
//!
//! **Account data** (oracle account): `[discriminator u8][bump u8][sequence u64][payload T]`
//! starting at `ACCOUNT_DATA_BASE` (`0x28c0`), matching the SPAMM oracle account layout.
//!
//! **Instruction data**: `[discriminator u8][sequence u64][payload T]` starting at `IX_DATA_BASE`
//! (`0x50e8`), i.e. one ix byte before the original doppler “sequence at `0x50e0`” layout.

/// Start of this oracle account’s data in the serialized buffer (`RuntimeAccount` payload).
const ACCOUNT_DATA_BASE: usize = 0x28c0;

/// After account `discriminator` + `bump`: `sequence: u64`.
const ORACLE_SEQUENCE: usize = ACCOUNT_DATA_BASE + 2;

/// Immediately after `sequence: u64`: `payload: T`.
const ORACLE_PAYLOAD: usize = ORACLE_SEQUENCE + 8;

/// First byte of this instruction’s data (discriminator).
const IX_DATA_BASE: usize = 0x50e8;

pub struct Oracle<T: Sized + Copy>(core::marker::PhantomData<T>);

impl<T: Sized + Copy> Oracle<T> {
   /// After ix discriminator: `sequence: u64`.
   const IX_SEQUENCE: usize = IX_DATA_BASE + 1;

   /// After `sequence: u64`: `payload: T` (does **not** depend on `size_of::<T>()` for the offset).
   const IX_PAYLOAD: usize = IX_DATA_BASE + 1 + 8;

   /// # Safety
   ///
   /// `ptr` must point at the VM input buffer from the BPF loader, with valid regions for all reads/writes.
   #[inline(always)]
   pub unsafe fn check_and_update(ptr: *mut u8) {
      let current_sequence = crate::read::<u32>(ptr, ORACLE_SEQUENCE);
      let new_sequence = crate::read::<u32>(ptr, Self::IX_SEQUENCE);

      if new_sequence <= current_sequence {
         #[cfg(target_os = "solana")]
         unsafe {
            core::arch::asm!("lddw r0, 2\nexit");
         }
      }

      let new_payload = crate::read::<T>(ptr, Self::IX_PAYLOAD);
      crate::write(ptr, ORACLE_SEQUENCE, new_sequence);
      crate::write(ptr, ORACLE_PAYLOAD, new_payload);
   }
}
