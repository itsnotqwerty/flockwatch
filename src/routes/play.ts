/**
 * Play routes (design: "one door"). The whole game is played at the root URL —
 * GET / shows the park, POST / carries every action via hidden form fields so
 * no game state is ever visible in the address bar (spec §3.1: quests stay
 * hidden, routes stay unremarkable).
 *
 * Phase 1 uses a single demo player until accounts land in Phase 6.
 */
import { Router } from "oak";
import { acceptQuest, availableOptions, getNode, resolveSelection } from "../game/dialogue.ts";
import { advanceStage, objectiveText, visibleQuests } from "../game/quests.ts";
import { renderDialogue } from "../render/grillsay.ts";
import {
  renderDialogueBlock,
  renderDialogueOptions,
  renderPage,
  renderQuestReveal,
  renderQuestTurnIn,
  renderReset,
} from "../render/views.ts";
import { getNpc, listNpcs } from "../state/content.ts";
import { ensurePlayer, getPlayer, savePlayer } from "../state/players.ts";
import { camerasInRegion, getCamera, listCameras, saveCamera } from "../state/cameras.ts";
import { getRegion, saveRegion } from "../state/regions.ts";
import { deleteListing, getListing, listListings, saveListing } from "../state/market.ts";
import {
  cooldownRemaining,
  coverageLevel,
  dismantleCamera,
  installCamera,
  totalScrap,
} from "../game/cameras.ts";
import { canCraft, craft, describeCost } from "../game/crafting.ts";
import { buyListing, cancelListing, createListing } from "../game/market.ts";
import { travel, travelCost, hasBureaucratsStamp } from "../game/travel.ts";
import { getItems, getQuests, getRecipes, getRegionContent } from "../content/index.ts";
import type { Item, Player } from "../types.ts";

export const playRouter = new Router();

// Single demo player until Phase 6 accounts.
const PLAYER_ID = "demo";
const PLAYER_NAME = "Citizen";

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Small helper: a POST button back to the root URL. */
function postButton(action: string, label: string, extra = ""): string {
  return `<form method="post" action="/">
  <input type="hidden" name="a" value="${action}">
${extra}
  <button type="submit" class="link-button">${label}</button>
</form>`;
}

// ── GET / — the park. The only address the player ever sees. ────────────────
playRouter.get("/", async (context) => {
  const player = await ensurePlayer(PLAYER_ID, PLAYER_NAME);
  const region = await getRegion(player.region);

  // NPCs local to the player's current region (spec §3.0).
  const npcList = (await listNpcs()).filter((n) => n.region === player.region);
  const items = npcList.length
    ? npcList
      .map(
        (n) => `<li>
<form method="post" action="/">
  <input type="hidden" name="a" value="talk">
  <input type="hidden" name="npc" value="${n.id}">
  <button type="submit" class="npc-link">${n.name}</button> — <em>${n.role}</em>
</form>
</li>`,
      )
      .join("\n")
    : `<li>No one here wants to talk. Wise of them.</li>`;

  const cameraBoard = await renderCameraBoard(player);
  const workbench = await renderWorkbench(player);
  const market = await renderMarket(player);
  const travelBoard = await renderTravel(player);

  context.response.type = "text/html";
  context.response.body = renderPage({
    title: "FlockWatch",
    body: `<h2>${region?.name ?? player.region}</h2>
<p>The pigeons are watching. Choose someone to talk to.</p>
<ul class="npc-list">
${items}
</ul>
${cameraBoard}
${workbench}
${market}
${travelBoard}
${postButton("log", "Review your assignments")}`,
  });
});

// ── POST / — every action. ──────────────────────────────────────────────────
playRouter.post("/", async (context) => {
  const body = context.request.body;
  const fields: Record<string, string> = {};
  if (body.type() === "form") {
    const form = await body.form();
    for (const [k, v] of form.entries()) fields[k] = String(v);
  }

  const action = fields.a ?? "home";

  if (action === "home") {
    context.response.redirect("/");
    return;
  }

  // ── Travel (spec §3.0) ────────────────────────────────────────────────
  if (action === "travel") {
    const player = await ensurePlayer(PLAYER_ID, PLAYER_NAME);
    const destination = (await getRegionContent()).find((r) => r.id === fields.region);
    if (destination) {
      const result = travel(player, destination);
      if (result.ok) await savePlayer(result.player);
    }
    context.response.redirect("/");
    return;
  }

  // ── Cameras (spec §3.6) ───────────────────────────────────────────────
  if (action === "install" || action === "dismantle") {
    const camera = await getCameraById(fields.cam ?? "");
    const player = await ensurePlayer(PLAYER_ID, PLAYER_NAME);
    if (!camera) {
      context.response.status = 404;
      context.response.body = "No such camera. It was never there.";
      return;
    }
    const region = await getRegion(camera.region);
    const coverage = coverageLevel(await listCameras(), camera.region);

    if (action === "install") {
      const wageMultiplier = region?.economyProfile.wageMultiplier ?? 1;
      const result = installCamera(camera, player, region?.cameraCooldowns, wageMultiplier);
      await saveCamera(result.camera);
      await savePlayer(result.player);
      if (region) await saveRegion({ ...region, cameraCooldowns: result.cooldowns });
    } else {
      const result = dismantleCamera(camera, player, region?.cameraCooldowns, coverage);
      await saveCamera(result.camera);
      await savePlayer(result.player);
      if (region) await saveRegion({ ...region, cameraCooldowns: result.cooldowns });
    }
    context.response.redirect("/");
    return;
  }

  // ── Crafting (spec §3.6.2) ────────────────────────────────────────────
  if (action === "craft") {
    const player = await ensurePlayer(PLAYER_ID, PLAYER_NAME);
    const recipe = (await getRecipes()).find((r) => r.id === fields.recipe);
    if (recipe) {
      const result = craft(player, recipe);
      if (result.crafted) await savePlayer(result.player);
    }
    context.response.redirect("/");
    return;
  }

  // ── Market (spec §3.3) ────────────────────────────────────────────────
  if (action === "sell" || action === "buy" || action === "cancel") {
    const player = await ensurePlayer(PLAYER_ID, PLAYER_NAME);
    if (action === "sell") {
      const item = (await getItems()).find((i) => i.id === fields.item);
      const price = Number(fields.price);
      if (item) {
        const result = createListing(player, item, price);
        if (result.ok) {
          await savePlayer(result.value.seller);
          await saveListing(result.value.listing);
        }
      }
    } else if (action === "buy") {
      const listing = await getListing(fields.lst ?? "");
      if (listing) {
        const seller = await ensurePlayer(listing.sellerId, "Seller");
        const result = buyListing(player, seller, listing);
        if (result.ok) {
          await savePlayer(result.value.buyer);
          await savePlayer(result.value.seller);
          await deleteListing(listing.id);
        }
      }
    } else {
      const listing = await getListing(fields.lst ?? "");
      if (listing) {
        const result = cancelListing(player, listing);
        if (result.ok) {
          await savePlayer(result.value.seller);
          await deleteListing(listing.id);
        }
      }
    }
    context.response.redirect("/");
    return;
  }

  if (action === "log") {
    const player = await ensurePlayer(PLAYER_ID, PLAYER_NAME);
    const entries = visibleQuests(player, await getQuests());
    const items = entries.length
      ? entries
        .map(
          (e) =>
            `<li><strong>${e.quest.title}</strong> [${e.state.status}] — ${
              escapeHtml(objectiveText(e))
            }</li>`,
        )
        .join("\n")
      : `<li>No assignments. You have not asked the right questions yet.</li>`;
    context.response.type = "text/html";
    context.response.body = renderPage({
      title: "Assignments",
      body: `<h2>Your Assignments</h2>
<p>Funds: ${player.currency} credits</p>
<ul class="quest-log">
${items}
</ul>
${postButton("home", "Back to the park")}`,
    });
    return;
  }

  if (action === "talk") {
    const npcId = fields.npc ?? "";
    const npc = await getNpc(npcId);
    if (!npc) {
      context.response.status = 404;
      context.response.body = "Citizen not found.";
      return;
    }

    // Entering a conversation fresh (no option chosen yet).
    if (!fields.node || !fields.option) {
      await respondWithNode(context.response, npc.id, npc.start, null);
      return;
    }

    // Choosing an option within the current node.
    let player = await ensurePlayer(PLAYER_ID, PLAYER_NAME);
    const result = resolveSelection(npc, fields.node, fields.option, player, await getQuests());
    if (!result) {
      context.response.status = 404;
      context.response.body = "That option was never available. Nothing is available.";
      return;
    }

    // Hidden quest reveal (spec §3.1): accept and announce only on selection.
    let reveal: string | null = null;
    if (result.grantedQuest) {
      player = acceptQuest(player, result.grantedQuest);
      const objective = result.grantedQuest.stages[0]?.objective ?? "Await instructions.";
      reveal = renderQuestReveal(result.grantedQuest.title, objective);
    }

    // Stage progression / turn-in for held quests.
    if (result.advancesQuest) {
      const adv = advanceStage(player, result.advancesQuest);
      player = adv.player;
      if (adv.turnedIn) {
        reveal = renderQuestTurnIn(
          result.advancesQuest.title,
          result.advancesQuest.rewards.currency,
        );
      }
    }

    if (result.grantedQuest || result.advancesQuest) await savePlayer(player);

    await respondWithNode(context.response, npcId, result.option.next, {
      speakerArt: npc.art,
      speakerName: npc.name,
      line: result.option.response,
      reveal,
    });
    return;
  }

  context.response.status = 400;
  context.response.body = "Unrecognized action.";
});

// ── Camera helpers ──────────────────────────────────────────────────────────

function getCameraById(id: string) {
  if (!id) return null;
  return getCamera(id);
}

/** The camera surveillance board shown on the park page (spec §3.6). */
async function renderCameraBoard(player: Player): Promise<string> {
  const cameras = await camerasInRegion(player.region);
  const region = await getRegion(player.region);
  const coverage = coverageLevel(await listCameras(), player.region);
  const coveragePct = Math.round(coverage * 100);

  const installWait = Math.ceil(cooldownRemaining(region?.cameraCooldowns, "install") / 1000);
  const dismantleWait = Math.ceil(cooldownRemaining(region?.cameraCooldowns, "dismantle") / 1000);

  const rows = cameras.length
    ? cameras
      .map((cam) => {
        const status = cam.status;
        let action = "";
        if (status === "contracted") {
          action = installWait > 0
            ? `<em>ready in ${installWait}s</em>`
            : `<form method="post" action="/">
  <input type="hidden" name="a" value="install">
  <input type="hidden" name="cam" value="${cam.id}">
  <button type="submit" class="dialogue-option">Install (+${cam.wageValue}cr)</button>
</form>`;
        } else if (status === "active") {
          action = dismantleWait > 0
            ? `<em>ready in ${dismantleWait}s</em>`
            : `<form method="post" action="/">
  <input type="hidden" name="a" value="dismantle">
  <input type="hidden" name="cam" value="${cam.id}">
  <button type="submit" class="dialogue-option">Take down</button>
</form>`;
        } else {
          action = `<em>stripped</em>`;
        }
        return `<li><strong>${cam.id}</strong> [${status}] — ${action}</li>`;
      })
      .join("\n")
    : `<li>No cameras on record. Suspicious.</li>`;

  return `<section class="camera-board">
<h3>Surveillance Ledger — ${region?.name ?? player.region}</h3>
<p>Coverage: ${coveragePct}% · Your suspicion: ${player.suspicion} · Scrap held: ${totalScrap(player)}</p>
<ul class="camera-list">
${rows}
</ul>
</section>`;
}

/** The workbench: craft items from scrap (spec §3.6.2). */
async function renderWorkbench(player: Player): Promise<string> {
  const recipes = await getRecipes();
  const items = await getItems();
  const itemName = new Map(items.map((i) => [i.id, i.name]));

  const scrapLine = (Object.entries(player.scrap) as Array<[string, number]>)
    .filter(([, n]) => n > 0)
    .map(([c, n]) => `${n} ${c}`)
    .join(", ") || "none";

  const rows = recipes
    .map((r) => {
      const name = itemName.get(r.result) ?? r.result;
      const afford = canCraft(player, r);
      const btn = afford
        ? `<form method="post" action="/">
  <input type="hidden" name="a" value="craft">
  <input type="hidden" name="recipe" value="${r.id}">
  <button type="submit" class="dialogue-option">Craft</button>
</form>`
        : `<em>insufficient</em>`;
      return `<li><strong>${name}</strong> — ${describeCost(r)} ${btn}</li>`;
    })
    .join("\n");

  return `<section class="workbench">
<h3>Workbench</h3>
<p>Scrap: ${scrapLine}</p>
<ul class="recipe-list">
${rows}
</ul>
</section>`;
}

/** The player market (spec §3.3). */
async function renderMarket(player: Player): Promise<string> {
  const listings = await listListings();
  const items = await getItems();
  const byId = new Map(items.map((i) => [i.id, i]));

  // Sellable items the player currently holds.
  const held = player.inventory
    .map((id) => byId.get(id))
    .filter((i): i is Item => !!i && i.tradeable);
  const sellRows = held.length
    ? held
      .map(
        (i) => `<li>
<form method="post" action="/">
  <input type="hidden" name="a" value="sell">
  <input type="hidden" name="item" value="${i.id}">
  <input type="number" name="price" min="1" value="10" aria-label="price">
  <button type="submit" class="dialogue-option">Sell ${i.name}</button>
</form>
</li>`,
      )
      .join("\n")
    : `<li>Nothing tradeable in your pack.</li>`;

  const buyRows = listings.length
    ? listings
      .map((l) => {
        const item = byId.get(l.itemId);
        const name = item?.name ?? l.itemId;
        const own = l.sellerId === player.id;
        const action = own
          ? `<form method="post" action="/">
  <input type="hidden" name="a" value="cancel">
  <input type="hidden" name="lst" value="${l.id}">
  <button type="submit" class="link-button">Withdraw</button>
</form>`
          : `<form method="post" action="/">
  <input type="hidden" name="a" value="buy">
  <input type="hidden" name="lst" value="${l.id}">
  <button type="submit" class="dialogue-option">Buy</button>
</form>`;
        return `<li><strong>${name}</strong> — ${l.price}cr ${own ? "(yours) " : ""}${action}</li>`;
      })
      .join("\n")
    : `<li>The board is bare. The Ministry blames supply chains.</li>`;

  return `<section class="market">
<h3>The Market</h3>
<p>Funds: ${player.currency} credits</p>
<h4>Sell from your pack</h4>
<ul class="market-sell">
${sellRows}
</ul>
<h4>Open listings</h4>
<ul class="market-list">
${buyRows}
</ul>
</section>`;
}

/** Travel options to other regions (spec §3.0). */
async function renderTravel(player: Player): Promise<string> {
  const regions = (await getRegionContent()).filter((r) => r.id !== player.region);
  if (regions.length === 0) return "";
  const stamped = hasBureaucratsStamp(player);
  const rows = regions
    .map((r) => {
      const cost = travelCost(r, player);
      const afford = player.currency >= cost;
      const action = afford
        ? `<form method="post" action="/">
  <input type="hidden" name="a" value="travel">
  <input type="hidden" name="region" value="${r.id}">
  <button type="submit" class="link-button">Travel (${cost}cr)</button>
</form>`
        : `<em>${cost}cr — beyond your means</em>`;
      const mood = r.stats.populationMood;
      return `<li><strong>${r.name}</strong> — <em>${mood}</em> ${action}</li>`;
    })
    .join("\n");
  const stampNote = stamped
    ? `<p class="stamp-note">Your Bureaucrat's Stamp expedites all paperwork. Fares halved.</p>`
    : "";
  return `<section class="travel">
<h3>Elsewhere in the Union</h3>
${stampNote}
<ul class="travel-list">
${rows}
</ul>
</section>`;
}

interface ResponseBlock {
  speakerArt: string;
  speakerName: string;
  line: string;
  reveal: string | null;
}

async function respondWithNode(
  response: { type?: string; body: unknown; status?: number },
  npcId: string,
  nextNodeId: string | null,
  block: ResponseBlock | null,
): Promise<void> {
  const npc = await getNpc(npcId);
  if (!npc) {
    response.status = 404;
    response.body = "Citizen not found.";
    return;
  }
  const player = (await getPlayer(PLAYER_ID)) ?? (await ensurePlayer(PLAYER_ID, PLAYER_NAME));

  const parts: string[] = [];
  if (block) {
    const rendered = await renderDialogue(block.line, block.speakerArt);
    parts.push(renderDialogueBlock(rendered, block.speakerName));
    if (block.reveal) parts.push(block.reveal);
  }

  if (nextNodeId === null) {
    parts.push(postButton("home", "Walk away"));
  } else if (nextNodeId === "reset") {
    // Generic reset control: offer to start the conversation over (and a way out).
    parts.push(renderReset(npcId));
    parts.push(postButton("home", "Walk away"));
  } else {
    const node = getNode(npc, nextNodeId);
    if (!node) {
      response.status = 404;
      response.body = "The conversation has been redacted.";
      return;
    }
    const rendered = await renderDialogue(node.line, npc.art);
    parts.push(renderDialogueBlock(rendered, npc.name));
    const options = availableOptions(npc, nextNodeId, player);
    parts.push(renderDialogueOptions(npcId, nextNodeId, options));
  }

  response.type = "text/html";
  response.body = renderPage({ title: npc.name, body: parts.join("\n") });
}
