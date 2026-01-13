# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a Node.js library for building services with ZeroMQ-based messaging patterns. It provides both Service (server) and Client abstractions for different communication patterns.

## Commands

```bash
npm install           # Install dependencies
node test/test1.js    # Run the main integration test
```

No build step required - this is vanilla JavaScript (CommonJS).

## Architecture

### Entry Point
- `index.js` - Exports `Service` and `Client` classes

### Service Types (in `Service/`)
Services are servers that expose endpoints. Created via `new Service(descriptor, handlers, initials)`.

- **RPCService** - Request/response pattern over HTTP
- **SourceService** - Publishes messages to subscribers (ZMQ pub socket)
- **SinkService** - Receives messages from clients (ZMQ pull socket)
- **PushService** - Pushes messages to workers (ZMQ push socket)
- **SharedObjectService** - Syncs object state to clients via diffs; requires both Source and RPC transports

### Client Types (in `Client/`)
Clients connect to services. Created via `new Client(descriptor, options)`.

- **RPCClient** - Calls RPC endpoints with timeout support
- **SourceClient** - Subscribes to source messages (ZMQ sub socket)
- **SinkClient** - Sends messages to sink (ZMQ push socket)
- **PullClient** - Receives pushed messages (ZMQ pull socket)
- **SharedObjectClient** - Maintains synchronized copy of server's SharedObject

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

## Git Commits

Do not add Co-Authored-By lines to commit messages.
