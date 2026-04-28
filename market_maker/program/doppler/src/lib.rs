#![cfg_attr(target_os = "solana", feature(asm_experimental_arch))]
#![cfg_attr(not(feature = "std"), no_std)]

mod admin;
mod oracle;
pub mod panic_handler;

/// Helper to read a value at offset and cast it.
///
/// # Safety
/// - The caller must ensure that `ptr.add(offset)` is a valid pointer and properly aligned for type `T`.
/// - The memory at the computed address must be initialized and valid for reads of type `T`.
#[inline(always)]
pub const unsafe fn read<T: Copy>(ptr: *const u8, offset: usize) -> T {
   *ptr.add(offset).cast::<T>()
}

/// Pointer to bytes at `offset` in the VM input buffer.
///
/// # Safety
/// Caller must ensure `ptr.add(offset)` is valid.
#[inline(always)]
pub unsafe fn read_bytes(ptr: *const u8, offset: usize) -> *const u8 {
   ptr.add(offset)
}

/// Copy `len` bytes from `src` (in the input buffer) to `ptr.add(offset)`.
///
/// # Safety
/// Regions must not overlap and must be in-bounds for the transaction buffer.
#[inline(always)]
pub unsafe fn write_bytes(ptr: *mut u8, offset: usize, src: *const u8, len: usize) {
   core::ptr::copy_nonoverlapping(src, ptr.add(offset), len);
}

pub mod prelude {
   pub use crate::admin::{Admin, ADMIN};
   pub use crate::oracle::Oracle;
   #[cfg(not(feature = "std"))]
   pub use crate::panic_handler::*;
}
