/**
 * WebSocket fan-out helper.
 *
 * Lives in its own module so feature code (e.g. social publishing) can emit
 * events without importing the whole monitor engine.
 */
export function broadcastWs(event: string, payload: unknown) {
  const clients = globalThis.__clipxWsClients;
  if (!clients || clients.size === 0) return;
  const msg = JSON.stringify({
    event,
    payload,
    timestamp: new Date().toISOString(),
  });
  clients.forEach((ws) => {
    try {
      if (ws.readyState === 1) ws.send(msg);
    } catch {
      // ignore disconnected socket
    }
  });
}
