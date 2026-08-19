/**
 * Static view serving (spec §2.3). Only this module and play.ts register routes.
 */
import { Router } from "oak";

export const viewsRouter = new Router();

async function readView(name: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(`./static/views/${name}.html`);
  } catch {
    return null;
  }
}

viewsRouter.get("/:view.html", async (context) => {
  const view = context.params.view;
  const body = view ? await readView(view) : null;
  if (body !== null) {
    context.response.type = "text/html";
    context.response.body = body;
  } else {
    context.response.status = 404;
    context.response.body = view ? "View not found" : "View not provided";
  }
});
