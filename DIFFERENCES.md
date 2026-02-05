# Differences from Current Implementation

This document tracks intentional differences between `SPEC.md` and the current implementation.

## Descriptor Mismatch Surfacing

- **Spec:** A descriptor hash mismatch causes `DescriptorMismatchError` to be thrown.
- **Current:** The client performs descriptor validation in the background on heartbeat; mismatches are logged (and validation is retried), but the error is not surfaced via a synchronous API.

If you want a hard-fail behavior (e.g., close the connection and surface the error), we should add an explicit client readiness/validation surface (for example `await client.ready()`).

