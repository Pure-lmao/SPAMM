use core::ptr::read_unaligned;

use pinocchio::Address;

#[inline(always)]
pub unsafe fn read_u8_unchecked(ptr: *const u8, offset: usize) -> u8 {
   // SAFETY: caller guarantees `offset` is in-bounds.
   unsafe { *ptr.add(offset) }
}

#[inline(always)]
pub unsafe fn read_u16_le_unchecked(ptr: *const u8, offset: usize) -> u16 {
   // SAFETY: caller guarantees `offset..offset+2` is in-bounds.
   unsafe { read_unaligned(ptr.add(offset) as *const u16) }
}

#[inline(always)]
pub unsafe fn read_u32_le_unchecked(ptr: *const u8, offset: usize) -> u32 {
   // SAFETY: caller guarantees `offset..offset+4` is in-bounds.
   unsafe { read_unaligned(ptr.add(offset) as *const u32) }
}

#[inline(always)]
pub unsafe fn read_i32_le_unchecked(ptr: *const u8, offset: usize) -> i32 {
   // SAFETY: caller guarantees `offset..offset+4` is in-bounds.
   unsafe { read_unaligned(ptr.add(offset) as *const i32) }
}

#[inline(always)]
pub unsafe fn read_u64_le_unchecked(ptr: *const u8, offset: usize) -> u64 {
   // SAFETY: caller guarantees `offset..offset+8` is in-bounds.
   unsafe { read_unaligned(ptr.add(offset) as *const u64) }
}

#[inline(always)]
pub unsafe fn read_i64_le_unchecked(ptr: *const u8, offset: usize) -> i64 {
   // SAFETY: caller guarantees `offset..offset+8` is in-bounds.
   unsafe { read_unaligned(ptr.add(offset) as *const i64) }
}

#[inline(always)]
pub unsafe fn read_array_32_unchecked(ptr: *const u8, offset: usize) -> [u8; 32] {
   // SAFETY: caller guarantees `offset..offset+32` is in-bounds.
   unsafe { read_unaligned(ptr.add(offset) as *const [u8; 32]) }
}

#[inline(always)]
pub unsafe fn read_address_unchecked(ptr: *const u8, offset: usize) -> Address {
   // SAFETY: caller guarantees `offset..offset+32` is in-bounds.
   unsafe { read_unaligned(ptr.add(offset) as *const Address) }
}

#[inline(always)]
pub unsafe fn read_i64_pair_unchecked(ptr: *const u8, offset: usize) -> (i64, i64) {
   // SAFETY: caller guarantees `offset..offset+16` is in-bounds.
   unsafe { read_unaligned(ptr.add(offset) as *const (i64, i64)) }
}