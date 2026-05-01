This directory is a modified version of the `doppler` crate from:

- Repository: https://github.com/blueshift-gg/doppler
- Path in upstream: `doppler/` (library crate)

The modifications are:
- Account layout: `discriminator` + `bump` + `u32` sequence + oracle payload (aligned `u32` sequence).
- Doppler `update_oracle` ix: `discriminator` + `u32` sequence + payload.
