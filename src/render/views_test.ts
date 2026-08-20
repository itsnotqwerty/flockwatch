import { assert, assertEquals } from "$assert";
import { renderPage, renderReset } from "./views.ts";

Deno.test("renderPage gives every POST form a unique action request id", () => {
  const page = renderPage({
    title: "Test",
    body: `<form method="post" action="/"></form>
<form method="post" action="/"></form>
<form method="get" action="/"></form>`,
  });
  const ids = [...page.matchAll(/name="request_id" value="([^"]+)"/g)]
    .map((match) => match[1]);
  assertEquals(ids.length, 2);
  assert(ids[0] !== ids[1]);
  assertEquals(page.match(/<form method="get"/g)?.length, 1);
});

Deno.test("renderReset restarts an NPC conversation without a node", () => {
  const control = renderReset("chi_omar");
  assert(control.includes('name="a" value="talk"'));
  assert(control.includes('name="npc" value="chi_omar"'));
  assert(!control.includes('name="node"'));
  assert(control.includes("Start over"));
});
