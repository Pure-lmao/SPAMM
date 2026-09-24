use anchor_lang::prelude::Pubkey;
use pinocchio::Address;

#[inline(always)]
pub fn to_pinocchio(pk: &Pubkey) -> Address {
   Address::new_from_array(pk.to_bytes())
}

#[inline(always)]
pub fn pk_eq_addr(pk: &Pubkey, addr: &Address) -> bool {
   pk.as_ref() == addr.as_ref()
}
