use core::ptr::read_unaligned;

use pinocchio::Address;

#[inline(always)]
pub unsafe fn read_u8_unchecked(ptr: *const u8, offset: usize) -> u8 {
   // SAFETY: caller guarantees `offset` is in-bounds.
   unsafe { *ptr.add(offset) }
}

#[inline(always)]
pub unsafe fn read_u16_le_unchecked(ptr: *const u8, offset: usize) -> u16 {
   // SAFETY: caller guarantees `offset..offset+size_of::<u16>()` is in-bounds.
   unsafe { read_unaligned(ptr.add(offset) as *const u16) }
}

#[inline(always)]
pub unsafe fn read_u32_le_unchecked(ptr: *const u8, offset: usize) -> u32 {
   // SAFETY: caller guarantees `offset..offset+size_of::<u32>()` is in-bounds.
   unsafe { read_unaligned(ptr.add(offset) as *const u32) }
}

#[inline(always)]
pub unsafe fn read_u64_le_unchecked(ptr: *const u8, offset: usize) -> u64 {
   // SAFETY: caller guarantees `offset..offset+size_of::<u64>()` is in-bounds.
   unsafe { read_unaligned(ptr.add(offset) as *const u64) }
}

#[inline(always)]
pub unsafe fn read_i64_le_unchecked(ptr: *const u8, offset: usize) -> i64 {
   // SAFETY: caller guarantees `offset..offset+size_of::<i64>()` is in-bounds.
   unsafe { read_unaligned(ptr.add(offset) as *const i64) }
}

#[inline(always)]
pub unsafe fn read_address_unchecked(ptr: *const u8, offset: usize) -> Address {
   // SAFETY: caller guarantees `offset..offset+ADDRESS_LEN` is in-bounds.
   unsafe { *read_address_ref_unchecked(ptr, offset) }
}

/// Compare in place without copying an address off the account.
#[inline(always)]
pub unsafe fn read_address_ref_unchecked<'a>(ptr: *const u8, offset: usize) -> &'a Address {
   // SAFETY: caller guarantees `offset..offset+ADDRESS_LEN` is in-bounds and lives for `'a`.
   unsafe { &*ptr.add(offset).cast::<Address>() }
}

#[inline(always)]
pub unsafe fn read_u64_pair_unchecked(ptr: *const u8, offset: usize) -> (u64, u64) {
   // SAFETY: caller guarantees `offset..offset+16` is in-bounds.
   unsafe { read_unaligned(ptr.add(offset) as *const (u64, u64)) }
}