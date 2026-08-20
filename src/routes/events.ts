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

function attachRegionalSocket(
  socket: WebSocket,
  player: NonNullable<Awaited<ReturnType<typeof getPlayerForSession>>>,
  region: string,
): void {
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
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
}

/** Upgrade regional channels before entering Oak's Node compatibility layer. */
export async function upgradeRegionalSocket(
  request: Request,
): Promise<Response | null> {
  const match = new URL(request.url).pathname.match(/^\/events\/([^/]+)$/);
  if (!match || match[1] === "session") return null;
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return null;
  }

  const token = sessionTokenFromCookie(request.headers.get("cookie"));
  const player = token ? await getPlayerForSession(token) : null;
  if (!player) {
    return new Response("A character session is required.", { status: 401 });
  }

  const region = decodeURIComponent(match[1]);
  if (player.region !== region) {
    return new Response("Your character is not assigned to that channel.", {
      status: 403,
    });
  }
  if (!sameOrigin(new URL(request.url), request.headers.get("origin"))) {
    return new Response("Cross-origin channel subscriptions are refused.", {
      status: 403,
    });
  }

  const { socket, response } = Deno.upgradeWebSocket(request);
  attachRegionalSocket(socket, player, region);
  return response;
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
  attachRegionalSocket(socket, player, region);
});
