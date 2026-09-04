use core::ptr::write_unaligned;

use crate::state::{NettingLine, NettingLineZc};

#[inline(always)]
pub unsafe fn write_u8_unchecked(ptr: *mut u8, offset: usize, value: u8) {
   // SAFETY: caller guarantees `offset..offset+1` is in-bounds.
   unsafe { write_unaligned(ptr.add(offset), value) };
}

#[inline(always)]
pub unsafe fn write_u16_le_unchecked(ptr: *mut u8, offset: usize, value: u16) {
   // SAFETY: caller guarantees `offset..offset+2` is in-bounds.
   unsafe { write_unaligned(ptr.add(offset) as *mut u16, value.to_le()) };
}

#[inline(always)]
pub unsafe fn write_u32_le_unchecked(ptr: *mut u8, offset: usize, value: u32) {
   // SAFETY: caller guarantees `offset..offset+4` is in-bounds.
   unsafe { write_unaligned(ptr.add(offset) as *mut u32, value.to_le()) };
}

#[inline(always)]
pub unsafe fn write_u64_le_unchecked(ptr: *mut u8, offset: usize, value: u64) {
   // SAFETY: caller guarantees `offset..offset+8` is in-bounds.
   unsafe { write_unaligned(ptr.add(offset) as *mut u64, value.to_le()) };
}

#[inline(always)]
pub unsafe fn write_i64_le_unchecked(ptr: *mut u8, offset: usize, value: i64) {
   // SAFETY: caller guarantees `offset..offset+8` is in-bounds.
   unsafe { write_unaligned(ptr.add(offset) as *mut i64, value.to_le()) };
}

#[inline(always)]
pub unsafe fn write_netting_line_unchecked(
   ptr: *mut u8, offset: usize, value: NettingLine
) {
   let zc = NettingLineZc {
      period: value.period,
      mkt: value.mkt.into(),
      open_0: value.open_0.into(),
      open_1: value.open_1.into(),
   };
   // SAFETY: caller guarantees `offset..offset+NETTING_LINE_LEN` is in-bounds (`NettingLineZc` wire size).
   unsafe { write_unaligned(ptr.add(offset) as *mut NettingLineZc, zc) };
}

#[inline(always)]
pub unsafe fn write_u64_pair_unchecked(ptr: *mut u8, offset: usize, value: (u64, u64)) {
   // SAFETY: caller guarantees `offset..offset+16` is in-bounds.
   unsafe { write_unaligned(ptr.add(offset) as *mut (u64, u64), value) };
}

#[inline(always)]
pub unsafe fn write_arbitrary_bytes_unchecked(ptr: *mut u8, offset: usize, value: &[u8]) {
   // SAFETY: caller guarantees `offset..offset+value.len()` is writable on `ptr`
   unsafe { core::ptr::copy_nonoverlapping(value.as_ptr(), ptr.add(offset), value.len()) };
}