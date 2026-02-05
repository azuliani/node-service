# @azuliani/node-service Specification

A WebSocket-based messaging library for Node.js with Service/Client abstractions.

## 1. Overview

### Package Exports
```typescript
// Core classes
export { Service, Client }

// Spec/Plugin helpers
export { defineServiceSpec, createService, createClient }
export { healthPlugin, metricsPlugin, auditLogPlugin }

// Error code helpers
export { ErrorCode, hasErrorCode, getErrorCode }

// Type definitions
export type { Descriptor, Endpoint, RPCEndpoint, PubSubEndpoint, SharedObjectEndpoint }
export type { ServiceOptions, ClientOptions, Handlers, Initials, TransportConfig }
export type { JSONSchema, Diff, SerializedError, HeartbeatMessage }

// Wire frames (single-connection mux protocol)
export type { SubFrame, UnsubFrame, RpcRequestFrame, RpcResponseFrame, EndpointMessageFrame, HeartbeatFrame, SharedObjectInitFrame, SharedObjectUpdateFrame }

// Plugin type definitions
export type { ServicePlugin, ServiceSpec, DefineServiceSpecInput, HealthInfo, MetricsSnapshot, AuditEvent }
```

### Architecture
- **Service** - Server-side: `new Service(descriptor, handlers, initials, options)`
- **Client** - Client-side: `new Client(descriptor, options)`

All patterns use a single WebSocket server on one port (single connection per client, muxed by frames):

| Pattern | Server | Client | Use Case |
|---------|--------|--------|----------|
| RPC | WS request/response | WS request/response | Request/response |
| PubSub | WS broadcast | WS receive | Pub/sub |
| SharedObject | WS broadcast | WS receive | State sync via diffs |

## 2. Technical Stack

### Requirements
- **Node.js 23.6+** (native type stripping, no flags needed)
- **TypeScript** (ESM-native)
- **uWebSockets.js** for server WebSocket
- **ws** package for client WebSocket
- **TypeBox 1.0** (`typebox`, not `@sinclair/typebox`) for validation
- **deep-diff** from `github:azuliani/deep-diff#v2`
- **fast-copy** for state snapshots

### TypeBox 1.0 API

The TypeBox 1.0 API differs from older versions. Always consult `node_modules/typebox/build/*.d.mts`:

```typescript
import { Compile } from 'typebox/compile'   // Schema compilation
import * as Format from 'typebox/format'    // Format.Set('name', fn)
import * as Value from 'typebox/value'      // Value utilities
import { Type } from 'typebox'              // Type builder
```

Error types use `instancePath` not `path`.

### Build Strategy
- **Development:** No build step. Run `.ts` files directly via Node's type stripping.
- **Type checking:** `tsc --noEmit`
- **Distribution:** `tsc` compiles to `dist/` for npm publish
- **Import extensions:** Use `.ts` in source; `tsconfig.json` has `rewriteRelativeImportExtensions: true`

### Commands
```bash
npm install           # Install dependencies
npm test              # Run test suite (node:test)
npm run test:coverage # Run tests with coverage report
npm run typecheck     # Type check (tsc --noEmit)
npm run lint          # ESLint
npm run build         # Compile to dist/
npm run docs          # Generate API documentation

node --test test/validation.test.ts  # Single test
```

### Benchmarks
```bash
npm run bench                  # Run all benchmark scenarios
npm run bench:diff             # Diff mode comparison
npm run bench:scale            # State size scaling
npm run bench:clients          # Client scaling
npm run bench:throughput       # Update frequency/throughput
npm run bench:init             # Init latency
npm run bench:nested           # Large nested subobjects (~40MB state)
```

## 3. Directory Structure

```
src/
├── index.ts              # Main exports
├── types.ts              # Descriptor, Endpoint, Options, Diff types
├── errors.ts             # Error classes
├── validation.ts         # TypeBox validation utilities
├── helpers.ts            # waitFor, delay, parseHostPort
├── Service.ts            # Service class
├── Client.ts             # Client class
├── mux/
│   ├── MuxServer.ts       # Server-side mux/router (single WS connection)
│   └── MuxClient.ts       # Client-side mux/router (single WS connection)
├── transports/
│   ├── ServerTransport.ts    # Generic server transport interface
│   ├── ClientTransport.ts    # Generic client transport interface
│   ├── UwsServerTransport.ts # uWebSockets.js transport implementation
│   ├── WsClientTransport.ts  # ws-based client transport implementation
│   └── WsServerTransport.ts  # ws-based server transport stub (TODO)
└── endpoints/
    ├── service/          # Server-side endpoints
    │   ├── PubSubEndpoint.ts
    │   └── SharedObjectEndpoint.ts
    └── client/           # Client-side endpoints
        ├── RPCClient.ts
        ├── PubSubClient.ts
        └── SharedObjectClient.ts
test/
├── helpers.ts            # Test utilities
└── *.test.ts
```

## 4. Descriptor Format

Both Service and Client use the same descriptor:

```typescript
interface Descriptor {
  transport: { client: string; server: string };
  endpoints: Endpoint[];
}

type Endpoint =
  | { name: string; type: "RPC"; requestSchema: JSONSchema; replySchema: JSONSchema }
  | { name: string; type: "PubSub"; messageSchema: JSONSchema }
  | { name: string; type: "SharedObject"; objectSchema: JSONSchema; autoNotify?: boolean };
```

SharedObject state is owned by the Service. The Service must provide an initial value for every
SharedObject endpoint via the `initials` map at construction time.

On the Client, `SharedObjectClient.data` is only available when `ready === true` (after the first `init`
message). Accessing `data` while non-ready throws; await `subscribe()` (or listen for the `init` event)
first, and handle `'disconnected'` by treating the SharedObject as unavailable until the next `init`.

When `autoNotify` is enabled (default), the Service batches changes automatically. Calling
`service.SO('MySharedObject').notify()` manually in this mode still works, but prints a warning.

**Transport URLs:**
- `client`: Base URL for client connections (e.g., `"localhost:3000"`)
- `server`: Bind address for server (e.g., `"0.0.0.0:3000"`)

**WebSocket URL:**
- Single connection for all endpoints: `ws://{url}/`

**Routing:**
- Client subscribes/unsubscribes to endpoints by sending `{ type: "sub" | "unsub", endpoint: string }`
- RPC uses `{ type: "rpc:req" | "rpc:res", id: number, endpoint: string, ... }`
- Other endpoint frames include `endpoint: string` for demuxing on the client

**Schema format:** Plain JSON Schema. Use `additionalProperties` for dynamic keys. Use `format: "date"` or `format: "date-time"` for dates (auto-converted ISO ↔ Date).

## 5. Service API

### Constructor
```typescript
new Service(descriptor: Descriptor, handlers: Handlers, initials: Initials, options?: ServiceOptions)
```

- `handlers` - Map of endpoint names to handler functions (required for RPC)
- `initials` - Map of endpoint names to initial state (required for SharedObject)
- `options.heartbeatMs` - Heartbeat interval, default 5000ms

### Endpoint Access
```typescript
service.PS('MyPubSub').send(message);
service.SO('MySharedObject').data.field = value;
service.SO('MySharedObject').notify();
```

### Lifecycle
```typescript
await service.ready()   // Wait for server to start
await service.close()   // Stop heartbeat, close server
```

Throws `MissingHandlerError` if RPC endpoint has no handler.

## 6. Client API

### Constructor
```typescript
new Client(descriptor: Descriptor, options?: ClientOptions)
```

- `options.initTimeout` - Timeout waiting for init message, default 3000ms

### Endpoint Access
```typescript
client.RPC('MyRPC').call(input, timeout);
client.PS('MyPubSub').subscribe();
await client.SO('MySharedObject').subscribe();
client.SO('MySharedObject').data;
```

### Lifecycle
```typescript
client.close()  // Close all connections
```

### Descriptor Validation
On first connection, client validates descriptor hash against server's `_descriptor` RPC endpoint. On mismatch, a `DescriptorMismatchError` is raised (see `DIFFERENCES.md` for current surfacing behavior).

## 7. RPC Pattern

Request/response over the muxed WebSocket connection.

### Handler Signature
```typescript
async (input: T) => Promise<R>
```

### Behavior
- Server validates request against `requestSchema`, invokes handler, validates response against `replySchema`
- Client validates input, sends `rpc:req`, validates response, parses dates
- Default timeout: 10000ms
- Returns `TimeoutError` on timeout

### Wire Format
```typescript
{ type: "rpc:req", id: number, endpoint: string, input: T }
```

Response:
```typescript
{ type: "rpc:res", id: number, endpoint: string, err: SerializedError | null, res: R | undefined }
```

## 8. PubSub Pattern (Pub/Sub)

One-to-many broadcast via WebSocket.

### Service
```typescript
send(message: T): void  // Validates and broadcasts to all clients
```

### Client
```typescript
subscribe(): void
unsubscribe(): void
```

Events: `'message'`, `'connected'`, `'disconnected'`

### Wire Format
```typescript
{ endpoint: string, message: T }
```

## 9. SharedObject Pattern (State Sync)

Synchronized state via diffs over WebSocket.

### Service
```typescript
data: T                                    // Mutable state (source of truth)
rawData: T                                 // Direct access without proxy overhead
notify(hint?: string[]): void
```

- `hint` - Property path to optimize diff (e.g., `['players', 'player1']`)

Validates `data`, computes diffs, increments version, broadcasts.

### Auto-Notify Option

By default, mutations to `data` are automatically detected and batched via `setImmediate()`. Set `autoNotify: false` in the endpoint descriptor to disable this and require manual `notify()` calls:

```typescript
{
  name: "GameState",
  type: "SharedObject",
  objectSchema: GameStateSchema,
  autoNotify: false  // Disable automatic notifications
}
```

With `autoNotify: false`:
- Mutations to `data` are not automatically detected
- You must call `notify()` explicitly after making changes
- Useful when you want full control over notification timing
- Can batch multiple logical operations into a single notification

### Client
```typescript
data: T           // Read-only proxy (throws on write)
connected: boolean
subscribed: boolean
ready: boolean

subscribe(): void
unsubscribe(): void
```

Events: `'init'`, `'update'`, `'connected'`, `'disconnected'`, `'timing'`

### Initialization Protocol

Init is implicit in WebSocket connection:
1. Client calls `subscribe()`, opens WebSocket
2. Server sends init BEFORE adding to broadcast set (JS single-threaded safety)
3. Client receives init, sets `ready = true`, emits `'init'`
4. Subsequent updates arrive normally

If no init within `initTimeout`, client closes and auto-reconnects.

### Version Gaps

Client expects sequential versions (v+1). On gap:
1. Log error with expected/received versions
2. Set `ready = false`
3. Close WebSocket (triggers auto-reconnect)

### Disconnect Handling

On disconnect:
1. Mark the SharedObject non-ready (`ready = false`), making `data` inaccessible
2. Emit `'disconnected'`
3. Flush local state
4. Auto-reconnect if was subscribed

No synthetic diffs are emitted on disconnect. Clients must react to `'disconnected'` and clear any derived/UI state as needed.

### Wire Format
```typescript
// Init
{ type: 'init', data: T, v: number }

// Update
{ type: 'update', diffs: Diff[], v: number, now: string }
```

### Diff Format
```typescript
type Diff =
  | { kind: 'N'; path: (string | number)[]; rhs: any; $dates?: PropertyPath[] }
  | { kind: 'D'; path: (string | number)[]; lhs: any; $dates?: PropertyPath[] }
  | { kind: 'E'; path: (string | number)[]; lhs: any; rhs: any; $dates?: PropertyPath[] }
  | { kind: 'A'; path: (string | number)[]; index: number; item: Diff; $dates?: PropertyPath[] }
```

The optional `$dates` property contains paths to Date values within `rhs`/`lhs` that were serialized as ISO strings. When present, `applyChange()` automatically restores these to Date objects.

## 10. Heartbeat System

### Server
Broadcasts to all WebSocket clients:
```typescript
{ type: 'heartbeat', frequencyMs: number }
```

### Client
- Lazy activation: starts checking after first heartbeat
- Any message resets timeout timer
- Timeout threshold: 3× heartbeat frequency
- On timeout: emit disconnected, flush state, auto-reconnect

## 11. Validation

### Exported Functions
```typescript
interface CompiledValidator<T> {
  check: (value: unknown) => value is T;
  validate: (value: unknown) => T;
  validateAndParseDates: (value: unknown) => T;
  datePaths: string[][];
  hasDates: boolean;
}

function compileSchema<T>(schema: JSONSchema): CompiledValidator<T>
function validate<T>(schema: JSONSchema, value: unknown): T
function validateAndParseDates<T>(schema: JSONSchema, value: unknown): T
function isValid(schema: JSONSchema, value: unknown): boolean
function serializeDates(value: any): any
```

### Date Path Detection

Recursively traverse schema to find date formats:
- `format: "date"` or `format: "date-time"` → record path
- `properties` → recurse with property name
- `additionalProperties` → recurse with `*` marker
- `items` → recurse with `#` marker
- `allOf/anyOf/oneOf` → recurse into each

### Validation Timing
- **RPC:** Request validated on server (dates parsed), response validated both sides
- **PubSub:** Validated server (no dates), validated client (dates parsed)
- **SharedObject:** Full object validated server, diffs parsed client-side

Validation failures throw `ValidationError` synchronously.

## 12. Error Types

```typescript
abstract class BaseError extends Error {
  abstract readonly code: string;
  toJSON(): { message: string; name: string; code: string; stack?: string }
}

class ValidationError extends BaseError { code = "VALIDATION_FAILED" }
class TimeoutError extends BaseError { code = "TIMEOUT" }
class ConnectionError extends BaseError { code = "CONNECTION_FAILED" }
class VersionMismatchError extends BaseError { code = "VERSION_MISMATCH" }
class DescriptorMismatchError extends BaseError { code = "DESCRIPTOR_MISMATCH" }
class MissingHandlerError extends BaseError { code = "MISSING_HANDLER" }
class UnknownEndpointError extends BaseError { code = "UNKNOWN_ENDPOINT" }
```

RPC serializes errors as `{ message, name, code, stack }`. The client receives errors with a `serverStack` property containing the original server stack trace for debugging.

### Error Code Reference

| Code | Error Class | Description | Recovery |
|------|-------------|-------------|----------|
| `VALIDATION_FAILED` | `ValidationError` | Data doesn't match schema | Fix input data to match schema |
| `TIMEOUT` | `TimeoutError` | RPC or init didn't complete in time | Retry with longer timeout or check connectivity |
| `CONNECTION_FAILED` | `ConnectionError` | Could not establish connection | Check server is running and network is available |
| `VERSION_MISMATCH` | `VersionMismatchError` | Client state diverged from server | Auto-reconnects; if persistent, check for network issues |
| `DESCRIPTOR_MISMATCH` | `DescriptorMismatchError` | Client/server schema hash differs | Update client or server to use matching descriptors |
| `MISSING_HANDLER` | `MissingHandlerError` | RPC endpoint has no handler defined | Add handler for the endpoint in Service constructor |
| `UNKNOWN_ENDPOINT` | `UnknownEndpointError` | RPC called for non-existent endpoint | Check endpoint name matches descriptor |

Use the exported `ErrorCode` constant for type-safe error code checking:
```typescript
import { ErrorCode, hasErrorCode } from '@azuliani/node-service';

try {
  await client.RPC('MyRPC').call(input);
} catch (err) {
  if (hasErrorCode(err) && err.code === ErrorCode.VALIDATION_FAILED) {
    // Handle validation error
  }
}
```

## 13. Transport Implementation

### ServerTransport + UwsServerTransport

The server transport exposes a single WebSocket endpoint at `/` and provides raw text frames to the mux layer.

**Key aspects:**
- ArrayBuffer messages must be copied immediately: `Buffer.from(message).toString()`
- Listen socket closed with `uWS.us_listen_socket_close()`

### MuxServer

`MuxServer` is responsible for:
- Crash-fast JSON parsing for inbound frames (malformed JSON is treated as a protocol bug)
- Subscription routing (`sub` / `unsub`) for PubSub / SharedObject
- RPC request/response correlation (`rpc:req` / `rpc:res`)
- SharedObject init-before-update ordering (init is sent before adding a connection to the broadcast set)

### ClientTransport + WsClientTransport

Client transport uses `ws` and supports auto-reconnect. It passes raw text frames to the mux layer.

### MuxClient

`MuxClient`:
- Maintains one WebSocket connection for all endpoints
- Replays subscriptions on reconnect
- Implements RPC correlation and timeouts
- Exposes a `flush()` barrier via the internal `_descriptor` RPC endpoint (used to ensure subscribe frames have been processed without adding explicit sub-acks)

### WsServerTransport (stub)

`WsServerTransport` exists as a placeholder for a future `ws`-based server implementation for performance comparisons.

## 14. Utilities

```typescript
function waitFor(emitter: EventEmitter, event: string, timeout?: number): Promise<any>
function delay(ms: number): Promise<void>
function parseHostPort(url: string): { host: string; port: number }
```

## 15. Test Requirements

1. **Unique ports** - Each test uses unique port (increment 100+)
2. **Teardown order** - `client.unsubscribe()` → `delay(50)` → `client.close()` → `server.close()` → `delay(50)`
3. **Port flakiness** - TCP TIME_WAIT can cause "Address already in use". Use time-slot-based allocation in test/helpers.ts.

## 16. Package Configuration

```json
{
  "type": "module",
  "engines": { "node": ">=23.6.0" },
  "exports": { ".": "./dist/index.js" },
  "types": "./dist/index.d.ts",
  "sideEffects": false
}
```

Dependencies:
- `uWebSockets.js`: `github:uNetworking/uWebSockets.js#v20.57.0`
- `ws`: `^8.x`
- `typebox`: `^1.x`
- `deep-diff`: `github:azuliani/deep-diff#v2`
- `fast-copy`: `^3.x`
- `debug`: `^4.x`

## 17. Troubleshooting

### Connection Issues

**Client disconnects immediately after connecting**
- Check descriptor hash mismatch (server/client schema out of sync)
- Verify heartbeat frequency is reasonable (default 5000ms)
- Check server logs for validation errors on init message

**SharedObject not receiving updates**
- Ensure `subscribe()` was called before accessing `data`
- Check for validation errors in server logs (notify with invalid data)
- Verify client is in `ready` state before expecting updates

**Client won't reconnect**
- Check that `close()` wasn't called (disables auto-reconnect)
- Verify server is listening on expected port
- Reconnection uses exponential backoff (1s, 2s, 4s... up to 30s)

### Performance Issues

**High latency on SharedObject updates**
- Use `hint` parameter to scope diff computation to changed subtree
- Batch synchronous mutations (they auto-batch within same tick via setImmediate)

**Memory growth over time**
- Unsubscribe from endpoints when no longer needed
- Check for event listener leaks (use `off()` for removed listeners)
- Large SharedObject state is kept in memory on both server and client

**High CPU during updates**
- Avoid full-object diff on large state (use `hint` parameter)
- Validation runs on every notify - ensure schemas aren't overly complex

### Debugging

**Enable debug logging**
```bash
DEBUG=node-service:* node app.js
```

Specific debug namespaces:
- `node-service:service` - Service lifecycle
- `node-service:ws-server` - WebSocket server events
- `node-service:ws-client` - WebSocket client events
- `node-service:sharedobject-endpoint` - SharedObject diffs and broadcasts

**Common error codes**
- `VALIDATION_FAILED` - Data doesn't match schema
- `TIMEOUT` - RPC or init didn't complete in time
- `VERSION_MISMATCH` - Client state diverged, will auto-reconnect
- `DESCRIPTOR_MISMATCH` - Client/server schema hash differs
- `MISSING_HANDLER` - RPC endpoint has no handler defined
- `UNKNOWN_ENDPOINT` - RPC called for non-existent endpoint
- `CONNECTION_FAILED` - Could not establish connection

**RPC errors include endpoint context**

When an RPC handler throws, the error response includes the endpoint name for easier debugging:
```typescript
{
  err: {
    message: "Something went wrong",
    name: "Error",
    code: "CUSTOM_ERROR",
    endpoint: "MyRPCEndpoint"  // Added for debugging context
  },
  res: undefined
}
```

### Version Gap Recovery

When a client detects a version gap (receives v+2 when expecting v+1):
1. Client logs error with expected/received versions
2. Sets `ready = false`
3. Closes WebSocket connection
4. Auto-reconnects and receives fresh init with current state

This ensures eventual consistency - the client will recover automatically.
