const ADMIN_HEADER: usize = 0x0008;
const ADMIN_KEY: usize = 0x0010;

pub const ADMIN: [u8; 32] = [
   0x2c, 0x57, 0x95, 0xd9, 0x6d, 0x0d, 0xcc, 0x88, 0x0d, 0x8f, 0xb4, 0x30, 0xd6, 0x5e, 0x4d, 0x3d, 
   0xd7, 0xbf, 0xed, 0x15, 0x4c, 0x09, 0x0e, 0x96, 0x58, 0x7e, 0x50, 0xd7, 0x57, 0x7a, 0x0a, 0x80,
];

// Account flags
pub const NO_DUP_SIGNER: u16 = 0x01 << 8 | 0xff; // SIGNER | NO_DUP

pub struct Admin;

impl Admin {
   #[inline(always)]
   /// # Check
   /// Performs the following checks on the Admin account:
   /// - Checks Admin is a non-duplicate signer (2 CUs)
   /// - Checks Admin address matches ADMIN (12 CUs)
   ///
   /// # Safety
   /// - The caller must ensure that `ptr` is a valid pointer to a memory region
   ///   that can be safely read from.
   /// - The memory region must be properly aligned and large enough to hold the
   ///   data being read.
   pub unsafe fn check(ptr: *mut u8) {
      if crate::read::<u16>(ptr, ADMIN_HEADER) != NO_DUP_SIGNER
         || crate::read::<u64>(ptr, ADMIN_KEY) != *ADMIN.as_ptr().cast::<u64>()
         || crate::read::<u64>(ptr, ADMIN_KEY + 0x08) != *ADMIN.as_ptr().add(8).cast::<u64>()
         || crate::read::<u64>(ptr, ADMIN_KEY + 0x10) != *ADMIN.as_ptr().add(16).cast::<u64>()
         || crate::read::<u64>(ptr, ADMIN_KEY + 0x18) != *ADMIN.as_ptr().add(24).cast::<u64>()
      {
         #[cfg(target_os = "solana")]
         unsafe {
            core::arch::asm!("lddw r0, 1\nexit");
         }
      }
   }
}
