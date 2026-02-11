# Migration Plan: `old` Branch (`v0.0.1`) -> Current Branch (`main`)

This plan is for services currently using the legacy ZeroMQ implementation on branch `old`.

## Executive Summary

- Messaging moved from per-pattern ZeroMQ sockets to one muxed WebSocket connection.
- Endpoint APIs changed from dynamic properties (for example `client.State`) to explicit getters (`client.SO('State')`, `client.PS('Events')`, `client.RPC('X')`).
- Descriptor shape changed (`transports` string URLs -> `transport.client/server` host+port objects).
- `Source` is now `PubSub`.
- `Sink` and `PushPull` are removed.

## Two Non-Negotiable Runtime Changes

1. **`SharedObjectClient.data` throws when non-ready.**
`client.SO('X').data` is only safe after init. If accessed before first init or after disconnect, it throws (`SharedObject not ready: X`).

2. **You must handle `disconnected` for SharedObjects.**
There are **no synthetic root-level delete deltas on disconnect** anymore. Do not wait for delete-style updates to clear state; clear/disable derived state from the `disconnected` event.

## Phase 0: Inventory and Freeze

1. Identify all services and clients still pinned to the `old` branch/tag (`v0.0.1`).
2. Enumerate endpoint usage by type: `RPC`, `Source`, `SharedObject`, `Sink`, `PushPull`.
3. Freeze descriptor changes during migration to avoid dual moving targets.

## Phase 1: Descriptor and Transport Migration

Replace legacy transport strings:

```js
// old
transports: {
  source: { client: 'tcp://127.0.0.1:5555', server: 'tcp://127.0.0.1:5555' },
  rpc: { client: 'tcp://127.0.0.1:5556', server: 'tcp://127.0.0.1:5556' }
}
```

With current shape:

```ts
// current
transport: {
  server: { host: '0.0.0.0', port: 3000 },
  client: { host: '127.0.0.1', port: 3000 }
}
```

Notes:
- All endpoint traffic is multiplexed over one WebSocket at `ws://{host}:{port}/`.
- A mismatch here fails fast during client/service construction.

## Phase 2: Endpoint Type Mapping

1. Rename `Source` endpoints to `PubSub`.
2. Replace dynamic endpoint access with explicit accessors:
- `client.EndpointName` -> `client.RPC('EndpointName')` or `client.PS('EndpointName')` or `client.SO('EndpointName')`
- `service.EndpointName` -> `service.RPC('EndpointName')` or `service.PS('EndpointName')` or `service.SO('EndpointName')`
3. Remove `Sink`/`PushPull` usage; redesign those flows with supported patterns (`RPC`/`PubSub`/`SharedObject`).

## Phase 3: SharedObject Service-Side Updates

1. Provide explicit `initials` for **every** SharedObject endpoint in `new Service(descriptor, handlers, initials)`.
2. Keep/choose notification mode:
- Default `autoNotify: true` for automatic batched detection.
- Set `autoNotify: false` if you need explicit `notify()` control.

## Phase 4: SharedObject Client-Side Updates (Critical)

### 4.1 Gate all `data` reads behind init/readiness

Use one of these patterns:

```ts
const so = client.SO('State');
await so.subscribe(); // resolves after init
console.log(so.data); // safe
```

Or event-driven:

```ts
const so = client.SO('State');
so.on('init', () => {
  render(so.data); // safe only while ready
});
so.subscribe();
```

### 4.2 Handle disconnect explicitly (mandatory)

```ts
const so = client.SO('State');

so.on('disconnected', () => {
  // REQUIRED: clear cached/derived state here.
  // There are no synthetic root-level delete diffs on disconnect.
  clearStateInStore();
  showOfflineUI();
});

so.on('init', () => {
  hideOfflineUI();
  render(so.data);
});
```

Do not rely on `update` events that look like root deletes to signal disconnection. They are not emitted.

## Phase 5: RPC and PubSub Call Site Migration

1. Update RPC usage to `await client.RPC('X').call(input)`.
2. Update PubSub usage to `client.PS('X').subscribe()` and `'message'` event handlers.
3. Add or update schema expectations to JSON Schema + date formats (`format: 'date'` / `'date-time'`).

## Phase 6: Validation and Rollout

1. Add migration tests in each service repo:
- Accessing `SO.data` before init should fail in tests (or be guarded by readiness).
- Disconnect path must clear local state from `'disconnected'` handler.
2. Run canary with one service/client pair first.
3. Roll out by dependency order (core services before leaf consumers).
4. Monitor reconnect/init behavior during rollout windows.

## Practical Search/Replace Checklist

1. Search for dynamic endpoint access (`client.` / `service.` endpoint-name property calls).
2. Search for SharedObject `data` reads outside `'init'`/`'update'` guarded flows.
3. Search for disconnect handling gaps:
- missing `so.on('disconnected', ...)`
- logic expecting delete deltas on disconnect
4. Search and replace descriptor `transports` -> `transport` shape.

## Migration Exit Criteria

1. No runtime throws from non-ready SharedObject data access.
2. All SharedObject consumers register a disconnect handler.
3. No code path depends on synthetic root-level delete deltas during disconnect.
4. All services boot with valid `initials` for SharedObject endpoints.
5. End-to-end reconnect test passes (disconnect -> disconnected event -> re-init -> normal updates).
