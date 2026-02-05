# node-service

WebSocket-based messaging library for Node.js with `Service`/`Client` abstractions.

- Single WebSocket connection per client (muxed frames)
- Patterns: **RPC**, **PubSub**, **PushPull**, **SharedObject** (diff-based state sync)
- JSON Schema validation with automatic `Date` serialization/parsing (`format: "date"` / `"date-time"`)
- Heartbeats + reconnect support

For the full specification, see [SPEC.md](./SPEC.md). For intentional spec/impl diffs, see [DIFFERENCES.md](./DIFFERENCES.md).

## Install

Requires **Node.js >= 23.6.0**.

```bash
npm install node-service
```

## Quick start (RPC)

```ts
import { Client, Service } from 'node-service';
import type { Descriptor, RPCEndpoint } from 'node-service';

const descriptor: Descriptor = {
  transport: {
    server: '127.0.0.1:3000', // bind address
    client: '127.0.0.1:3000', // client connects to ws://{client}/
  },
  endpoints: [
    {
      name: 'greet',
      type: 'RPC',
      requestSchema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
      replySchema: {
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message'],
      },
    } as RPCEndpoint,
  ],
};

const service = new Service(
  descriptor,
  {
    greet: async ({ name }: { name: string }) => ({ message: `Hello, ${name}!` }),
  },
  {} // no SharedObjects
);
await service.ready();

const client = new Client(descriptor);
const res = await client.RPC('greet').call({ name: 'World' });
console.log(res.message);

client.close();
await service.close();
```

### CommonJS

This package ships both ESM and CommonJS entrypoints. In CommonJS, use `require()`:

```js
const { Client, Service } = require('node-service');
```

## Patterns

All patterns share one WebSocket per client at `ws://{descriptor.transport.client}/`.

### PubSub

- Server: `service.PS('Events').send(message)`
- Client: `client.PS('Events').subscribe()` then listen for `'message'`

### PushPull

- Server: `service.PP('Work').push(message)` → returns `true` if delivered, `false` if queued (no workers)
- Client: `client.PP('Work').subscribe()` then listen for `'message'`

### SharedObject

SharedObject state lives on the server; clients receive an `init` snapshot, then `update` diffs.

```ts
import { Client, Service } from 'node-service';
import type { Descriptor, SharedObjectEndpoint } from 'node-service';

const descriptor: Descriptor = {
  transport: { server: '127.0.0.1:3001', client: '127.0.0.1:3001' },
  endpoints: [
    {
      name: 'Counter',
      type: 'SharedObject',
      objectSchema: {
        type: 'object',
        properties: { value: { type: 'number' } },
        required: ['value'],
      },
    } as SharedObjectEndpoint,
  ],
};

const service = new Service(descriptor, {}, { Counter: { value: 0 } });
await service.ready();

const client = new Client(descriptor);
await client.SO('Counter').subscribe(); // resolves on init

service.SO('Counter').data.value += 1;
service.SO('Counter').notify(['value']);
```

Notes:
- `SharedObjectClient.data` throws while not ready; `await subscribe()` (or wait for the `'init'` event) first.
- `autoNotify` is enabled by default; set `autoNotify: false` in the endpoint descriptor to require manual `notify()`.

## Plugins / Service specs

You can define a reusable service “spec” (descriptor + plugins) and then create a service/client from it:

```ts
import {
  auditLogPlugin,
  createClient,
  createService,
  defineServiceSpec,
  healthPlugin,
  metricsPlugin,
} from 'node-service';
import type { RPCEndpoint } from 'node-service';

const spec = defineServiceSpec({
  transport: { server: '0.0.0.0:3000', client: '127.0.0.1:3000' },
  endpoints: [
    {
      name: 'greet',
      type: 'RPC',
      requestSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      replySchema: { type: 'string' },
    } as RPCEndpoint,
  ],
  plugins: [healthPlugin(), metricsPlugin(), auditLogPlugin()],
});

const service = createService(spec, { greet: async ({ name }: { name: string }) => `hi ${name}` }, {});
await service.ready();

const client = createClient(spec);
const health = await client.RPC('_health').call(null);
const metrics = await client.RPC('_metrics').call(null);
client.PS('_audit').subscribe();
```

Built-in plugin endpoints:
- `healthPlugin()` → `RPC _health`
- `metricsPlugin()` → `RPC _metrics`
- `auditLogPlugin()` → `PubSub _audit`

## Examples

See `examples/`:

```bash
node examples/rpc-basic.ts
node examples/sharedobject-basic.ts
```

CommonJS usage is shown in `examples/*.cjs`.

## Debug logging

This library uses the [`debug`](https://www.npmjs.com/package/debug) package.

```bash
DEBUG=node-service:* node your-script.js
```

## Legacy implementation

The previous ZeroMQ-based implementation is preserved on branch `old` (and tag `v0.0.1`).

## License

MIT (see [LICENSE](./LICENSE)).
