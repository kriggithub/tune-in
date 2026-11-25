// Serves the app (public/) and relays online games. One Durable Object per 4-letter room:
// it keeps the latest game state and forwards every update to the other players in the room.
import { DurableObject } from 'cloudflare:workers';

const WEEK = 7 * 24 * 60 * 60 * 1000;

export class Room extends DurableObject {
  async fetch() {
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.send((await this.ctx.storage.get('s')) ?? 'null');
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws, msg) {
    if (typeof msg !== 'string' || msg.length > 100_000) return;
    await this.ctx.storage.put('s', msg);
    await this.ctx.storage.setAlarm(Date.now() + WEEK); // rooms idle for a week are wiped
    for (const other of this.ctx.getWebSockets()) if (other !== ws) other.send(msg);
  }
  async alarm() { await this.ctx.storage.deleteAll(); }
}

export default {
  fetch(req, env) {
    const room = new URL(req.url).pathname.match(/^\/room\/([A-Z]{4})$/);
    if (room && req.headers.get('Upgrade') === 'websocket') return env.ROOM.get(env.ROOM.idFromName(room[1])).fetch(req);
    return env.ASSETS.fetch(req);
  },
};
