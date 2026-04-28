//! Custom program errors (`ProgramError::Custom`).

use pinocchio::error::ProgramError;

#[repr(u32)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Error {
   GenError = 0,
}

impl From<Error> for ProgramError {
   #[inline]
   fn from(e: Error) -> Self {
      ProgramError::Custom(e as u32)
   }
}
