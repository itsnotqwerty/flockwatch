import { assertEquals } from "$assert";
import { type RegionEvent, RegionEventBus } from "./region-events.ts";

Deno.test("regional event channels are isolated and support unsubscribe", () => {
  const bus = new RegionEventBus();
  const cleveland: RegionEvent[] = [];
  const seattle: RegionEvent[] = [];
  const unsubscribe = bus.subscribe(
    "cleveland",
    (event) => cleveland.push(event),
  );
  bus.subscribe("seattle", (event) => seattle.push(event));

  bus.publish({
    id: "event_1",
    occurredAt: "2026-08-20T00:00:00.000Z",
    type: "market.changed",
    region: "cleveland",
    actorId: "player_1",
  });
  assertEquals(cleveland.length, 1);
  assertEquals(seattle.length, 0);
  assertEquals(bus.subscriberCount("cleveland"), 1);

  unsubscribe();
  bus.publish({ type: "camera.changed", region: "cleveland" });
  assertEquals(cleveland.length, 1);
  assertEquals(bus.subscriberCount("cleveland"), 0);
});

Deno.test("one failing subscriber does not block a regional channel", () => {
  const bus = new RegionEventBus();
  let delivered = 0;
  bus.subscribe("atlanta", () => {
    throw new Error("socket closed");
  });
  bus.subscribe("atlanta", () => delivered += 1);
  bus.publish({ type: "region.stats", region: "atlanta" });
  assertEquals(delivered, 1);
});
