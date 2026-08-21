/** Typed, in-process fan-out for one real-time channel per region. */

export type RegionEventType =
  | "presence.changed"
  | "social.changed"
  | "message.posted"
  | "market.changed"
  | "camera.changed"
  | "region.stats"
  | "cell.encounter"
  | "cell.operation";

export interface RegionEvent {
  id: string;
  type: RegionEventType;
  region: string;
  occurredAt: string;
  actorId?: string;
  location?: string;
  data?: Record<string, string | number | boolean | null>;
}

export type RegionEventListener = (event: RegionEvent) => void;

// Console logging with ANSI colors: green = routine, yellow = noteworthy,
// red = adversarial. Honors NO_COLOR and non-TTY output (e.g. systemd).
const COLOR = {
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  reset: "\x1b[0m",
};
const EVENT_STATUS: Record<RegionEventType, keyof typeof COLOR> = {
  "presence.changed": "green",
  "social.changed": "green",
  "region.stats": "green",
  "message.posted": "yellow",
  "market.changed": "yellow",
  "camera.changed": "yellow",
  "cell.encounter": "red",
  "cell.operation": "red",
};

export function logRegionEvent(event: RegionEvent): void {
  const useColor = !Deno.env.get("NO_COLOR") && Deno.stdout.isTerminal();
  const status = EVENT_STATUS[event.type] ?? "green";
  const label = event.type;
  const line = `${event.occurredAt} [${event.region}] ${label}` +
    (event.actorId ? ` actor=${event.actorId}` : "") +
    (event.location ? ` @${event.location}` : "");
  console.log(
    useColor ? `${COLOR[status]}${line}${COLOR.reset}` : line,
  );
}

export class RegionEventBus {
  readonly #channels = new Map<string, Set<RegionEventListener>>();

  subscribe(region: string, listener: RegionEventListener): () => void {
    const listeners = this.#channels.get(region) ?? new Set();
    listeners.add(listener);
    this.#channels.set(region, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#channels.delete(region);
    };
  }

  publish(
    event:
      & Omit<RegionEvent, "id" | "occurredAt">
      & Partial<Pick<RegionEvent, "id" | "occurredAt">>,
  ): RegionEvent {
    const published: RegionEvent = {
      ...event,
      id: event.id ?? crypto.randomUUID(),
      occurredAt: event.occurredAt ?? new Date().toISOString(),
    };
    logRegionEvent(published);
    for (const listener of this.#channels.get(event.region) ?? []) {
      try {
        listener(published);
      } catch {
        // A failed subscriber must never block the rest of a regional channel.
      }
    }
    return published;
  }

  subscriberCount(region: string): number {
    return this.#channels.get(region)?.size ?? 0;
  }
}

export const regionEvents = new RegionEventBus();
