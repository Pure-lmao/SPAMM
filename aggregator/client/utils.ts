import { type Address, getAddressEncoder, type ReadonlyUint8Array } from '@solana/kit';
import { getConfigPda } from 'spamm-aggregator-sdk';

const addressEncoder = getAddressEncoder();

function convertAddressToArray(address: Address): ReadonlyUint8Array {
   return addressEncoder.encode(address);
}

/** Bytes for `Address::new_from_array([` … `]);` — paste between `[` and `]`. */
function formatAddressAsRustNewFromArrayBody(address: Address): string {
   const bytes = convertAddressToArray(address);
   return `${Array.from(bytes, b => `0x${b.toString(16).padStart(2, '0')}`).join(', ')},`;
}

// const pda = await getConfigPda();
// console.log(pda);
// console.log(formatAddressAsRustNewFromArrayBody(pda[0]));