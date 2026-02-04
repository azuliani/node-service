# node-service

Node.js library for building services with ZeroMQ-based messaging patterns. Provides both Service (server) and Client abstractions for different communication patterns.

## Installation

```bash
npm install node-service
```

## Quick Start

```javascript
const { Service, Client } = require('node-service');

// Define a descriptor
const descriptor = {
  transports: {
    rpc: { client: "tcp://127.0.0.1:5555", server: "tcp://127.0.0.1:5555" }
  },
  endpoints: [
    { name: "Echo", type: "RPC", requestSchema: { type: "string" }, replySchema: { type: "string" } }
  ]
};

// Create a service
const service = new Service(descriptor, {
  Echo: (request) => request  // Echo handler
});

// Create a client
const client = new Client(descriptor);
const reply = await client.Echo("Hello");
console.log(reply);  // "Hello"
```

## Service Types

Services are servers that expose endpoints. Created via `new Service(descriptor, handlers, initials, options)`.

| Type | Description |
|------|-------------|
| **RPCService** | Request/response pattern over ZMQ dealer/router |
| **SourceService** | Publishes messages to subscribers (ZMQ pub socket) |
| **SinkService** | Receives messages from clients (ZMQ pull socket) |
| **PushService** | Pushes messages to workers (ZMQ push socket) |
| **SharedObjectService** | Syncs object state to clients via diffs |

### Service Options

- `heartbeatMs` - Heartbeat interval in milliseconds (default: 5000)

## Client Types

Clients connect to services. Created via `new Client(descriptor, options)`.

| Type | Description |
|------|-------------|
| **RPCClient** | Calls RPC endpoints with timeout support |
| **SourceClient** | Subscribes to source messages (ZMQ sub socket) |
| **SinkClient** | Sends messages to sink (ZMQ push socket) |
| **PullClient** | Receives pushed messages (ZMQ pull socket) |
| **SharedObjectClient** | Maintains synchronized copy of server's SharedObject |

### Client Options

- `initDelay` - Delay in ms before SharedObjectClient fetches full state after subscribe (default: 100)

## Descriptor Format

Both Service and Client use the same descriptor object:

```javascript
{
  transports: {
    source: { client: "tcp://...", server: "tcp://..." },
    sink:   { client: "tcp://...", server: "tcp://..." },
    rpc:    { client: "tcp://...", server: "tcp://..." },
    pushpull: { client: "tcp://...", server: "tcp://..." }
  },
  endpoints: [
    { name: "MyRPC", type: "RPC", requestSchema: {...}, replySchema: {...} },
    { name: "MySource", type: "Source", messageSchema: {...} },
    { name: "MySO", type: "SharedObject", objectSchema: {...} }
  ]
}
```

## Schema Validation

Schema validation using `schema-inspector`. Schemas support:
- Standard types: `string`, `number`, `object`, `array`
- Special type `date` for automatic Date parsing from JSON
- Wildcard `*` in object properties for dynamic keys
- Set `skip: true` on schema to bypass validation

## Heartbeat System

Services automatically send heartbeat messages on the source transport. Clients detect disconnection when no messages arrive within 3x the heartbeat interval.

- Client learns heartbeat frequency from the first heartbeat message
- Heartbeat timeout triggers automatic disconnect/reconnect cycle
- On disconnect, SharedObjectClient emits synthetic deletion diffs before flushing data

## Lifecycle

Both `Service` and `Client` have a `close()` method for proper cleanup:

```javascript
service.close();  // Stops heartbeat, closes all sockets
client.close();   // Stops heartbeat checking, closes all sockets
```

## License

MIT
