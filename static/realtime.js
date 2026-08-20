(() => {
  const start = async () => {
    const identity = document.querySelector(
      ".character-bar[data-player-id][data-region]",
    );
    let playerId = identity?.dataset.playerId;
    let region = identity?.dataset.region;
    if (!playerId || !region) {
      const response = await fetch("/events/session", {
        credentials: "same-origin",
      });
      if (!response.ok) return;
      ({ playerId, region } = await response.json());
    }

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const status = document.createElement("span");
    status.className = "live-status";
    status.setAttribute("role", "status");
    status.textContent = "Connecting to regional channel…";
    (identity ?? document.querySelector("header nav"))?.append(status);

    let reconnectDelay = 1_000;
    let socket;
    let pendingReload = false;

    const reloadWhenSafe = () => {
      const active = document.activeElement;
      const editing = active &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName);
      if (editing) {
        pendingReload = true;
        status.textContent = "Regional update pending";
        return;
      }
      location.reload();
    };

    const refreshPresence = async () => {
      const current = document.querySelector("main > .multiplayer");
      if (!current) return;
      const response = await fetch("/", { credentials: "same-origin" });
      if (!response.ok) return;
      const nextDocument = new DOMParser().parseFromString(
        await response.text(),
        "text/html",
      );
      const next = nextDocument.querySelector("main > .multiplayer");
      if (next) current.replaceWith(next);
    };

    const appendMessagePost = (event) => {
      const list = document.querySelector(".message-board .message-list");
      if (!list || !event.data?.body || !event.data?.author) return false;
      if (event.data.postId && list.querySelector(`[data-post-id="${CSS.escape(event.data.postId)}"]`)) {
        return true;
      }
      const item = document.createElement("li");
      if (event.data.postId) item.dataset.postId = event.data.postId;
      const body = document.createElement("p");
      body.textContent = event.data.body;
      const byline = document.createElement("small");
      const postedAt = event.data.postedAt
        ? new Date(event.data.postedAt).toLocaleString()
        : "now";
      byline.textContent = `${event.data.author} · ${postedAt}`;
      item.append(body, byline);
      list.prepend(item);
      return true;
    };

    document.addEventListener("focusout", () => {
      if (pendingReload) {
        pendingReload = false;
        setTimeout(reloadWhenSafe, 0);
      }
    });

    const connect = () => {
      socket = new WebSocket(
        `${protocol}//${location.host}/events/${encodeURIComponent(region)}`,
      );
      socket.addEventListener("open", () => {
        reconnectDelay = 1_000;
        status.textContent = `Live · ${region.replaceAll("_", " ")}`;
      });
      socket.addEventListener("message", (message) => {
        let event;
        try {
          event = JSON.parse(message.data);
        } catch {
          return;
        }
        document.dispatchEvent(
          new CustomEvent("flockwatch:region-event", { detail: event }),
        );
        if (
          event.actorId === playerId || event.data?.status === "heartbeat"
        ) return;
        status.textContent = `Live update · ${event.type}`;
        if (event.type === "presence.changed") {
          refreshPresence().catch(() => {});
          return;
        }
        if (event.type === "message.posted" && appendMessagePost(event)) return;
        clearTimeout(window.flockwatchReloadTimer);
        window.flockwatchReloadTimer = setTimeout(reloadWhenSafe, 250);
      });
      socket.addEventListener("close", () => {
        status.textContent = "Regional channel reconnecting…";
        setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
      });
      socket.addEventListener("error", () => socket.close());
    };

    connect();
  };

  start().catch(() => {});
})();
