/**
 * Play routes (design: "one door"). The whole game is played at the root URL —
 * GET / shows the park, POST / carries every action via hidden form fields so
 * no game state is ever visible in the address bar (spec §3.1: quests stay
 * hidden, routes stay unremarkable).
 *
 * Phase 6 resolves every action through a persistent character session.
 */
import { Router } from "oak";
import {
  acceptQuest,
  availableOptions,
  getNode,
  resolveSelection,
} from "../game/dialogue.ts";
import { advanceStage, objectiveText, visibleQuests } from "../game/quests.ts";
import { loadArt, renderDialogue } from "../render/grillsay.ts";
import {
  renderDialogueBlock,
  renderDialogueOptions,
  renderPage,
  renderQuestReveal,
  renderQuestTurnIn,
  renderReset,
} from "../render/views.ts";
import { getNpc } from "../state/content.ts";
import {
  ensurePlayer,
  getPlayer,
  listPlayersAtLocation,
  savePlayer,
  touchPlayer,
} from "../state/players.ts";
import {
  camerasInRegion,
  getCamera,
  listCameras,
  saveCamera,
} from "../state/cameras.ts";
import { getRegion, saveRegion } from "../state/regions.ts";
import {
  deleteListing,
  getListing,
  getPriceHistory,
  listListings,
  recordSale,
  saveListing,
} from "../state/market.ts";
import { activeDecrees } from "../state/decrees.ts";
import {
  clearEncounter,
  getEncounter,
  saveEncounter,
} from "../state/encounters.ts";
import {
  cooldownRemaining,
  coverageLevel,
  dismantleCamera,
  installCamera,
  totalScrap,
} from "../game/cameras.ts";
import {
  canAffordCraft,
  craft,
  craftingFee,
  describeCost,
} from "../game/crafting.ts";
import { formatMaterials } from "../game/materials.ts";
import {
  buyListing,
  cancelListing,
  createListing,
  purchasePrice,
  summarizePrices,
} from "../game/market.ts";
import { isRestricted, performEspionage } from "../game/espionage.ts";
import {
  applyMove,
  PLAYER_HP,
  playerHp,
  REST_COST,
  restAtHotel,
  rollEncounter,
  startEncounter,
} from "../game/encounters.ts";
import { hasBureaucratsStamp, travel, travelCost } from "../game/travel.ts";
import {
  performLocationAction,
  travelWithinRegion,
} from "../game/locations.ts";
import {
  getEncounters,
  getItems,
  getLocation,
  getLocations,
  getQuests,
  getRecipes,
  getRegionContent,
} from "../content/index.ts";
import {
  listMessagePosts,
  MAX_MESSAGE_LENGTH,
  normalizeMessageBody,
  saveMessagePost,
} from "../state/message-board.ts";
import { moderateMessagePost } from "../state/message-moderation.ts";
import { claimActionRequest } from "../state/action-requests.ts";
import {
  createCharacterAccount,
  deleteSession,
  expiredSessionCookie,
  getPlayerForSession,
  logIn,
  MAX_CHARACTER_NAME_LENGTH,
  MIN_PASSWORD_LENGTH,
  requestPasswordReset,
  resetPassword,
  sessionCookie,
  sessionTokenFromCookie,
  signUp,
} from "../state/accounts.ts";
import {
  acceptCellInvite,
  createCell,
  declineCellInvite,
  getCell,
  getCellForPlayer,
  inviteToCell,
  leaveCell,
  listCellInvites,
} from "../state/cells.ts";
import {
  setTrust,
  shareIntel,
  shareItem,
  shareQuest,
} from "../game/multiplayer.ts";
import {
  applyCellMove,
  rewardCellParticipant,
  startCellEncounter,
} from "../game/cell-encounters.ts";
import {
  clearCellEncounter,
  getCellEncounter,
  saveCellEncounter,
} from "../state/cell-encounters.ts";
import {
  advanceCellOperation,
  CELL_OPERATION_STAGES,
  rewardCellOperation,
  startCellOperation,
} from "../game/cell-operations.ts";
import {
  clearCellOperation,
  getCellOperation,
  saveCellOperation,
} from "../state/cell-operations.ts";
import {
  regionEvents,
  type RegionEventType,
} from "../realtime/region-events.ts";
import type {
  EspionageActionType,
  Item,
  LocationInteraction,
  MessagePost,
  Player,
  Sublocation,
} from "../types.ts";

export const playRouter = new Router();

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(
    ">",
    "&gt;",
  ).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function publishRegion(
  type: RegionEventType,
  player: Player,
  data?: Record<string, string | number | boolean | null>,
): void {
  regionEvents.publish({
    type,
    region: player.region,
    actorId: player.id,
    location: player.location,
    data,
  });
}

/** Small helper: a POST button back to the root URL. */
function postButton(action: string, label: string, extra = ""): string {
  return `<form method="post" action="/">
  <input type="hidden" name="a" value="${action}">
${extra}
  <button type="submit" class="link-button">${label}</button>
</form>`;
}

function authenticatedPlayer(headers: Headers): Promise<Player | null> {
  const token = sessionTokenFromCookie(headers.get("cookie"));
  return token ? getPlayerForSession(token) : Promise.resolve(null);
}

function renderAccountGate(
  error: string | null = null,
  view: "login" | "signup" | "forgot" = "login",
  notice: string | null = null,
): string {
  const messages = `${
    error ? `<p class="flag-note">${escapeHtml(error)}</p>` : ""
  }${notice ? `<p>${escapeHtml(notice)}</p>` : ""}`;
  const forms: Record<string, string> = {
    login: `<form method="post" action="/">
  <input type="hidden" name="a" value="login">
  <label for="login-email">Email</label>
  <input id="login-email" name="email" type="email" required autocomplete="email">
  <label for="login-password">Password</label>
  <input id="login-password" name="password" type="password" required autocomplete="current-password">
  <button type="submit" class="dialogue-option">Sign In</button>
</form>
<p><a href="/?gate=signup">File a new citizen</a> · <a href="/?gate=forgot">Lost your password?</a></p>`,
    signup: `<form method="post" action="/">
  <input type="hidden" name="a" value="signup">
  <label for="signup-email">Email</label>
  <input id="signup-email" name="email" type="email" required autocomplete="email">
  <label for="signup-password">Password</label>
  <input id="signup-password" name="password" type="password" minlength="${MIN_PASSWORD_LENGTH}" required autocomplete="new-password">
  <label for="character-name">Character name</label>
  <input id="character-name" name="name" minlength="2" maxlength="${MAX_CHARACTER_NAME_LENGTH}" required autocomplete="nickname">
  <button type="submit" class="dialogue-option">File Character</button>
</form>
<p><a href="/">Already on file? Sign in</a></p>`,
    forgot: `<form method="post" action="/">
  <input type="hidden" name="a" value="forgot_password">
  <label for="forgot-email">Email</label>
  <input id="forgot-email" name="email" type="email" required autocomplete="email">
  <button type="submit" class="dialogue-option">Request Reset</button>
</form>
<p><a href="/">Back to sign in</a></p>`,
  };
  return renderPage({
    title: "Citizen Intake",
    body: `<section class="account-gate">
<h2>Citizen Intake</h2>
<p>The Agencies require a registered account before permitting access to the park.</p>
${messages}
${forms[view]}
</section>`,
  });
}

function renderResetForm(token: string, error: string | null = null): string {
  return renderPage({
    title: "Password Reset",
    body: `<section class="account-gate">
<h2>Password Reset</h2>
${error ? `<p class="flag-note">${escapeHtml(error)}</p>` : ""}
<form method="post" action="/">
  <input type="hidden" name="a" value="reset_password">
  <input type="hidden" name="token" value="${escapeHtml(token)}">
  <label for="reset-password">New password</label>
  <input id="reset-password" name="password" type="password" minlength="${MIN_PASSWORD_LENGTH}" required autocomplete="new-password">
  <button type="submit" class="dialogue-option">Set Password</button>
</form>
</section>`,
  });
}

/**
 * Landing page for Supabase recovery links. GoTrue appends the access token
 * in the URL hash (#access_token=...&type=recovery), which never reaches the
 * server — this script lifts it into a form field and swaps the form in.
 */
function renderRecoveryLanding(): string {
  return renderPage({
    title: "Password Reset",
    body: `<section class="account-gate">
<h2>Password Reset</h2>
<p id="recovery-status">Validating your reset link…</p>
<form method="post" action="/" id="recovery-form" hidden>
  <input type="hidden" name="a" value="reset_password">
  <input type="hidden" name="token" id="recovery-token">
  <label for="reset-password">New password</label>
  <input id="reset-password" name="password" type="password" minlength="${MIN_PASSWORD_LENGTH}" required autocomplete="new-password">
  <button type="submit" class="dialogue-option">Set Password</button>
</form>
</section>
<script>
(function () {
  var params = new URLSearchParams(location.hash.slice(1));
  var token = params.get("access_token");
  var status = document.getElementById("recovery-status");
  if (token && params.get("type") === "recovery") {
    document.getElementById("recovery-token").value = token;
    document.getElementById("recovery-form").hidden = false;
    status.textContent = "Enter a new password.";
    history.replaceState(null, "", "/?reset_token=pending");
  } else {
    status.textContent = "That reset link is invalid or expired.";
  }
})();
</script>`,
  });
}

function respondWithNotice(
  response: { type?: string; body: unknown; status?: number },
  title: string,
  message: string,
  ok: boolean,
): void {
  response.type = "text/html";
  if (!ok) response.status = 400;
  response.body = renderPage({
    title,
    body: `<section class="action-notice">
<h2>${escapeHtml(title)}</h2>
<p${ok ? "" : ` class="flag-note"`}>${escapeHtml(message)}</p>
${postButton("home", "Return")}
</section>`,
  });
}

// ── GET / — the park. The only address the player ever sees. ────────────────
playRouter.get("/", async (context) => {
  const authenticated = await authenticatedPlayer(context.request.headers);
  if (!authenticated) {
    const params = context.request.url.searchParams;
    const resetToken = params.get("reset_token");
    const gate = params.get("gate");
    context.response.type = "text/html";
    if (resetToken !== null) {
      context.response.body = renderRecoveryLanding();
    } else {
      context.response.body = renderAccountGate(
        null,
        gate === "signup" || gate === "forgot" ? gate : "login",
      );
    }
    return;
  }
  let player = await touchPlayer(authenticated);
  const region = await getRegion(player.region);
  if (!region) {
    context.response.status = 500;
    context.response.body = "Your city has been administratively misplaced.";
    return;
  }
  const locationResult = await resolveCurrentLocation(player, region.locations);
  player = locationResult.player;
  const location = locationResult.location;
  if (!location) {
    context.response.status = 500;
    context.response.body = "This city contains no approved places.";
    return;
  }

  const localTravel = await renderLocalTravel(player, location);
  const interactions = renderLocationInteractions(location);
  const travelBoard = await renderTravel(player);
  const decrees = await renderDecrees(player);
  const encounter = await renderEncounterBoard(player);
  const multiplayer = await renderMultiplayer(player);

  context.response.type = "text/html";
  context.response.body = renderPage({
    title: "FlockWatch",
    locationName: location.name,
    body: `<div class="character-bar" data-player-id="${
      escapeHtml(player.id)
    }" data-region="${escapeHtml(player.region)}"><strong>${
      escapeHtml(player.name)
    }</strong> · ${player.currency}cr · hp ${
      playerHp(player)
    }/${PLAYER_HP} · suspicion ${player.suspicion}${
      postButton("logout", "End Session")
    }</div>
<p class="eyebrow">${escapeHtml(region.name)}</p>
<h2>${escapeHtml(location.name)}</h2>
<p>${escapeHtml(location.description)}</p>
${encounter}
${multiplayer}
${interactions}
${localTravel}
${decrees}
${travelBoard}
<div class="action-row">
${postButton("log", "Review your assignments")}
${postButton("inventory", "Inventory")}
${
      playerHp(player) < PLAYER_HP
        ? postButton("rest", `Stay at a hotel (${REST_COST}cr)`)
        : ""
    }
</div>`,
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

  if (action === "signup" || action === "create_account") {
    const result = action === "signup"
      ? await signUp(
        fields.email ?? "",
        fields.password ?? "",
        fields.name ?? "",
      )
      : await createCharacterAccount(fields.name ?? "");
    context.response.type = "text/html";
    if (!result.ok || !result.session) {
      context.response.status = 400;
      context.response.body = renderAccountGate(
        result.reason,
        action === "signup" ? "signup" : "login",
      );
      return;
    }
    context.response.headers.append(
      "set-cookie",
      sessionCookie(result.session.token),
    );
    if (result.player) {
      publishRegion("presence.changed", result.player, {
        name: result.player.name,
        status: "joined",
      });
    }
    context.response.redirect("/");
    return;
  }

  if (action === "login") {
    const result = await logIn(fields.email ?? "", fields.password ?? "");
    context.response.type = "text/html";
    if (!result.ok || !result.session) {
      context.response.status = 400;
      context.response.body = renderAccountGate(result.reason, "login");
      return;
    }
    context.response.headers.append(
      "set-cookie",
      sessionCookie(result.session.token),
    );
    if (result.player) {
      publishRegion("presence.changed", result.player, {
        name: result.player.name,
        status: "joined",
      });
    }
    context.response.redirect("/");
    return;
  }

  if (action === "forgot_password") {
    await requestPasswordReset(fields.email ?? "");
    context.response.type = "text/html";
    // Same response whether or not the email exists, to avoid enumeration.
    context.response.body = renderAccountGate(
      null,
      "forgot",
      "If that address is registered, a reset link is on its way.",
    );
    return;
  }

  if (action === "reset_password") {
    const result = await resetPassword(
      fields.token ?? "",
      fields.password ?? "",
    );
    context.response.type = "text/html";
    if (!result.ok) {
      context.response.status = 400;
      context.response.body = renderResetForm(
        fields.token ?? "",
        result.reason,
      );
      return;
    }
    context.response.body = renderAccountGate(
      null,
      "login",
      "Password updated. Sign in with your new password.",
    );
    return;
  }

  const sessionToken = sessionTokenFromCookie(
    context.request.headers.get("cookie"),
  );
  if (action === "logout") {
    await deleteSession(sessionToken ?? "");
    context.response.headers.append("set-cookie", expiredSessionCookie());
    context.response.redirect("/");
    return;
  }

  const sessionPlayer = sessionToken
    ? await getPlayerForSession(sessionToken)
    : null;
  if (!sessionPlayer) {
    context.response.status = 401;
    context.response.type = "text/html";
    context.response.body = renderAccountGate(
      "Your session is absent or expired.",
    );
    return;
  }
  const authenticated = await touchPlayer(sessionPlayer);

  if (!(await claimActionRequest(authenticated.id, fields.request_id))) {
    context.response.status = 303;
    context.response.redirect("/");
    return;
  }

  if (action === "home") {
    context.response.redirect("/");
    return;
  }

  // ── Multiplayer identity, cells, and trust (spec §3.5) ──────────────
  if (action === "create_cell") {
    const result = await createCell(authenticated.id, fields.name ?? "");
    if (result.ok) publishRegion("social.changed", authenticated, { action });
    respondWithNotice(
      context.response,
      result.ok ? "Cell Filed" : "Cell Rejected",
      result.reason ??
        `${result.cell?.name ?? "The cell"} now exists in the record.`,
      result.ok,
    );
    return;
  }

  if (action === "invite_to_cell") {
    const nearby = await listPlayersAtLocation(
      authenticated.region,
      authenticated.location,
    );
    const target = nearby.find((player) =>
      player.id === fields.player && player.id !== authenticated.id
    );
    const result = target ? await inviteToCell(authenticated.id, target.id) : {
      ok: false,
      reason: "That citizen is not currently here.",
      cell: null,
      invite: null,
    };
    if (result.ok) publishRegion("social.changed", authenticated, { action });
    respondWithNotice(
      context.response,
      result.ok ? "Invitation Filed" : "Invitation Rejected",
      result.reason ??
        `${target?.name ?? "The citizen"} may now accept your cell invitation.`,
      result.ok,
    );
    return;
  }

  if (action === "accept_cell_invite") {
    const result = await acceptCellInvite(
      authenticated.id,
      fields.invite ?? "",
    );
    if (result.ok) publishRegion("social.changed", authenticated, { action });
    respondWithNotice(
      context.response,
      result.ok ? "Cell Joined" : "Invitation Rejected",
      result.reason ??
        `You are now a member of ${result.cell?.name ?? "the cell"}.`,
      result.ok,
    );
    return;
  }

  if (action === "decline_cell_invite") {
    const declined = await declineCellInvite(
      authenticated.id,
      fields.invite ?? "",
    );
    if (declined) publishRegion("social.changed", authenticated, { action });
    respondWithNotice(
      context.response,
      declined ? "Invitation Declined" : "Invitation Missing",
      declined
        ? "The invitation has been removed from your file."
        : "That invitation is no longer on file.",
      declined,
    );
    return;
  }

  if (action === "leave_cell") {
    const currentCell = await getCellForPlayer(authenticated.id);
    const encounter = currentCell
      ? await getCellEncounter(currentCell.id)
      : null;
    const fieldOperation = currentCell
      ? await getCellOperation(currentCell.id)
      : null;
    const committed = (encounter?.status === "ongoing" &&
      encounter.participantIds.includes(authenticated.id)) ||
      (fieldOperation?.status === "ongoing" &&
        fieldOperation.participantIds.includes(authenticated.id));
    const result = committed
      ? {
        ok: false,
        reason: "You cannot leave a cell during an active operation.",
        cell: currentCell,
      }
      : await leaveCell(authenticated.id);
    if (result.ok) publishRegion("social.changed", authenticated, { action });
    respondWithNotice(
      context.response,
      result.ok ? "Cell Departed" : "Departure Rejected",
      result.reason ??
        "Your membership has been removed from the active roster.",
      result.ok,
    );
    return;
  }

  if (action === "trust_player" || action === "revoke_trust") {
    const nearby = await listPlayersAtLocation(
      authenticated.region,
      authenticated.location,
    );
    const target = nearby.find((player) =>
      player.id === fields.player && player.id !== authenticated.id
    );
    if (!target) {
      respondWithNotice(
        context.response,
        "Trust Rejected",
        "That citizen is not currently here.",
        false,
      );
      return;
    }
    const updated = setTrust(
      authenticated,
      target.id,
      action === "trust_player",
    );
    await savePlayer(updated);
    publishRegion("social.changed", updated, { action });
    respondWithNotice(
      context.response,
      "Trust Updated",
      action === "trust_player"
        ? `${target.name} may now receive items and local intelligence from you.`
        : `${target.name} has been removed from your sharing list.`,
      true,
    );
    return;
  }

  if (action === "share_item" || action === "share_intel") {
    const sender = await ensurePlayer(authenticated.id, authenticated.name);
    const activeHere = await listPlayersAtLocation(
      sender.region,
      sender.location,
    );
    const recipient = activeHere.find((candidate) =>
      candidate.id === fields.player
    ) ?? null;
    if (!recipient) {
      respondWithNotice(
        context.response,
        "Transfer Rejected",
        "That citizen is not on file.",
        false,
      );
      return;
    }
    const result = action === "share_item"
      ? shareItem(sender, recipient, fields.item ?? "")
      : shareIntel(sender, recipient);
    if (result.ok) {
      await savePlayer(result.sender);
      await savePlayer(result.recipient);
      publishRegion("social.changed", result.sender, {
        action,
        recipientId: result.recipient.id,
      });
    }
    respondWithNotice(
      context.response,
      result.ok ? "Transfer Filed" : "Transfer Rejected",
      result.reason ??
        (action === "share_item"
          ? `${recipient.name} received the item.`
          : `${recipient.name} received your local dossier.`),
      result.ok,
    );
    return;
  }

  if (action === "share_quest") {
    const sender = await ensurePlayer(authenticated.id, authenticated.name);
    const cell = await getCellForPlayer(sender.id);
    const nearby = await listPlayersAtLocation(sender.region, sender.location);
    const recipients = cell
      ? nearby.filter((candidate) =>
        candidate.id !== sender.id && cell.memberIds.includes(candidate.id)
      )
      : [];
    let shared = 0;
    for (const recipient of recipients) {
      const result = shareQuest(sender, recipient, fields.quest ?? "");
      if (result.ok) {
        await savePlayer(result.recipient);
        shared += 1;
      }
    }
    respondWithNotice(
      context.response,
      shared > 0 ? "Assignment Shared" : "Sharing Rejected",
      shared > 0
        ? `The assignment was added to ${shared} nearby cell member${
          shared === 1 ? "" : "s"
        }.`
        : "No nearby cell member is eligible to receive that active assignment.",
      shared > 0,
    );
    if (shared > 0) {
      publishRegion("social.changed", sender, { action, recipients: shared });
    }
    return;
  }

  if (action === "cell_operation_start") {
    const player = await ensurePlayer(authenticated.id, authenticated.name);
    const cell = await getCellForPlayer(player.id);
    const location = await getLocation(player.location);
    const exposesEspionage = location?.interactions.some((interaction) =>
      interaction.kind === "espionage"
    );
    const nearby = await listPlayersAtLocation(player.region, player.location);
    const participants = cell
      ? nearby.filter((candidate) =>
        cell.memberIds.includes(candidate.id) &&
        !isRestricted(candidate, player.region)
      )
      : [];
    const existing = cell ? await getCellOperation(cell.id) : null;
    const boss = cell ? await getCellEncounter(cell.id) : null;
    const state = cell && exposesEspionage &&
        existing?.status !== "ongoing" && boss?.status !== "ongoing"
      ? startCellOperation(cell, participants)
      : null;
    if (state) {
      await saveCellOperation(state);
      publishRegion("cell.operation", player, {
        action: "started",
        cellId: cell!.id,
      });
    }
    respondWithNotice(
      context.response,
      state ? "Operation Opened" : "Operation Rejected",
      state
        ? `${participants.length} cell members begin coordinated fieldwork.`
        : "A field operation requires at least two unrestricted, active cell members at this location.",
      !!state,
    );
    return;
  }

  if (action === "cell_operation_advance") {
    const player = await ensurePlayer(authenticated.id, authenticated.name);
    const cell = await getCellForPlayer(player.id);
    const state = cell ? await getCellOperation(cell.id) : null;
    const op = fields.op as EspionageActionType;
    const turn = state && ["tail", "intercept", "gather_intel"].includes(op)
      ? advanceCellOperation(state, player, op)
      : null;
    if (!turn || !cell) {
      respondWithNotice(
        context.response,
        "Operation Rejected",
        "No active cell operation accepts that contribution.",
        false,
      );
      return;
    }
    if (turn.reason) {
      respondWithNotice(
        context.response,
        "Operation Paused",
        turn.reason,
        false,
      );
      return;
    }
    await saveCellOperation(turn.state);
    await savePlayer(turn.actor);
    if (turn.completed) {
      for (const participantId of turn.state.participantIds) {
        const participant = participantId === turn.actor.id
          ? turn.actor
          : await getPlayer(participantId);
        if (participant) {
          await savePlayer(rewardCellOperation(participant, turn.state.region));
        }
      }
    }
    publishRegion("cell.operation", turn.actor, {
      action: turn.completed ? "completed" : "advanced",
      stage: turn.state.stageIndex,
    });
    context.response.redirect("/");
    return;
  }

  if (action === "clear_cell_operation") {
    const cell = await getCellForPlayer(authenticated.id);
    const state = cell ? await getCellOperation(cell.id) : null;
    if (cell && state?.status === "completed") {
      await clearCellOperation(cell.id);
      publishRegion("cell.operation", authenticated, { action: "cleared" });
    }
    context.response.redirect("/");
    return;
  }

  if (action === "cell_boss_start") {
    const player = await ensurePlayer(authenticated.id, authenticated.name);
    const cell = await getCellForPlayer(player.id);
    const location = await getLocation(player.location);
    const exposesEncounter = location?.interactions.some((interaction) =>
      interaction.kind === "encounter"
    );
    const boss = (await getEncounters()).find((encounter) =>
      encounter.id === fields.enc && encounter.kind === "boss" &&
      encounter.regions.includes(player.region)
    );
    const nearby = await listPlayersAtLocation(player.region, player.location);
    const participants = cell
      ? nearby.filter((candidate) => cell.memberIds.includes(candidate.id))
      : [];
    const existing = cell ? await getCellEncounter(cell.id) : null;
    const fieldOperation = cell ? await getCellOperation(cell.id) : null;
    const state =
      cell && boss && exposesEncounter && existing?.status !== "ongoing" &&
        fieldOperation?.status !== "ongoing"
        ? startCellEncounter(boss, cell, participants)
        : null;
    if (state) {
      await saveCellEncounter(state);
      publishRegion("cell.encounter", player, {
        action: "started",
        encounterId: state.encounterId,
      });
    }
    respondWithNotice(
      context.response,
      state ? "Cell Mobilized" : "Mobilization Rejected",
      state
        ? `${participants.length} cell members confront ${boss?.name}.`
        : "A cell boss operation requires at least two active cell members at this encounter location.",
      !!state,
    );
    return;
  }

  if (action === "cell_move") {
    const player = await ensurePlayer(authenticated.id, authenticated.name);
    const cell = await getCellForPlayer(player.id);
    const state = cell ? await getCellEncounter(cell.id) : null;
    const encounter = (await getEncounters()).find((candidate) =>
      candidate.id === state?.encounterId
    );
    const turn = state && encounter
      ? applyCellMove(encounter, state, player, fields.move ?? "")
      : null;
    if (!turn || !cell || !encounter) {
      respondWithNotice(
        context.response,
        "Move Rejected",
        "No active cell encounter accepts that move.",
        false,
      );
      return;
    }
    await saveCellEncounter(turn.state);
    if (turn.victory) {
      for (const participantId of turn.state.participantIds) {
        const participant = participantId === turn.actor.id
          ? turn.actor
          : await getPlayer(participantId);
        if (participant) {
          await savePlayer(rewardCellParticipant(participant, encounter));
        }
      }
    } else {
      await savePlayer(turn.actor);
    }
    publishRegion("cell.encounter", turn.actor, {
      action: turn.state.status,
      enemyHp: turn.state.enemyHp,
    });
    context.response.redirect("/");
    return;
  }

  if (action === "clear_cell_encounter") {
    const cell = await getCellForPlayer(authenticated.id);
    const state = cell ? await getCellEncounter(cell.id) : null;
    if (cell && state && state.status !== "ongoing") {
      await clearCellEncounter(cell.id);
      publishRegion("cell.encounter", authenticated, { action: "cleared" });
    }
    context.response.redirect("/");
    return;
  }

  // ── Sublocations (city-scale travel and interactions) ────────────────
  if (action === "local_travel") {
    const player = await ensurePlayer(authenticated.id, authenticated.name);
    const cell = await getCellForPlayer(player.id);
    const operation = cell ? await getCellEncounter(cell.id) : null;
    const fieldOperation = cell ? await getCellOperation(cell.id) : null;
    if (
      (operation?.status === "ongoing" &&
        operation.participantIds.includes(player.id)) ||
      (fieldOperation?.status === "ongoing" &&
        fieldOperation.participantIds.includes(player.id))
    ) {
      respondWithNotice(
        context.response,
        "Travel Rejected",
        "You are committed to an active cell operation.",
        false,
      );
      return;
    }
    const destination = await getLocation(fields.location ?? "");
    if (destination) {
      const result = travelWithinRegion(player, destination);
      if (result.ok) {
        await savePlayer(result.player);
        publishRegion("presence.changed", player, {
          action: "departed_location",
          destination: result.player.location,
        });
        publishRegion("presence.changed", result.player, {
          action: "arrived_location",
          origin: player.location,
        });
      }
    }
    context.response.redirect("/");
    return;
  }

  if (action === "location_interaction") {
    const player = await ensurePlayer(authenticated.id, authenticated.name);
    const location = await getLocation(player.location);
    const interaction = location?.interactions.find((candidate) =>
      candidate.id === fields.interaction
    );
    if (!location || location.regionId !== player.region || !interaction) {
      context.response.status = 404;
      context.response.body = "That opportunity is not available here.";
      return;
    }
    await respondWithLocationInteraction(
      context.response,
      player,
      location,
      interaction,
    );
    return;
  }

  if (action === "message_post") {
    const player = await ensurePlayer(authenticated.id, authenticated.name);
    const location = await getLocation(player.location);
    const board = location?.interactions.find((interaction) =>
      interaction.kind === "message_board"
    );
    if (!location || location.regionId !== player.region || !board) {
      context.response.status = 403;
      context.response.body = "There is no public message board here.";
      return;
    }
    const message = normalizeMessageBody(fields.message ?? "");
    let error: string | null = null;
    if (!message) {
      error = `Posts must contain 1–${MAX_MESSAGE_LENGTH} characters.`;
    } else {
      const moderation = await moderateMessagePost(player.id, message);
      if (!moderation.allowed) {
        error = moderation.message;
      } else {
        const post: MessagePost = {
          id: `${Date.now()}_${crypto.randomUUID()}`,
          regionId: player.region,
          playerId: player.id,
          author: player.name,
          body: message,
          postedAt: new Date().toISOString(),
        };
        await saveMessagePost(post);
        publishRegion("message.posted", player, {
          postId: post.id,
          author: post.author,
          body: post.body,
          postedAt: post.postedAt,
        });
      }
    }
    context.response.type = "text/html";
    context.response.body = renderPage({
      title: `${location.name} Message Board`,
      body: await renderMessageBoard(player, location, error),
    });
    return;
  }

  // ── Travel (spec §3.0) ────────────────────────────────────────────────
  if (action === "travel") {
    const player = await ensurePlayer(authenticated.id, authenticated.name);
    const cell = await getCellForPlayer(player.id);
    const operation = cell ? await getCellEncounter(cell.id) : null;
    const fieldOperation = cell ? await getCellOperation(cell.id) : null;
    if (
      (operation?.status === "ongoing" &&
        operation.participantIds.includes(player.id)) ||
      (fieldOperation?.status === "ongoing" &&
        fieldOperation.participantIds.includes(player.id))
    ) {
      respondWithNotice(
        context.response,
        "Travel Rejected",
        "You are committed to an active cell operation.",
        false,
      );
      return;
    }
    const destination = (await getRegionContent()).find((r) =>
      r.id === fields.region
    );
    if (destination) {
      const result = travel(player, destination);
      if (result.ok) {
        await savePlayer(result.player);
        publishRegion("presence.changed", player, {
          action: "departed_region",
          destination: result.player.region,
        });
        publishRegion("presence.changed", result.player, {
          action: "arrived_region",
          origin: player.region,
        });
      }
    }
    context.response.redirect("/");
    return;
  }

  // ── Cameras (spec §3.6) ───────────────────────────────────────────────
  if (action === "install" || action === "dismantle") {
    const camera = await getCameraById(fields.cam ?? "");
    const player = await ensurePlayer(authenticated.id, authenticated.name);
    if (!camera) {
      context.response.status = 404;
      context.response.body = "No such camera. It was never there.";
      return;
    }
    const region = await getRegion(camera.region);
    const coverage = coverageLevel(await listCameras(), camera.region);

    if (action === "install") {
      const wageMultiplier = region?.economyProfile.wageMultiplier ?? 1;
      const result = installCamera(
        camera,
        player,
        region?.cameraCooldowns,
        wageMultiplier,
      );
      await saveCamera(result.camera);
      await savePlayer(result.player);
      if (region) {
        await saveRegion({ ...region, cameraCooldowns: result.cooldowns });
      }
      if (result.camera.status !== camera.status) {
        publishRegion("camera.changed", result.player, {
          cameraId: result.camera.id,
          status: result.camera.status,
        });
      }
    } else {
      const result = dismantleCamera(
        camera,
        player,
        region?.cameraCooldowns,
        coverage,
      );
      await saveCamera(result.camera);
      await savePlayer(result.player);
      if (region) {
        await saveRegion({ ...region, cameraCooldowns: result.cooldowns });
      }
      if (result.camera.status !== camera.status) {
        publishRegion("camera.changed", result.player, {
          cameraId: result.camera.id,
          status: result.camera.status,
        });
      }
    }
    context.response.redirect("/");
    return;
  }

  // ── Crafting (spec §3.6.2) ────────────────────────────────────────────
  if (action === "craft") {
    const player = await ensurePlayer(authenticated.id, authenticated.name);
    const location = await getLocation(player.location);
    const hasWorkbench = location?.regionId === player.region &&
      location.interactions.some((interaction) =>
        interaction.kind === "workbench"
      );
    if (!hasWorkbench) {
      context.response.status = 403;
      context.response.body = "Crafting requires a workbench at your location.";
      return;
    }
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
    const player = await ensurePlayer(authenticated.id, authenticated.name);
    const decrees = await activeDecrees(player.region);
    if (action === "sell") {
      const item = (await getItems()).find((i) => i.id === fields.item);
      const price = Number(fields.price);
      if (item) {
        const result = createListing(player, item, price);
        if (result.ok) {
          await savePlayer(result.value.seller);
          await saveListing(result.value.listing);
          publishRegion("market.changed", result.value.seller, {
            action: "listed",
            listingId: result.value.listing.id,
          });
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
          publishRegion("market.changed", result.value.buyer, {
            action: "sold",
            listingId: listing.id,
          });
        }
      }
    } else {
      const listing = await getListing(player.region, fields.lst ?? "");
      if (listing) {
        const result = cancelListing(player, listing);
        if (result.ok) {
          await savePlayer(result.value.seller);
          await deleteListing(listing.regionId, listing.id);
          publishRegion("market.changed", result.value.seller, {
            action: "withdrawn",
            listingId: listing.id,
          });
        }
      }
    }
    context.response.redirect("/");
    return;
  }

  // ── Espionage (spec §3.5) ─────────────────────────────────────────────
  if (action === "espionage") {
    let player = await ensurePlayer(authenticated.id, authenticated.name);
    const cell = await getCellForPlayer(player.id);
    const cellOperation = cell ? await getCellOperation(cell.id) : null;
    if (
      cellOperation?.status === "ongoing" &&
      cellOperation.participantIds.includes(player.id)
    ) {
      respondWithNotice(
        context.response,
        "Fieldwork Rejected",
        "Complete your active cell operation before taking solo fieldwork.",
        false,
      );
      return;
    }
    const region = await getRegion(player.region);
    const espAction = fields.op as EspionageActionType;
    if (region && ["tail", "intercept", "gather_intel"].includes(espAction)) {
      const outcome = performEspionage(
        espAction,
        player,
        region,
        Math.random(),
      );
      if (outcome.ok) {
        player = outcome.player;
        await savePlayer(player);
        context.response.type = "text/html";
        context.response.body = renderPage({
          title: "Fieldwork",
          body: `<h2>Fieldwork</h2>
<p>${escapeHtml(outcome.narrative)}</p>
${
            outcome.success
              ? `<p>Intel in ${escapeHtml(region.name)}: ${
                player.intel[region.id] ?? 0
              }${
                outcome.payout > 0 ? ` · Skimmed ${outcome.payout}cr` : ""
              }</p>`
              : ""
          }
${
            outcome.flag
              ? `<p class="flag-note">You have been flagged: ${
                escapeHtml(outcome.flag.reason)
              }. Market fees apply.</p>`
              : ""
          }
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
    const player = await ensurePlayer(authenticated.id, authenticated.name);
    const region = await getRegion(player.region);
    if (region && !(await getEncounter(player.id))) {
      const rolled = rollEncounter(
        await getEncounters(),
        region,
        player,
        Math.random(),
      );
      if (rolled) await saveEncounter(startEncounter(rolled, player));
    }
    context.response.redirect("/");
    return;
  }

  if (action === "boss_start") {
    const player = await ensurePlayer(authenticated.id, authenticated.name);
    if (!(await getEncounter(player.id))) {
      const boss = (await getEncounters()).find((e) =>
        e.id === fields.enc && e.kind === "boss"
      );
      if (boss) await saveEncounter(startEncounter(boss, player));
    }
    context.response.redirect("/");
    return;
  }

  if (action === "move") {
    let player = await ensurePlayer(authenticated.id, authenticated.name);
    const state = await getEncounter(player.id);
    const encounter = (await getEncounters()).find((e) =>
      e.id === state?.encounterId
    );
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
${
            renderDialogueBlock(
              turn.state.quip
                ? await renderDialogue(turn.state.quip, encounter.art)
                : await loadArt(encounter.art),
              encounter.name,
            )
          }
<ul class="encounter-log">
${turn.state.log.map((l) => `<li>${escapeHtml(l)}</li>`).join("\n")}
</ul>
<p>Your hp: ${playerHp(player)}/${PLAYER_HP}</p>
${
            turn.state.status === "ongoing"
              ? `<p>Composure holds. The exchange continues.</p>`
              : ""
          }
${postButton("home", "Continue")}`,
        });
        return;
      }
    }
    context.response.redirect("/");
    return;
  }

  if (action === "rest") {
    const player = await ensurePlayer(authenticated.id, authenticated.name);
    const rested = restAtHotel(player);
    if (rested) await savePlayer(rested);
    context.response.redirect("/");
    return;
  }

  if (action === "log") {
    const player = await ensurePlayer(authenticated.id, authenticated.name);
    const cell = await getCellForPlayer(player.id);
    const entries = visibleQuests(player, await getQuests());
    const items = entries.length
      ? entries
        .map(
          (e) =>
            `<li><strong>${e.quest.title}</strong> [${e.state.status}] — ${
              escapeHtml(objectiveText(e))
            }${
              cell && e.state.status === "accepted"
                ? `<form method="post" action="/">
  <input type="hidden" name="a" value="share_quest">
  <input type="hidden" name="quest" value="${escapeHtml(e.quest.id)}">
  <button type="submit" class="link-button">Share with nearby cell</button>
</form>`
                : ""
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

  if (action === "inventory") {
    const player = await ensurePlayer(authenticated.id, authenticated.name);
    const allItems = await getItems();
    const carried = player.inventory
      .map((id) => allItems.find((i) => i.id === id))
      .filter((i) => i !== undefined);
    const itemList = carried.length
      ? carried
        .map(
          (i) =>
            `<li><strong>${escapeHtml(i.name)}</strong> — ${
              escapeHtml(i.description)
            }${i.tradeable ? "" : " <em>(untradeable)</em>"}</li>`,
        )
        .join("\n")
      : `<li>Nothing. The Agencies prefer it that way.</li>`;
    const scrapEntries = Object.entries(player.scrap);
    const scrapList = scrapEntries.length
      ? scrapEntries
        .map(
          ([material, count]) =>
            `<li><strong>${
              escapeHtml(material.replaceAll("_", " "))
            }</strong> × ${count}</li>`,
        )
        .join("\n")
      : `<li>No salvage on hand.</li>`;
    const intelEntries = Object.entries(player.intel);
    let intelTable: string;
    if (intelEntries.length) {
      const regions = await getRegionContent();
      const nameFor = (id: string) =>
        regions.find((r) => r.id === id)?.name ?? id;
      const rows = intelEntries
        .sort(([a], [b]) => nameFor(a).localeCompare(nameFor(b)))
        .map(
          ([regionId, n]) =>
            `<tr><td>${escapeHtml(nameFor(regionId))}</td><td>${n}</td></tr>`,
        )
        .join("\n");
      intelTable = `<table class="intel-table">
<thead><tr><th>Region</th><th>Intel</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`;
    } else {
      intelTable = `<p>No regional intelligence on file.</p>`;
    }
    context.response.type = "text/html";
    context.response.body = renderPage({
      title: "Inventory",
      body: `<h2>Inventory</h2>
<p class="eyebrow">${player.currency} credits on file</p>
<section class="inventory-items">
<h3>Items</h3>
<ul>
${itemList}
</ul>
</section>
<section class="inventory-scrap">
<h3>Scrap</h3>
<ul>
${scrapList}
</ul>
</section>
<section class="inventory-intel">
<h3>Intelligence</h3>
${intelTable}
</section>
<div class="action-row">
${postButton("home", "Back to the park")}
</div>`,
    });
    return;
  }

  if (action === "talk") {
    const npcId = fields.npc ?? "";
    const npc = await getNpc(npcId);
    const playerAtLocation = await ensurePlayer(
      authenticated.id,
      authenticated.name,
    );
    const currentLocation = await getLocation(playerAtLocation.location);
    const npcIsHere = currentLocation?.regionId === playerAtLocation.region &&
      currentLocation.interactions
        .filter((interaction) => interaction.kind === "npcs")
        .some((interaction) => interaction.npcIds?.includes(npcId));
    if (!npc || !npcIsHere) {
      context.response.status = 404;
      context.response.body = "Citizen not found here.";
      return;
    }

    // Entering a conversation fresh (no option chosen yet).
    if (!fields.node || !fields.option) {
      await respondWithNode(
        context.response,
        npc.id,
        npc.start,
        null,
        playerAtLocation,
      );
      return;
    }

    // Choosing an option within the current node.
    let player = playerAtLocation;
    const result = resolveSelection(
      npc,
      fields.node,
      fields.option,
      player,
      await getQuests(),
    );
    if (!result) {
      context.response.status = 404;
      context.response.body =
        "That option was never available. Nothing is available.";
      return;
    }

    // Hidden quest reveal (spec §3.1): accept and announce only on selection.
    let reveal: string | null = null;
    if (result.grantedQuest) {
      player = acceptQuest(player, result.grantedQuest);
      const objective = result.grantedQuest.stages[0]?.objective ??
        "Await instructions.";
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
          formatMaterials(result.advancesQuest.rewards.materials),
        );
      }
    }

    if (result.grantedQuest || result.advancesQuest) await savePlayer(player);

    await respondWithNode(context.response, npcId, result.option.next, {
      speakerArt: npc.art,
      speakerName: npc.name,
      line: result.option.response,
      reveal,
    }, player);
    return;
  }

  context.response.status = 400;
  context.response.body = "Unrecognized action.";
});

// ── Multiplayer helpers ────────────────────────────────────────────────────

async function renderMultiplayer(player: Player): Promise<string> {
  const nearby = (await listPlayersAtLocation(player.region, player.location))
    .filter((candidate) => candidate.id !== player.id);
  const cell = await getCellForPlayer(player.id);
  const invitations = cell ? [] : await listCellInvites(player.id);
  const itemNames = new Map(
    (await getItems()).map((item) => [item.id, item.name]),
  );

  const presenceRows = nearby.length
    ? (await Promise.all(nearby.map(async (candidate) => {
      const trusted = player.trustedPlayerIds.includes(candidate.id);
      const candidateCell = await getCellForPlayer(candidate.id);
      const trustForm = `<form method="post" action="/">
  <input type="hidden" name="a" value="${
        trusted ? "revoke_trust" : "trust_player"
      }">
  <input type="hidden" name="player" value="${escapeHtml(candidate.id)}">
  <button type="submit" class="link-button">${
        trusted ? "Revoke trust" : "Trust"
      }</button>
</form>`;
      const inviteForm = cell?.leaderId === player.id && !candidateCell
        ? `<form method="post" action="/">
  <input type="hidden" name="a" value="invite_to_cell">
  <input type="hidden" name="player" value="${escapeHtml(candidate.id)}">
  <button type="submit" class="link-button">Invite to ${
          escapeHtml(cell.name)
        }</button>
</form>`
        : "";
      const itemOptions = player.inventory.map((itemId) =>
        `<option value="${escapeHtml(itemId)}">${
          escapeHtml(itemNames.get(itemId) ?? itemId)
        }</option>`
      ).join("");
      const sharing = trusted
        ? `<div class="sharing-controls">
${
          itemOptions
            ? `<form method="post" action="/">
  <input type="hidden" name="a" value="share_item">
  <input type="hidden" name="player" value="${escapeHtml(candidate.id)}">
  <select name="item" aria-label="Item to share">${itemOptions}</select>
  <button type="submit" class="link-button">Give item</button>
</form>`
            : ""
        }
${
          (player.intel[player.region] ?? 0) > 0
            ? `<form method="post" action="/">
  <input type="hidden" name="a" value="share_intel">
  <input type="hidden" name="player" value="${escapeHtml(candidate.id)}">
  <button type="submit" class="link-button">Share local intel</button>
</form>`
            : ""
        }
</div>`
        : "";
      const cellLabel = candidateCell
        ? ` · <em>${escapeHtml(candidateCell.name)}</em>`
        : "";
      return `<li><strong>${escapeHtml(candidate.name)}</strong>${cellLabel}
${trustForm}${inviteForm}${sharing}</li>`;
    }))).join("\n")
    : `<li>No other active citizens are recorded here.</li>`;

  let cellBody = "";
  if (cell) {
    const members = (await Promise.all(cell.memberIds.map((id) =>
      getPlayer(id)
    )))
      .filter((member) => member !== null);
    cellBody = `<h4>Cell: ${escapeHtml(cell.name)}</h4>
<ul>${
      members.map((member) =>
        `<li>${escapeHtml(member.name)}${
          member.id === cell.leaderId ? " · leader" : ""
        }</li>`
      ).join("\n")
    }</ul>
${postButton("leave_cell", "Leave cell")}`;
  } else {
    const inviteRows = (await Promise.all(
      invitations.map(async (invite) => ({
        invite,
        cell: await getCell(invite.cellId),
      })),
    ))
      .filter((entry) => entry.cell !== null)
      .map(({ invite, cell }) =>
        `<li><strong>${escapeHtml(cell!.name)}</strong>
<form method="post" action="/">
  <input type="hidden" name="a" value="accept_cell_invite">
  <input type="hidden" name="invite" value="${escapeHtml(invite.id)}">
  <button type="submit" class="link-button">Accept invitation</button>
</form>
<form method="post" action="/">
  <input type="hidden" name="a" value="decline_cell_invite">
  <input type="hidden" name="invite" value="${escapeHtml(invite.id)}">
  <button type="submit" class="link-button">Decline</button>
</form></li>`
      ).join("\n");
    cellBody = `<h4>Your Cell</h4>
${inviteRows ? `<p>Pending invitations:</p><ul>${inviteRows}</ul>` : ""}
<form method="post" action="/">
  <input type="hidden" name="a" value="create_cell">
  <label for="cell-name">Create a cell</label>
  <input id="cell-name" name="name" minlength="2" maxlength="32" required>
  <button type="submit" class="link-button">File Cell</button>
</form>`;
  }

  return `<section class="multiplayer">
<h3>Citizens Present</h3>
<p>Presence reflects characters active here during the past fifteen minutes.</p>
<ul class="presence-list">${presenceRows}</ul>
${cellBody}
</section>`;
}

// ── Sublocation helpers ────────────────────────────────────────────────────

async function resolveCurrentLocation(
  player: Player,
  approvedLocationIds: string[],
): Promise<{ player: Player; location: Sublocation | null }> {
  const locations = (await getLocations()).filter((location) =>
    location.regionId === player.region &&
    approvedLocationIds.includes(location.id)
  );
  const location =
    locations.find((candidate) => candidate.id === player.location) ??
      locations[0] ?? null;
  if (location && player.location !== location.id) {
    player = { ...player, location: location.id };
    await savePlayer(player);
  }
  return { player, location };
}

async function renderLocalTravel(
  player: Player,
  current: Sublocation,
): Promise<string> {
  const locations = (await getLocations()).filter((location) =>
    location.regionId === player.region
  );
  const rows = locations.map((location) => {
    if (location.id === current.id) {
      return `<li><strong>${
        escapeHtml(location.name)
      }</strong> — you are here</li>`;
    }
    return `<li>
<form method="post" action="/">
  <input type="hidden" name="a" value="local_travel">
  <input type="hidden" name="location" value="${escapeHtml(location.id)}">
  <button type="submit" class="link-button">Go to ${
      escapeHtml(location.name)
    }</button>
</form>
</li>`;
  }).join("\n");
  return `<section class="local-travel">
<h3>Elsewhere in the City</h3>
<ul class="travel-list">${rows}</ul>
</section>`;
}

function renderLocationInteractions(location: Sublocation): string {
  const rows = location.interactions.map((interaction) =>
    `<li>
<form method="post" action="/">
  <input type="hidden" name="a" value="location_interaction">
  <input type="hidden" name="interaction" value="${escapeHtml(interaction.id)}">
  <button type="submit" class="dialogue-option">${
      escapeHtml(interaction.label)
    }</button>
</form>
<span>${escapeHtml(interaction.description)}</span>
</li>`
  ).join("\n");
  return `<section class="location-interactions">
<h3>Available Here</h3>
<ul class="interaction-list">${rows}</ul>
</section>`;
}

async function respondWithLocationInteraction(
  response: { type?: string; body: unknown; status?: number },
  player: Player,
  location: Sublocation,
  interaction: LocationInteraction,
): Promise<void> {
  let body = "";
  switch (interaction.kind) {
    case "npcs": {
      const npcs =
        (await Promise.all((interaction.npcIds ?? []).map((id) => getNpc(id))))
          .filter((npc) => npc !== null);
      const rows = npcs.length
        ? npcs.map((npc) =>
          `<li>
<form method="post" action="/">
  <input type="hidden" name="a" value="talk">
  <input type="hidden" name="npc" value="${escapeHtml(npc.id)}">
  <button type="submit" class="npc-link">${
            escapeHtml(npc.name)
          }</button> — <em>${escapeHtml(npc.role)}</em>
</form>
</li>`
        ).join("\n")
        : `<li>No one here wants to be entered into the record.</li>`;
      body = `<section><h3>${
        escapeHtml(interaction.label)
      }</h3><ul class="npc-list">${rows}</ul></section>`;
      break;
    }
    case "market":
      body = await renderMarket(player);
      break;
    case "workbench":
      body = await renderWorkbench(player);
      break;
    case "cameras":
      body = await renderCameraBoard(player);
      break;
    case "espionage":
      body = await renderEspionage(player);
      break;
    case "encounter":
      body = await renderEncounterBoard(player);
      break;
    case "message_board":
      body = await renderMessageBoard(player, location, null);
      break;
    case "activity": {
      const result = performLocationAction(player, location, interaction);
      if (result.ok) await savePlayer(result.player);
      const note = result.reason
        ? `<p class="flag-note">${escapeHtml(result.reason)}</p>`
        : "";
      body = `<section class="location-result">
<h3>${escapeHtml(interaction.label)}</h3>
<p>${escapeHtml(result.narrative)}</p>
${note}
<p>Funds: ${result.player.currency}cr · Suspicion: ${result.player.suspicion} · Intel here: ${
        result.player.intel[result.player.region] ?? 0
      }</p>
<p>Crafting materials: ${
        escapeHtml(formatMaterials(result.player.scrap) || "none")
      }</p>
</section>`;
      break;
    }
  }
  response.type = "text/html";
  response.body = renderPage({
    title: `${location.name} — ${interaction.label}`,
    body: `<p class="eyebrow">${escapeHtml(location.name)}</p>${body}${
      postButton("home", "Return to the location")
    }`,
  });
}

async function renderMessageBoard(
  player: Player,
  location: Sublocation,
  error: string | null,
): Promise<string> {
  const posts = await listMessagePosts(player.region);
  const rows = posts.length
    ? posts.map((post) =>
      `<li data-post-id="${escapeHtml(post.id)}">
<p>${escapeHtml(post.body)}</p>
<small>${escapeHtml(post.author)} · <time datetime="${
        escapeHtml(post.postedAt)
      }">${escapeHtml(new Date(post.postedAt).toLocaleString())}</time></small>
</li>`
    ).join("\n")
    : `<li>No notices have survived moderation.</li>`;
  return `<section class="message-board">
<h3>${escapeHtml(location.name)} — Regional Message Board</h3>
<p>Posts are visible throughout ${
    escapeHtml((await getRegion(player.region))?.name ?? player.region)
  }. Keep it short. Assume it is evidence.</p>
${error ? `<p class="flag-note">${escapeHtml(error)}</p>` : ""}
<form method="post" action="/">
  <input type="hidden" name="a" value="message_post">
  <label for="message">Leave a notice</label>
  <textarea id="message" name="message" maxlength="${MAX_MESSAGE_LENGTH}" required></textarea>
  <button type="submit" class="dialogue-option">Post Notice</button>
</form>
<ul class="message-list">${rows}</ul>
</section>`;
}

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

  const installWait = Math.ceil(
    cooldownRemaining(region?.cameraCooldowns, "install") / 1000,
  );
  const dismantleWait = Math.ceil(
    cooldownRemaining(region?.cameraCooldowns, "dismantle") / 1000,
  );

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
<p>Coverage: ${coveragePct}% · Your suspicion: ${player.suspicion} · Scrap held: ${
    totalScrap(player)
  }</p>
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
  const itemDescription = new Map(items.map((i) => [i.id, i.description]));
  const fee = craftingFee(player);

  const scrapLine = formatMaterials(player.scrap) || "none";

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
      return `<li><strong>${name}</strong> — ${
        escapeHtml(itemDescription.get(r.result) ?? "No filed function.")
      }<br><em>${describeCost(r)} · ${fee}cr license</em> ${btn}</li>`;
    })
    .join("\n");

  return `<section class="workbench">
<h3>Workbench</h3>
<p>Crafting materials: ${escapeHtml(scrapLine)}</p>
<p class="fee-note">The Bureau of Workmanship levies a ${fee}cr licensing fee per craft.</p>
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
        ` <em class="price-history">last ${summary.last}cr · avg ${summary.average}cr · ${summary.min}–${summary.max}cr over ${summary.sales} sale${
          summary.sales === 1 ? "" : "s"
        }</em>`,
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
        (i) =>
          `<li><span>${escapeHtml(i.description)}</span>
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
        const adjusted = price !== l.price
          ? ` <em>(decree-adjusted from ${l.price}cr)</em>`
          : "";
        return `<li><strong>${escapeHtml(name)}</strong> — ${price}cr ${
          own ? "(yours) " : ""
        }<br><span>${
          escapeHtml(item?.description ?? "Unfiled merchandise.")
        }</span>${action}${adjusted}${history.get(l.itemId) ?? ""}</li>`;
      })
      .join("\n")
    : `<li>The board is bare. The Ministry blames supply chains.</li>`;

  const region = await getRegion(player.region);
  const valuationNote = player.inventory.includes("valuation_lens")
    ? `<p class="stamp-note">Your Valuation Lens reduces flag surcharges by 10 percentage points.</p>`
    : "";
  return `<section class="market">
<h3>The Market — ${escapeHtml(region?.name ?? player.region)}</h3>
<p>Funds: ${player.currency} credits</p>
${valuationNote}
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
<p>The checkpoints here have your photograph. ${
      escapeHtml(region.name)
    } is closed to you.</p>
</section>`;
  }
  const cell = await getCellForPlayer(player.id);
  const cellOperation = cell ? await getCellOperation(cell.id) : null;
  if (cell && cellOperation) {
    const participants = (await Promise.all(
      cellOperation.participantIds.map((id) => getPlayer(id)),
    )).filter((participant) => participant !== null);
    const roster = participants.map((participant) =>
      escapeHtml(participant.name)
    ).join(", ");
    const log = cellOperation.log.map((line) => `<li>${escapeHtml(line)}</li>`)
      .join("\n");
    if (cellOperation.status === "completed") {
      return `<section class="espionage cell-operation">
<h3>Cell Field Operation — Complete</h3>
<p>${
        escapeHtml(cell.name)
      } recovered the dossier. Every participant received 20cr, 3 local intel, and 1 signal crystal.</p>
<p>Participants: ${roster}</p>
<ul class="operation-log">${log}</ul>
${postButton("clear_cell_operation", "Close operation file")}
</section>`;
    }
    const stage = CELL_OPERATION_STAGES[cellOperation.stageIndex];
    const lastActor = cellOperation.completedBy.at(-1);
    const mayAct = cellOperation.participantIds.includes(player.id) &&
      lastActor !== player.id;
    const contribution = mayAct && stage
      ? `<form method="post" action="/">
  <input type="hidden" name="a" value="cell_operation_advance">
  <input type="hidden" name="op" value="${stage.action}">
  <button type="submit" class="dialogue-option">Contribute: ${
        escapeHtml(stage.label)
      }</button>
</form>`
      : `<p><em>Another participant must carry the next stage.</em></p>`;
    return `<section class="espionage cell-operation">
<h3>Cell Field Operation</h3>
<p><strong>Stage ${
      cellOperation.stageIndex + 1
    } of ${CELL_OPERATION_STAGES.length}:</strong> ${
      escapeHtml(stage?.label ?? "Await instructions")
    }</p>
<p>Participants: ${roster}</p>
<ul class="operation-log">${log}</ul>
${contribution}
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
      ([op, label]) =>
        `<li>
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
<p>Intel here: ${intel} · Flags on your file: ${flags}${
    flags > 0 ? " (market fees apply)" : ""
  }</p>
<ul class="espionage-list">
${rows}
</ul>
${
    cell
      ? `<form method="post" action="/">
  <input type="hidden" name="a" value="cell_operation_start">
  <button type="submit" class="dialogue-option">Open Cell Operation</button>
</form>`
      : ""
  }
</section>`;
}

/** Ministry of Valuation decrees in force here (spec §3.3 live-ops). */
async function renderDecrees(player: Player): Promise<string> {
  const decrees = await activeDecrees(player.region);
  if (decrees.length === 0) return "";
  const rows = decrees
    .map(
      (d) =>
        `<li><strong>${escapeHtml(d.title)}</strong> — ${
          escapeHtml(d.proclamation)
        } <em>(prices ×${d.priceMultiplier})</em></li>`,
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
  const cell = await getCellForPlayer(player.id);
  const cellState = cell ? await getCellEncounter(cell.id) : null;
  if (cell && cellState) {
    const encounter = (await getEncounters()).find((candidate) =>
      candidate.id === cellState.encounterId
    );
    if (encounter) {
      const participants =
        (await Promise.all(cellState.participantIds.map((id) => getPlayer(id))))
          .filter((participant) => participant !== null);
      const log = cellState.log.slice(-8).map((line) =>
        `<li>${escapeHtml(line)}</li>`
      ).join("\n");
      const canAct = cellState.status === "ongoing" &&
        cellState.participantIds.includes(player.id);
      const moves = canAct
        ? encounter.moves.map((move) =>
          `<li>
<form method="post" action="/">
  <input type="hidden" name="a" value="cell_move">
  <input type="hidden" name="move" value="${escapeHtml(move.id)}">
  <button type="submit" class="dialogue-option">${escapeHtml(move.label)}${
            move.cost ? ` (${move.cost}cr)` : ""
          }</button>
</form>
</li>`
        ).join("\n")
        : "";
      const resolution = cellState.status !== "ongoing"
        ? `<p>${
          cellState.status === "victory"
            ? "Rewards were disbursed to every recorded participant."
            : "The cell operation has concluded."
        }</p>${postButton("clear_cell_encounter", "Close operation file")}`
        : "";
      return `<section class="encounter cell-encounter">
<h3>⚠ ${escapeHtml(cell.name)} vs. ${
        escapeHtml(encounter.name)
      } — ${cellState.enemyHp}/${encounter.maxHp} hp</h3>
${renderDialogueBlock(await loadArt(encounter.art), encounter.name)}
<p>Participants: ${
        participants.map((participant) => escapeHtml(participant.name)).join(
          ", ",
        ) || "none"
      }</p>
<ul class="encounter-log">${log}</ul>
${moves ? `<ul class="encounter-moves">${moves}</ul>` : ""}
${
        !canAct && cellState.status === "ongoing"
          ? `<p>You are observing this operation, not participating in it.</p>`
          : ""
      }
${resolution}
</section>`;
    }
  }
  const state = await getEncounter(player.id);
  if (state) {
    const encounter = (await getEncounters()).find((e) =>
      e.id === state.encounterId
    );
    if (!encounter) return "";
    const moves = encounter.moves
      .map(
        (m) =>
          `<li>
<form method="post" action="/">
  <input type="hidden" name="a" value="move">
  <input type="hidden" name="move" value="${m.id}">
  <button type="submit" class="dialogue-option">${escapeHtml(m.label)}${
            m.cost ? ` (${m.cost}cr)` : ""
          }</button>
</form>
</li>`,
      )
      .join("\n");
    const log = state.log.slice(-6).map((l) => `<li>${escapeHtml(l)}</li>`)
      .join("\n");
    return `<section class="encounter">
<h3>⚠ ${
      escapeHtml(encounter.name)
    } — ${state.enemyHp}/${encounter.maxHp} hp · you ${
      playerHp(player)
    }/${PLAYER_HP} hp</h3>
${
      renderDialogueBlock(
        state.quip
          ? await renderDialogue(state.quip, encounter.art)
          : await loadArt(encounter.art),
        encounter.name,
      )
    }
<ul class="encounter-log">
${log}
</ul>
<ul class="encounter-moves">
${moves}
</ul>
</section>`;
  }
  const bosses = (await getEncounters()).filter(
    (e) =>
      e.kind === "boss" && e.regions.includes(player.region) &&
      !player.restricted.includes(player.region),
  );
  const bossRows = bosses
    .map(
      (b) =>
        `<li>
<form method="post" action="/">
  <input type="hidden" name="a" value="boss_start">
  <input type="hidden" name="enc" value="${b.id}">
  <button type="submit" class="dialogue-option">Confront ${
          escapeHtml(b.name)
        }</button> <em>(boss — solo attempts are unwise)</em>
</form>
${
          cell
            ? `<form method="post" action="/">
  <input type="hidden" name="a" value="cell_boss_start">
  <input type="hidden" name="enc" value="${escapeHtml(b.id)}">
  <button type="submit" class="dialogue-option">Mobilize ${
              escapeHtml(cell.name)
            }</button> <em>(requires two active members here)</em>
</form>`
            : ""
        }
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
  const regions = (await getRegionContent()).filter((r) =>
    r.id !== player.region
  );
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
  const transponderNote = player.inventory.includes("transit_transponder")
    ? `<p class="stamp-note">Your Ghost Transit Transponder reduces the remaining fare by 25%.</p>`
    : "";
  return `<section class="travel">
<h3>Elsewhere in the Union</h3>
${stampNote}
${transponderNote}
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
  player: Player,
): Promise<void> {
  const npc = await getNpc(npcId);
  if (!npc) {
    response.status = 404;
    response.body = "Citizen not found.";
    return;
  }
  const parts: string[] = [];
  if (block) {
    const rendered = await renderDialogue(block.line, block.speakerArt);
    parts.push(renderDialogueBlock(rendered, block.speakerName));
    if (block.reveal) parts.push(block.reveal);
  }

  if (nextNodeId === null) {
    parts.push(renderReset(npcId));
    parts.push(postButton("home", "Walk away"));
  } else if (nextNodeId === "reset") {
    // Authored reset sentinel: offer to start over and a way out.
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
    // Once a choice has been made, the player can restart without having to
    // find an authored reset branch in this NPC's tree.
    if (block) parts.push(renderReset(npcId));
  }

  response.type = "text/html";
  response.body = renderPage({ title: npc.name, body: parts.join("\n") });
}
