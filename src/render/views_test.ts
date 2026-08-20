import { assert, assertEquals } from "$assert";
import { renderPage } from "./views.ts";

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
