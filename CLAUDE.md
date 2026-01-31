# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Purpose

This repository implements a ZeroMQ-based messaging library for Node.js with Service/Client abstractions. **SPEC.md is the authoritative specification** - it contains everything needed to recreate this library from scratch.

## Critical Workflow

**Every code change must be reflected in SPEC.md.** When you modify the implementation:
1. Make the code change
2. Update SPEC.md to match the new behavior
3. Ensure SPEC.md remains sufficient for a fresh implementation

## Commands

```bash
npm install           # Install dependencies
npm test              # Run full test suite (node:test)
node --test test/rpc.test.js  # Run single test file
```

No build step - TypeScript with ESM native, CommonJS bindings.

## Architecture

### Core Abstractions
- **Service** - Server-side: `new Service(descriptor, handlers, initials, options)`
- **Client** - Client-side: `new Client(descriptor, options)`

### Transport Patterns
| Pattern | Server Socket | Client Socket | Use Case |
|---------|--------------|---------------|----------|
| RPC | HTTP server | HTTP client | Request/response |
| Source | ZMQ PUB | ZMQ SUB | Pub/sub broadcast |
| Sink | ZMQ PULL | ZMQ PUSH | Many-to-one collection |
| PushPull | ZMQ PUSH | ZMQ PULL | Work distribution |
| SharedObject | Source + RPC | Source + RPC | State synchronization via diffs |

### Descriptor Format
Both Service and Client use the same descriptor defining transports and endpoints. See SPEC.md §3 for full schema.

### SharedObject Specifics
- Server owns mutable `data`, calls `notify()` to broadcast diffs
- Client maintains read-only proxy of `data`
- Init sequence: subscribe → delay → RPC fetch → queue replay → ready
- Version gaps trigger automatic reinitialization

### Validation
- User-facing: Plain JSON Schema
- Internal: TypeBox 1.0 for compilation
- Date handling: `format: "date"` auto-converts ISO strings ↔ Date objects

## Test Requirements

When writing tests with custom Service/Client pairs:
1. **Unique ports** - Each test must use a unique base port (increment by 100+)
2. **Teardown order** - Always: `client.unsubscribe()` → `delay(50)` → `client.close()` → `server.close()` → `delay(50)`
3. **Use helpers** - `createDescriptor(basePort, options)`, `waitFor(emitter, event)`, `delay(ms)`
