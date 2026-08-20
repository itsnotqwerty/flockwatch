import { Router } from "oak";
import { type RegionEvent, regionEvents } from "../realtime/region-events.ts";
import {
  getPlayerForSession,
  sessionTokenFromCookie,
} from "../state/accounts.ts";

export const eventsRouter = new Router();

function sameOrigin(requestUrl: URL, origin: string | null): boolean {
  if (!origin) return true;
  try {
    return new URL(origin).host === requestUrl.host;
  } catch {
    return false;
  }
}

eventsRouter.get("/events/session", async (context) => {
  const token = sessionTokenFromCookie(context.request.headers.get("cookie"));
  const player = token ? await getPlayerForSession(token) : null;
  if (!player) {
    context.response.status = 401;
    context.response.body = { error: "A character session is required." };
    return;
  }
  context.response.type = "json";
  context.response.body = { playerId: player.id, region: player.region };
});

eventsRouter.get("/events/:region", async (context) => {
  const token = sessionTokenFromCookie(context.request.headers.get("cookie"));
  const player = token ? await getPlayerForSession(token) : null;
  const region = context.params.region ?? "";
  if (!player) {
    context.response.status = 401;
    context.response.body = "A character session is required.";
    return;
  }
  if (player.region !== region) {
    context.response.status = 403;
    context.response.body = "Your character is not assigned to that channel.";
    return;
  }
  if (!sameOrigin(context.request.url, context.request.headers.get("origin"))) {
    context.response.status = 403;
    context.response.body = "Cross-origin channel subscriptions are refused.";
    return;
  }
  if (!context.isUpgradable) {
    context.response.status = 426;
    context.response.headers.set("upgrade", "websocket");
    context.response.body = "A WebSocket upgrade is required.";
    return;
  }

  let socket: WebSocket;
  try {
    socket = context.upgrade();
  } catch {
    context.respond = true;
    context.response.status = 501;
    context.response.body =
      "This Oak runtime does not provide native WebSocket upgrades.";
    return;
  }
  let unsubscribe: (() => void) | null = null;
  let heartbeat: number | null = null;
  const send = (event: RegionEvent) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(event));
    }
  };
  const cleanup = () => {
    unsubscribe?.();
    unsubscribe = null;
    if (heartbeat !== null) clearInterval(heartbeat);
    heartbeat = null;
  };

  socket.onopen = () => {
    unsubscribe = regionEvents.subscribe(region, send);
    send({
      id: crypto.randomUUID(),
      type: "presence.changed",
      region,
      occurredAt: new Date().toISOString(),
      actorId: player.id,
      location: player.location,
      data: { name: player.name, status: "connected" },
    });
    regionEvents.publish({
      type: "presence.changed",
      region,
      actorId: player.id,
      location: player.location,
      data: { name: player.name, status: "connected" },
    });
    heartbeat = setInterval(() => {
      send({
        id: crypto.randomUUID(),
        type: "presence.changed",
        region,
        occurredAt: new Date().toISOString(),
        actorId: player.id,
        location: player.location,
        data: { status: "heartbeat" },
      });
    }, 25_000);
  };
  socket.onclose = cleanup;
  socket.onerror = cleanup;
});
