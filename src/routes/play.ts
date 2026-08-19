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
import { deleteListing, getListing, getPriceHistory, listListings, recordSale, saveListing } from "../state/market.ts";
import { activeDecrees } from "../state/decrees.ts";
import { clearEncounter, getEncounter, saveEncounter } from "../state/encounters.ts";
import {
  cooldownRemaining,
  coverageLevel,
  dismantleCamera,
  installCamera,
  totalScrap,
} from "../game/cameras.ts";
import { canAffordCraft, CRAFT_FEE, craft, describeCost } from "../game/crafting.ts";
import { buyListing, cancelListing, createListing, purchasePrice, summarizePrices } from "../game/market.ts";
import { performEspionage, isRestricted } from "../game/espionage.ts";
import { applyMove, rollEncounter, startEncounter } from "../game/encounters.ts";
import { travel, travelCost, hasBureaucratsStamp } from "../game/travel.ts";
import { getEncounters, getItems, getQuests, getRecipes, getRegionContent } from "../content/index.ts";
import type { EspionageActionType, Item, Player } from "../types.ts";

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
  const decrees = await renderDecrees(player);
  const espionage = await renderEspionage(player);
  const encounter = await renderEncounterBoard(player);

  context.response.type = "text/html";
  context.response.body = renderPage({
    title: "FlockWatch",
    body: `<h2>${region?.name ?? player.region}</h2>
<p>The pigeons are watching. Choose someone to talk to.</p>
<ul class="npc-list">
${items}
</ul>
${encounter}
${cameraBoard}
${workbench}
${market}
${espionage}
${decrees}
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
    const decrees = await activeDecrees(player.region);
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
      const listing = await getListing(player.region, fields.lst ?? "");
      if (listing) {
        const seller = await ensurePlayer(listing.sellerId, "Seller");
        const result = buyListing(player, seller, listing, decrees);
        if (result.ok) {
          await savePlayer(result.value.buyer);
          await savePlayer(result.value.seller);
          await deleteListing(listing.regionId, listing.id);
          await recordSale({ ...listing, price: result.value.paid });
        }
      }
    } else {
      const listing = await getListing(player.region, fields.lst ?? "");
      if (listing) {
        const result = cancelListing(player, listing);
        if (result.ok) {
          await savePlayer(result.value.seller);
          await deleteListing(listing.regionId, listing.id);
        }
      }
    }
    context.response.redirect("/");
    return;
  }

  // ── Espionage (spec §3.5) ─────────────────────────────────────────────
  if (action === "espionage") {
    let player = await ensurePlayer(PLAYER_ID, PLAYER_NAME);
    const region = await getRegion(player.region);
    const espAction = fields.op as EspionageActionType;
    if (region && ["tail", "intercept", "gather_intel"].includes(espAction)) {
      const outcome = performEspionage(espAction, player, region, Math.random());
      if (outcome.ok) {
        player = outcome.player;
        await savePlayer(player);
        context.response.type = "text/html";
        context.response.body = renderPage({
          title: "Fieldwork",
          body: `<h2>Fieldwork</h2>
<p>${escapeHtml(outcome.narrative)}</p>
${outcome.success ? `<p>Intel in ${escapeHtml(region.name)}: ${player.intel[region.id] ?? 0}${outcome.payout > 0 ? ` · Skimmed ${outcome.payout}cr` : ""}</p>` : ""}
${outcome.flag ? `<p class="flag-note">You have been flagged: ${escapeHtml(outcome.flag.reason)}. Market fees apply.</p>` : ""}
${postButton("home", "Melt into the crowd")}`,
        });
        return;
      }
    }
    context.response.redirect("/");
    return;
  }

  // ── Encounters (spec §3.4) ────────────────────────────────────────────
  if (action === "encounter_start") {
    const player = await ensurePlayer(PLAYER_ID, PLAYER_NAME);
    const region = await getRegion(player.region);
    if (region && !(await getEncounter(player.id))) {
      const rolled = rollEncounter(await getEncounters(), region, player, Math.random());
      if (rolled) await saveEncounter(startEncounter(rolled, player));
    }
    context.response.redirect("/");
    return;
  }

  if (action === "boss_start") {
    const player = await ensurePlayer(PLAYER_ID, PLAYER_NAME);
    if (!(await getEncounter(player.id))) {
      const boss = (await getEncounters()).find((e) => e.id === fields.enc && e.kind === "boss");
      if (boss) await saveEncounter(startEncounter(boss, player));
    }
    context.response.redirect("/");
    return;
  }

  if (action === "move") {
    let player = await ensurePlayer(PLAYER_ID, PLAYER_NAME);
    const state = await getEncounter(player.id);
    const encounter = (await getEncounters()).find((e) => e.id === state?.encounterId);
    if (state && encounter) {
      const turn = applyMove(encounter, state, player, fields.move ?? "");
      if (turn) {
        player = turn.player;
        await savePlayer(player);
        if (turn.state.status === "ongoing") {
          await saveEncounter(turn.state);
        } else {
          await clearEncounter(player.id);
        }
        context.response.type = "text/html";
        context.response.body = renderPage({
          title: encounter.name,
          body: `<h2>${escapeHtml(encounter.name)}</h2>
<ul class="encounter-log">
${turn.state.log.map((l) => `<li>${escapeHtml(l)}</li>`).join("\n")}
</ul>
${turn.state.status === "ongoing" ? `<p>Composure holds. The exchange continues.</p>` : ""}
${postButton("home", "Continue")}`,
        });
        return;
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
      const afford = canAffordCraft(player, r);
      const btn = afford
        ? `<form method="post" action="/">
  <input type="hidden" name="a" value="craft">
  <input type="hidden" name="recipe" value="${r.id}">
  <button type="submit" class="dialogue-option">Craft</button>
</form>`
        : `<em>insufficient</em>`;
      return `<li><strong>${name}</strong> — ${describeCost(r)} · ${CRAFT_FEE}cr license ${btn}</li>`;
    })
    .join("\n");

  return `<section class="workbench">
<h3>Workbench</h3>
<p>Scrap: ${scrapLine}</p>
<p class="fee-note">The Bureau of Workmanship levies a ${CRAFT_FEE}cr licensing fee per craft.</p>
<ul class="recipe-list">
${rows}
</ul>
</section>`;
}

/** The player market (spec §3.3) — regional board with decree-adjusted prices. */
async function renderMarket(player: Player): Promise<string> {
  const listings = await listListings(player.region);
  const items = await getItems();
  const byId = new Map(items.map((i) => [i.id, i]));
  const decrees = await activeDecrees(player.region);

  // Per-item price history summaries for everything currently on the board.
  const history = new Map<string, string>();
  const historyItemIds = [...new Set(listings.map((l) => l.itemId))];
  for (const itemId of historyItemIds) {
    const summary = summarizePrices(await getPriceHistory(itemId));
    if (summary) {
      history.set(
        itemId,
        ` <em class="price-history">last ${summary.last}cr · avg ${summary.average}cr · ${summary.min}–${summary.max}cr over ${summary.sales} sale${summary.sales === 1 ? "" : "s"}</em>`,
      );
    }
  }

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
        const price = purchasePrice(l, player, decrees);
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
        const adjusted = price !== l.price ? ` <em>(decree-adjusted from ${l.price}cr)</em>` : "";
        return `<li><strong>${name}</strong> — ${price}cr ${own ? "(yours) " : ""}${action}${adjusted}${history.get(l.itemId) ?? ""}</li>`;
      })
      .join("\n")
    : `<li>The board is bare. The Ministry blames supply chains.</li>`;

  const region = await getRegion(player.region);
  return `<section class="market">
<h3>The Market — ${escapeHtml(region?.name ?? player.region)}</h3>
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

/** Espionage fieldwork board (spec §3.5). */
async function renderEspionage(player: Player): Promise<string> {
  const region = await getRegion(player.region);
  if (!region) return "";
  if (isRestricted(player, region.id)) {
    return `<section class="espionage">
<h3>Fieldwork</h3>
<p>The checkpoints here have your photograph. ${escapeHtml(region.name)} is closed to you.</p>
</section>`;
  }
  const intel = player.intel[region.id] ?? 0;
  const flags = player.flags.length;
  const ops: Array<[EspionageActionType, string]> = [
    ["tail", "Tail a courier"],
    ["intercept", "Intercept a relay"],
    ["gather_intel", "Gather intel"],
  ];
  const rows = ops
    .map(
      ([op, label]) => `<li>
<form method="post" action="/">
  <input type="hidden" name="a" value="espionage">
  <input type="hidden" name="op" value="${op}">
  <button type="submit" class="dialogue-option">${label}</button>
</form>
</li>`,
    )
    .join("\n");
  return `<section class="espionage">
<h3>Fieldwork</h3>
<p>Intel here: ${intel} · Flags on your file: ${flags}${flags > 0 ? " (market fees apply)" : ""}</p>
<ul class="espionage-list">
${rows}
</ul>
</section>`;
}

/** Ministry of Valuation decrees in force here (spec §3.3 live-ops). */
async function renderDecrees(player: Player): Promise<string> {
  const decrees = await activeDecrees(player.region);
  if (decrees.length === 0) return "";
  const rows = decrees
    .map(
      (d) => `<li><strong>${escapeHtml(d.title)}</strong> — ${escapeHtml(d.proclamation)} <em>(prices ×${d.priceMultiplier})</em></li>`,
    )
    .join("\n");
  return `<section class="decrees">
<h3>Ministry of Valuation — Decrees in Force</h3>
<ul class="decree-list">
${rows}
</ul>
</section>`;
}

/** Active encounter, or the means to provoke one (spec §3.4). */
async function renderEncounterBoard(player: Player): Promise<string> {
  const state = await getEncounter(player.id);
  if (state) {
    const encounter = (await getEncounters()).find((e) => e.id === state.encounterId);
    if (!encounter) return "";
    const moves = encounter.moves
      .map(
        (m) => `<li>
<form method="post" action="/">
  <input type="hidden" name="a" value="move">
  <input type="hidden" name="move" value="${m.id}">
  <button type="submit" class="dialogue-option">${escapeHtml(m.label)}${m.cost ? ` (${m.cost}cr)` : ""}</button>
</form>
</li>`,
      )
      .join("\n");
    const log = state.log.slice(-6).map((l) => `<li>${escapeHtml(l)}</li>`).join("\n");
    return `<section class="encounter">
<h3>⚠ ${escapeHtml(encounter.name)} — ${state.enemyHp}/${encounter.maxHp} hp</h3>
<ul class="encounter-log">
${log}
</ul>
<ul class="encounter-moves">
${moves}
</ul>
</section>`;
  }
  const bosses = (await getEncounters()).filter(
    (e) => e.kind === "boss" && e.regions.includes(player.region) && !player.restricted.includes(player.region),
  );
  const bossRows = bosses
    .map(
      (b) => `<li>
<form method="post" action="/">
  <input type="hidden" name="a" value="boss_start">
  <input type="hidden" name="enc" value="${b.id}">
  <button type="submit" class="dialogue-option">Confront ${escapeHtml(b.name)}</button> <em>(boss — solo attempts are unwise)</em>
</form>
</li>`,
    )
    .join("\n");
  return `<section class="encounter-board">
<h3>Trouble</h3>
<form method="post" action="/">
  <input type="hidden" name="a" value="encounter_start">
  <button type="submit" class="link-button">Walk the perimeter (risk a patrol)</button>
</form>
${bossRows ? `<ul class="boss-list">\n${bossRows}\n</ul>` : ""}
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
