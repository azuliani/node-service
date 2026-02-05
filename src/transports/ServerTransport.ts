/**
 * Generic server-side transport interface.
 *
 * This abstracts the underlying WebSocket implementation (uWebSockets.js vs ws).
 * The library's protocol/mux layer is responsible for JSON parsing and routing.
 */

export interface ServerTransport<Conn = unknown> {
  /**
   * Start listening.
   */
  listen(host: string, port: number): Promise<void>;

  /**
   * Close the server and all active connections.
   */
  close(): Promise<void>;

  /**
   * Register a callback invoked for each new connection.
   */
  onConnection(cb: (conn: Conn) => void): void;

  /**
   * Register a callback invoked when a connection closes.
   */
  onDisconnection(cb: (conn: Conn, code?: number, reason?: string) => void): void;

  /**
   * Register a callback invoked for each incoming WebSocket text message.
   *
   * The transport must pass raw text through without JSON parsing.
   */
  onMessage(cb: (conn: Conn, text: string) => void): void;

  /**
   * Send a text message to a connection.
   */
  send(conn: Conn, text: string): void;

  /**
   * Close a connection.
   */
  closeConnection(conn: Conn, code?: number, reason?: string): void;
}

