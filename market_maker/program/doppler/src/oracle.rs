// Account 1 data starts at 0x28c0
const ACCOUNT_1_DATA_START: usize = 0x28c0;

// MODIFIED FROM ORIGINAL TO ADD BUMP TO LAYOUT.
// Code *should* be updated to use the new layout but not tested.

// Account layout: discriminator (1) + bump (1) + sequence (4) + OracleData (N)
// Sequence offset: 0x28c0 + 0x02 = 0x28c1
const ORACLE_SEQUENCE: usize = ACCOUNT_1_DATA_START + 0x02;

pub struct Oracle;

impl Oracle {
   /// # Safety
   ///
   /// The caller must ensure that `ptr` is a valid pointer to a memory region
   /// that is properly aligned and large enough to hold the data being read or written.
   /// Additionally, the memory region must not be accessed concurrently by other threads.
   #[inline(always)]
   pub unsafe fn check_and_update(oracle_data_size: usize, instruction_sequence_offset: usize, ptr: *mut u8) {
      // Instruction: discriminator (1) + sequence (4) + oracle_data (N, no Vec length prefix)
      // Account: sequence (4) + OracleData (N)
      // Single write: copy sequence + oracle_data directly (consecutive in both)
      
      let current_sequence = crate::read::<u32>(ptr, ORACLE_SEQUENCE);
      let new_sequence = crate::read::<u32>(ptr, instruction_sequence_offset);

      if new_sequence <= current_sequence {
         #[cfg(target_os = "solana")]
         unsafe {
            core::arch::asm!("lddw r0, 2\nexit");
         }
      }

      let sequence_and_data_src = crate::read_bytes(ptr, instruction_sequence_offset);
      crate::write_bytes(ptr, ORACLE_SEQUENCE, sequence_and_data_src, 4 + oracle_data_size);
   }
}