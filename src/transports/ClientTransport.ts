/**
 * Generic client-side transport interface.
 *
 * The transport provides a single WebSocket connection used by the mux layer.
 */

export interface ClientTransport {
  /**
   * Whether currently connected.
   */
  readonly connected: boolean;

  /**
   * Connect to a WebSocket URL.
   */
  connect(url: string): Promise<void>;

  /**
   * Close the connection and stop reconnect attempts.
   */
  close(): void;

  /**
   * Send a text message.
   */
  send(text: string): void;

  /**
   * Register lifecycle callbacks.
   */
  onOpen(cb: () => void): void;
  onClose(cb: (code: number, reason: string) => void): void;
  onError(cb: (err: Error) => void): void;
  onMessage(cb: (text: string) => void): void;
}

