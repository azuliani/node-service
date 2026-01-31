# node-service Functional Specification

This document describes the functional requirements for a ZeroMQ-based messaging library that provides Service/Client abstractions for building distributed Node.js applications. It is intended to enable a feature-compatible TypeScript rewrite.

## 1. Overview

### Purpose
A Node.js library for building services with ZeroMQ-based messaging patterns. It provides both Service (server) and Client abstractions for different communication patterns.

### Package Exports
```typescript
export { Service, Client }
```

## 2. Modernization Goals

The TypeScript rewrite should incorporate these modernization improvements:

### Core Technology
- **TypeScript** (ESM-native with CommonJS bindings)
- **Plain JSON Schema** for user-facing schemas (not library-specific syntax)
- **TypeBox 1.0** used internally for validation (compiles JSON Schema)
- **async/await patterns** (no callback-based APIs)
- **Latest ZeroMQ module** (zeromq@6.x)

### SharedObjectClient Specifics
- Raw data stored in `_data` (private)
- Exposed via read-only proxy that throws on modification attempts
- Proxy must be compatible with fastcopy (deep cloning works)
- Special handling for Date objects in proxy

### Package Configuration
- `package.json` fields: `engines`, `files`, `exports`, `types`
- `sideEffects: false` for tree-shaking
- `debug` package for conditional verbose logging
- Structured error types/classes

### TypeScript Quality
- `tsconfig.json` with strict settings: `strict: true`, `noUncheckedIndexedAccess: true`
- Sourcemaps for debugging
- Generated API docs from TSDoc comments

### Tooling
- ESLint + Prettier for code style
- Husky + lint-staged for pre-commit hooks
- Dependabot/Renovate for dependency updates
- Performance benchmarking suite

### Documentation
- CHANGELOG.md (Keep a Changelog format)
- LICENSE file (MIT)

### CI/CD
- GitHub Actions: multi-Node testing, lint, typecheck, npm audit
- Automated npm publishing on release tags

## 3. Descriptor Format

Both Service and Client use a shared descriptor object that defines transports and endpoints.

### Structure
```typescript
interface Descriptor {
  transports: {
    source?: { client: string; server: string };
    sink?: { client: string; server: string };
    rpc?: { client: string; server: string };
    pushpull?: { client: string; server: string };
  };
  endpoints: Endpoint[];
}

type Endpoint =
  | { name: string; type: "RPC"; requestSchema: JSONSchema; replySchema: JSONSchema }
  | { name: string; type: "Source"; messageSchema: JSONSchema }
  | { name: string; type: "Sink"; messageSchema: JSONSchema }
  | { name: string; type: "PushPull"; messageSchema: JSONSchema }
  | { name: string; type: "SharedObject"; objectSchema: JSONSchema };
```

### Transport URLs
All transport URLs use the format `tcp://hostname:port`.

### User-Facing Schema Format
Users provide standard JSON Schema in descriptors. The library uses TypeBox internally for validation.

```typescript
{
  endpoints: [{
    name: "GameState",
    type: "SharedObject",
    objectSchema: {
      type: "object",
      properties: {
        score: { type: "number" },
        lastUpdate: { type: "string", format: "date" },
        players: {
          type: "object",
          additionalProperties: {
            type: "object",
            properties: {
              name: { type: "string" }
            }
          }
        }
      }
    }
  }]
}
```

### Dynamic Properties
Use standard JSON Schema `additionalProperties` for dynamic keys:
```json
{ "type": "object", "additionalProperties": { "type": "number" } }
```

Note: The current implementation uses `"*"` in `properties` for dynamic keys. The rewrite should use standard JSON Schema `additionalProperties`.

### Date Handling
Use `format: "date"` or `format: "date-time"` - library auto-converts ISO strings to Date objects on receive.

Note: The current implementation uses a custom `type: "date"`. The rewrite should use standard JSON Schema format.

## 4. Service API

### Constructor
```typescript
new Service(descriptor: Descriptor, handlers: Handlers, initials: Initials, options?: ServiceOptions)
```

**Parameters:**
- `descriptor` - Transport and endpoint configuration
- `handlers` - Map of endpoint names to handler functions (required for RPC endpoints)
- `initials` - Map of endpoint names to initial state (for SharedObject endpoints)
- `options` - Configuration options

**Options:**
```typescript
interface ServiceOptions {
  heartbeatMs?: number;  // Default: 5000
}
```

### Endpoint Access
Endpoints are exposed as properties on the Service instance by their name:
```typescript
service.MySource.send(message);
service.MySharedObject.data.field = value;
```

### Lifecycle
```typescript
service.close(): void  // Stops heartbeat, closes HTTP server and all sockets
```

### Missing Handler Error
If an RPC endpoint is defined without a corresponding handler, the constructor throws an error.

## 5. Client API

### Constructor
```typescript
new Client(descriptor: Descriptor, options?: ClientOptions)
```

**Options:**
```typescript
interface ClientOptions {
  initDelay?: number;    // Delay before SharedObject init RPC (default: 100ms)
  initTimeout?: number;  // Timeout for init RPC request (default: 3000ms)
}
```

### Endpoint Access
Endpoints are exposed as properties on the Client instance by their name:
```typescript
client.MyRPC.call(input, timeout);
client.MySource.subscribe();
client.MySharedObject.data;
```

### Lifecycle
```typescript
client.close(): void  // Stops heartbeat checking, closes all sockets
```

## 6. RPC Pattern

Request/response pattern using HTTP POST.

### Service Side

**Handler Signature (current - callback-based):**
```typescript
(input: T, callback: (err: any, res: R) => void) => void
```

**Handler Signature (rewrite - async):**
```typescript
async (input: T) => Promise<R>
```

**Behavior:**
- Validates request against `requestSchema`
- Invokes handler
- Validates response against `replySchema` (only if no error)
- Returns JSON: `{ err: any, res: R }`


### Client Side

**Method Signature (current - callback-based):**
```typescript
call(input: T, timeout?: number, callback: (err: any, res: R) => void): void
```

**Method Signature (rewrite - async):**
```typescript
async call(input: T, timeout?: number): Promise<R>
```

**Behavior:**
- Default timeout: 10000ms
- Validates input against `requestSchema`
- Sends HTTP POST to server
- On response, validates against `replySchema` and parses dates
- On timeout, returns error `'timeout'`

## 7. Source Pattern (Pub/Sub)

One-to-many publish/subscribe using ZMQ PUB/SUB sockets.

### Service Side

**Method:**
```typescript
send(message: T): void
```

**Behavior:**
- Validates message against `messageSchema`
- Publishes to ZMQ PUB socket with endpoint name as topic


### Client Side

**Methods:**
```typescript
subscribe(): void
unsubscribe(): void
```

**Events:**
- `'message'` - Emitted with validated, date-parsed message
- `'connected'` - Emitted when source transport connects
- `'disconnected'` - Emitted when source transport disconnects

**Behavior:**
- Subscribes to ZMQ SUB socket with endpoint name as topic
- Validates incoming messages against `messageSchema`
- Parses dates in messages

## 8. Sink Pattern (Many-to-One)

Many clients push messages to a single server using ZMQ PUSH/PULL.

### Service Side

**Extends:** EventEmitter

**Events:**
- `'message'` - Emitted with received message data


### Client Side

**Method:**
```typescript
push(message: T): void
```

**Behavior:**
- Validates message against `messageSchema`
- Sends to ZMQ PUSH socket

## 9. PushPull Pattern (Work Distribution)

Server pushes work to multiple workers using ZMQ PUSH/PULL.

### Service Side

**Method:**
```typescript
push(message: T): void
```

**Behavior:**
- Validates message against `messageSchema`
- Sends to ZMQ PUSH socket (round-robin to connected workers)

### Client Side

**Extends:** EventEmitter

**Methods:**
```typescript
subscribe(): void   // Connects to server
unsubscribe(): void // Disconnects from server
```

**Events:**
- `'message'` - Emitted with received message data

**Constraint:** Only one PushPull endpoint can be constructed per Client instance.

## 10. SharedObject Pattern (State Synchronization)

Maintains synchronized state between server and clients using diffs.

**Transport Requirements:** Requires both `source` and `rpc` transports to be configured.

### Service Side

**Properties:**
- `data` - Mutable state object (the source of truth)

**Method:**
```typescript
notify(hint?: string[], dirtyBypass?: boolean): void
```

**Parameters:**
- `hint` - Property path to optimize diff computation (e.g., `['players', 'player1']`)
- `dirtyBypass` - If true, skips deep-diff and sends the entire hinted subtree as a replacement

**Behavior:**
1. Validates current `data` against `objectSchema`
2. Computes diffs between last transmitted state and current state
3. If diffs exist:
   - Increments version counter
   - Broadcasts diffs on source transport
   - Updates internal snapshot

**RPC Handler:**
Responds to internal `_SO_{name}` endpoint with `input: "init"`:
```typescript
{ err: null, res: { data: T, v: number } }
```

### Client Side

**Extends:** EventEmitter

**Properties:**
- `data` - Current synchronized state (read-only in rewrite)
- `connected` - Boolean, true when source transport is connected
- `subscribed` - Boolean, true when actively subscribed
- `ready` - Boolean, true when initial state has been loaded

**Methods:**
```typescript
subscribe(): void
unsubscribe(): void
```

**Events:**
- `'init'` - Emitted after initial state is loaded: `{ v: number, data: T }`
- `'update'` - Emitted with array of diffs after each update
- `'connected'` - Emitted when source transport connects
- `'disconnected'` - Emitted when source transport disconnects
- `'timing'` - Emitted periodically with average message latency in ms

### Initialization Sequence

The client uses a linked-list message queue to handle messages during initialization:

1. `subscribe()` subscribes to ZMQ topic `_SO_{name}`
2. After `initDelay` ms, sends RPC "init" request
3. **During wait:** All incoming messages are queued in a linked-list regardless of version
4. On RPC response:
   - Install snapshot data and version
   - Filter queue: discard messages with `v <= snapshot.v`
   - Set `ready = true`
   - Apply remaining queued messages in order
5. Emit `'init'` event

**Linked-list Structure:**
```
firstChange -> {v, diffs, next} -> {v, diffs, next} -> null
                                                        ^
                                                   lastChange
```

Each node contains:
- `v` - Version number
- `diffs` - Array of diff objects
- `now` - Server timestamp
- `next` - Pointer to next node (null for last)

### Version Gap Handling

After initialization, the client expects sequential version numbers. If a version gap is detected:
1. Log error with expected and received versions
2. Trigger automatic reinitialization (`_init()`)

### Disconnect Handling

When the source transport disconnects:
1. Emit synthetic deletion diffs for all top-level properties (kind: 'D')
2. Emit `'update'` event with these diffs
3. Flush all state (reset `data`, `_v`, clear message queue)
4. On reconnect: automatically reinitialize if was subscribed

### Init Retry

If the init RPC fails:
- Log error
- Retry after 1000ms if still subscribed

## 11. Heartbeat System

### Server

Sends periodic heartbeat messages on the source transport:
```typescript
{
  endpoint: '_heartbeat',
  frequencyMs: number  // Same as heartbeatMs option
}
```

Interval is configurable via `heartbeatMs` option (default: 5000ms).

### Client

**Lazy Activation:**
- Does not start timeout checking until first heartbeat is received
- Learns `frequencyMs` from the first heartbeat message

**Timeout Detection:**
- Checks every `frequencyMs` milliseconds
- Any source message (not just heartbeat) resets the timeout timer
- Timeout threshold: 3x heartbeat frequency

**On Timeout:**
1. Disconnect from source transport
2. Call `_sourceClosed()` (emits disconnected events, flushes SharedObjects)
3. Immediately reconnect to source transport

## 12. Validation System

### Schema Format
Schemas are provided as plain JSON Schema. TypeBox is used internally for compilation and validation.

### Date Handling
- Schemas use `{ "type": "string", "format": "date" }` or `format: "date-time"`
- Library registers custom format handler
- On receive: ISO strings are auto-converted to Date objects
- On send: Date objects are serialized to ISO strings

Note: Current implementation uses custom `type: "date"`. Rewrite should use standard format.

### Validation Timing
- **RPC:** Request validated on server (dates parsed), response validated on server (no date parsing) and client (dates parsed)
- **Source:** Message validated on server (no date parsing), validated on client (dates parsed)
- **Sink:** Message validated on client (no date parsing)
- **PushPull:** Message validated on server (no date parsing)
- **SharedObject:** Full object validated on server, diffs have dates parsed on client

### Validation Errors
Validation failures throw an Error with message `"Validation failed! {details}"`.

## 13. Error Types

The rewrite should define structured error classes:

```typescript
class ValidationError extends Error {
  constructor(message: string, details: ValidationDetails);
}

class TimeoutError extends Error {
  constructor(message: string, timeoutMs: number);
}

class ConnectionError extends Error {
  constructor(message: string, address: string);
}

class VersionMismatchError extends Error {
  constructor(message: string, expected: number, received: number);
}
```

## 14. Wire Formats

### Source/SharedObject Messages
ZMQ multipart message: `[topic, JSON]`

**Source:**
```typescript
{
  endpoint: string,
  message: T
}
```

**SharedObject Update:**
```typescript
{
  endpoint: "_SO_{name}",
  message: {
    diffs: Diff[],
    v: number,
    now: Date
  }
}
```

### Heartbeat
```typescript
{
  endpoint: "_heartbeat",
  frequencyMs: number
}
```

### RPC Request
HTTP POST body:
```typescript
{
  endpoint: string,
  input: T
}
```

### RPC Response
HTTP response body:
```typescript
{
  err: any | null,
  res: R | undefined
}
```

### Sink/PushPull Messages
ZMQ single-part message: `JSON.stringify(message)`

## 15. Diff Format

Uses the deep-diff library format:

```typescript
type Diff =
  | { kind: 'N'; path: (string | number)[]; rhs: any }           // New property
  | { kind: 'D'; path: (string | number)[]; lhs: any }           // Deleted property
  | { kind: 'E'; path: (string | number)[]; lhs: any; rhs: any } // Edited property
  | { kind: 'A'; path: (string | number)[]; index: number; item: Diff } // Array change
```

**Path Format:**
- Array of property names/indices from root to changed value
- Example: `['players', 'player1', 'score']`

## 16. Transport Details

### Source (PUB/SUB)
- **Server:** ZMQ PUB socket, binds to address
- **Client:** ZMQ SUB socket, connects to address
- **Socket Options:**
  - `ZMQ_SNDHWM`: 10000 (send high water mark)
  - `ZMQ_LINGER`: 0 (don't wait on close)
  - `ZMQ_IMMEDIATE`: 1 (only queue for completed connections)

### Sink (PUSH/PULL - Many to One)
- **Server:** ZMQ PULL socket, binds to address
- **Client:** ZMQ PUSH socket, connects to address

### RPC (HTTP)
- **Server:** HTTP server listening on port
- **Client:** HTTP POST requests
- **Content-Type:** application/json

### PushPull (PUSH/PULL - One to Many)
- **Server:** ZMQ PUSH socket, binds to address
- **Client:** ZMQ PULL socket, connects to address

## 17. Statistics

All endpoints (except Client-side RPC and Source) have:

```typescript
getStats(): { updates: number }
```

**Behavior:**
- Returns the current count of messages sent/received
- Resets the counter to 0 after returning

This enables periodic monitoring by calling `getStats()` at regular intervals.

## 18. Test Helpers

The library should export test utilities:

```typescript
/**
 * Wait for an event to be emitted
 */
function waitFor(
  emitter: EventEmitter,
  event: string,
  timeout?: number  // Default: 5000ms
): Promise<any>

/**
 * Promise-based delay
 */
function delay(ms: number): Promise<void>

/**
 * Create a descriptor for testing
 */
function createDescriptor(
  basePort: number,
  options: {
    source?: boolean;
    sink?: boolean;
    rpc?: boolean;
    pushpull?: boolean;
    endpoints?: Endpoint[];
  }
): Descriptor
```

### Port Allocation
Tests creating their own servers must use unique base ports (increment by 100+) to avoid conflicts.

### Teardown Order
Proper cleanup sequence:
1. `client.EndpointName.unsubscribe()` - Cancel pending operations
2. `await delay(50)` - Let operations settle
3. `client.close()`
4. `server.close()`
5. `await delay(50)` - Let sockets fully close

## 19. Implementation Notes

### Internal Endpoint Naming
SharedObject endpoints are prefixed internally:
- ZMQ topic: `_SO_{name}`
- RPC endpoint: `_SO_{name}`

### Heartbeat Channel
All clients automatically subscribe to the `_heartbeat` topic on the source transport.

### MonitoredSocket
The client uses a MonitoredSocket wrapper around ZMQ sockets that:
- Emits `'connected'` and `'disconnected'` events
- Monitors socket state changes

### Fast-copy Usage
The server uses fast-copy for deep cloning state snapshots to avoid mutation issues during diff computation.

### Sliced Cache (Performance Optimization)
SharedObjectClient uses a tinycache instance to cache computed date paths for diff processing, with 10-second TTL.
