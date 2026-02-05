/**
 * Wire protocol frames for the single WebSocket multiplexed transport.
 *
 * All traffic (RPC, PubSub, PushPull, SharedObject, heartbeat) is sent over a
 * single WebSocket connection at path `/`.
 */

import type { Diff, SerializedError } from './types.ts';

// Client -> Server
export interface SubFrame {
  type: 'sub';
  endpoint: string;
}

export interface UnsubFrame {
  type: 'unsub';
  endpoint: string;
}

export interface RpcRequestFrame {
  type: 'rpc:req';
  id: number;
  endpoint: string;
  input: any;
}

export type ClientToServerFrame = SubFrame | UnsubFrame | RpcRequestFrame;

// Server -> Client
export interface HeartbeatFrame {
  type: 'heartbeat';
  frequencyMs: number;
}

export interface RpcResponseFrame {
  type: 'rpc:res';
  id: number;
  endpoint: string;
  err: SerializedError | null;
  res?: any;
}

/**
 * Generic endpoint message (PubSub + PushPull).
 */
export interface EndpointMessageFrame {
  endpoint: string;
  message: any;
}

export interface SharedObjectInitFrame {
  endpoint: string;
  type: 'init';
  data: any;
  v: number;
}

export interface SharedObjectUpdateFrame {
  endpoint: string;
  type: 'update';
  delta: Diff;
  v: number;
  now: string;
}

export type ServerToClientFrame =
  | HeartbeatFrame
  | RpcResponseFrame
  | EndpointMessageFrame
  | SharedObjectInitFrame
  | SharedObjectUpdateFrame;
