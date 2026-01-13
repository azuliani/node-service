# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a Node.js library for building services with ZeroMQ-based messaging patterns. It provides both Service (server) and Client abstractions for different communication patterns.

## Commands

```bash
npm install           # Install dependencies
npm test              # Run the full test suite (node:test)
```

No build step required - this is vanilla JavaScript (CommonJS).

## Architecture

### Entry Point
- `index.js` - Exports `Service` and `Client` classes

### Service Types (in `Service/`)
Services are servers that expose endpoints. Created via `new Service(descriptor, handlers, initials, options)`.

Options:
- `heartbeatMs` - Heartbeat interval in milliseconds (default: 5000)

- **RPCService** - Request/response pattern over HTTP
- **SourceService** - Publishes messages to subscribers (ZMQ pub socket)
- **SinkService** - Receives messages from clients (ZMQ pull socket)
- **PushService** - Pushes messages to workers (ZMQ push socket)
- **SharedObjectService** - Syncs object state to clients via diffs; requires both Source and RPC transports

### Client Types (in `Client/`)
Clients connect to services. Created via `new Client(descriptor, options)`.

Options:
- `initDelay` - Delay in ms before SharedObjectClient fetches full state after subscribe (default: 100)

- **RPCClient** - Calls RPC endpoints with timeout support
- **SourceClient** - Subscribes to source messages (ZMQ sub socket)
- **SinkClient** - Sends messages to sink (ZMQ push socket)
- **PullClient** - Receives pushed messages (ZMQ pull socket)
- **SharedObjectClient** - Maintains synchronized copy of server's SharedObject; has `connected` and `subscribed` getters

### Descriptor Format
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
    { name: "MySO", type: "SharedObject", objectSchema: {...} },
    // ...
  ]
}
```

### Validation (`misc/Validation.js`)
Schema validation using `schema-inspector`. Schemas support:
- Standard types: `string`, `number`, `object`, `array`
- Special type `date` for automatic Date parsing from JSON
- Wildcard `*` in object properties for dynamic keys
- Set `skip: true` on schema to bypass validation

### Heartbeat System
Services automatically send heartbeat messages on the source transport. Clients detect disconnection when no messages (heartbeat or data) arrive within 3x the heartbeat interval.

- Client learns heartbeat frequency from the first heartbeat message (lazy activation)
- Heartbeat timeout triggers automatic disconnect/reconnect cycle
- On disconnect, SharedObjectClient emits synthetic deletion diffs before flushing data

### Lifecycle Methods
Both `Service` and `Client` have a `close()` method for proper cleanup:
```javascript
service.close();  // Stops heartbeat, closes all sockets
client.close();   // Stops heartbeat checking, closes all sockets
```

### Examples
Working examples are in `examples/`:
- `examples/RPC/` - RPC request/response pattern
- `examples/SharedObject/` - SharedObject synchronization pattern

Run with: `node examples/RPC/server.js` and `node examples/RPC/client.js`

### Test Suite
Tests use Node.js built-in `node:test` framework:
```bash
npm test                           # Run all tests
node --test test/rpc.test.js       # Run specific test file
```

Test files: `heartbeat.test.js`, `rpc.test.js`, `source.test.js`, `sink.test.js`, `pushpull.test.js`, `sharedObject.test.js`

Test helpers in `test/helpers.js`: `waitFor(emitter, event)`, `delay(ms)`, `createDescriptor(basePort, options)`

## Git Commits

Do not add Co-Authored-By lines to commit messages.
