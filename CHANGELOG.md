# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Single-connection mux protocol (all endpoint traffic over one WebSocket at `/`)
- Transport abstraction (`ServerTransport` / `ClientTransport`) with `UwsServerTransport` implementation and `WsServerTransport` stub
- Client/server transport injection via `ServiceOptions.serverTransport` and `ClientOptions.clientTransport`
- Wire frame type exports (`SubFrame`, `RpcRequestFrame`, `SharedObjectInitFrame`, etc.)
- Exported error-code helpers: `ErrorCode`, `hasErrorCode`, `getErrorCode`
- `autoNotify` option for SharedObject endpoints to disable automatic change detection and require manual `notify()` calls
- Initial project scaffolding
- Core type definitions (Descriptor, Endpoint, Options)
- Error classes (ValidationError, TimeoutError, ConnectionError, VersionMismatchError, DescriptorMismatchError)
- Validation utilities with TypeBox integration and date handling
- Test helpers (waitFor, delay, createDescriptor)

### Changed
- RPC now runs over the shared WebSocket connection (no HTTP transport)
- PubSub/PushPull/SharedObject now share a single connection and use `sub`/`unsub` frames for routing
- Endpoint access now uses explicit getters (`client.RPC('Name')`, `client.PS('Name')`, `client.PP('Name')`, `client.SO('Name')`); removed dynamic `client.Name` / `service.Name` properties
- Metrics/audit plugins updated to reflect removed Sink endpoint type
- Renamed Source endpoint type to PubSub (pub/sub broadcast pattern)
- `SharedObjectClient.subscribe()` now returns a Promise that resolves on `init`
- `SharedObjectClient.data` now throws when accessed while not ready
- Service now requires explicit `initials[endpointName]` for every SharedObject endpoint
- `SharedObjectEndpoint.notify()` now warns (once) when `autoNotify` is enabled

### Removed
- Sink endpoint type (`type: "Sink"`) and corresponding client/server implementations
- `SharedObjectEndpoint.initial` descriptor field
