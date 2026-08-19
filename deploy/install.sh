#!/usr/bin/env bash
#
# FlockWatch installer — provisions the app behind nginx on ports 80 and 443.
#
# Usage (run from the repo root, as root or via sudo):
#   sudo ./deploy/install.sh --domain play.example.com [options]
#
# Options:
#   --domain NAME      Public domain for nginx server_name + TLS cert. Required
#                      for a real (Let's Encrypt) cert; falls back to "_" otherwise.
#   --email ADDR       Contact email for Let's Encrypt registration.
#   --tls MODE         letsencrypt | selfsigned | none   (default: letsencrypt
#                      when --domain is set, otherwise selfsigned)
#   --port N           Port the Deno app listens on (default: 8000)
#   --app-dir PATH     Where the app lives (default: /opt/flockwatch)
#   --no-service       Skip systemd; only configure nginx
#   -h, --help         Show this help
#
# Supports Debian/Ubuntu (apt) and Fedora/RHEL (dnf); detects the package
# manager at runtime. Installs Deno if missing.
set -euo pipefail

# ── Defaults ─────────────────────────────────────────────────────────────────
DOMAIN=""
EMAIL=""
TLS_MODE=""
APP_PORT=8000
APP_DIR=/opt/flockwatch
DATA_DIR=${APP_DIR}/data
USE_SERVICE=1
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m==> warning:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m==> error:\033[0m %s\n' "$*" >&2; exit 1; }

usage() { sed -n '2,22p' "$0"; exit 0; }

# ── Parse args ───────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="${2:?--domain needs a value}"; shift 2;;
    --email) EMAIL="${2:?--email needs a value}"; shift 2;;
    --tls) TLS_MODE="${2:?--tls needs a value}"; shift 2;;
    --port) APP_PORT="${2:?--port needs a value}"; shift 2;;
    --app-dir) APP_DIR="${2:?--app-dir needs a value}"; shift 2;;
    --no-service) USE_SERVICE=0; shift;;
    -h|--help) usage;;
    *) die "unknown option: $1 (try --help)";;
  esac
done

[[ $EUID -eq 0 ]] || die "run as root (or with sudo)"

# Default TLS mode: real cert if we have a domain, otherwise self-signed.
if [[ -z "$TLS_MODE" ]]; then
  if [[ -n "$DOMAIN" ]]; then TLS_MODE="letsencrypt"; else TLS_MODE="selfsigned"; fi
fi
[[ "$TLS_MODE" =~ ^(letsencrypt|selfsigned|none)$ ]] || die "invalid --tls: $TLS_MODE"
if [[ "$TLS_MODE" == "letsencrypt" && -z "$DOMAIN" ]]; then
  die "--tls letsencrypt requires --domain"
fi
[[ -n "$DOMAIN" ]] || { DOMAIN="_"; warn "no --domain given; using catch-all server_name"; }

# ── Detect package manager ───────────────────────────────────────────────────
PKG=""
if command -v apt-get >/dev/null 2>&1; then PKG=apt;
elif command -v dnf >/dev/null 2>&1; then PKG=dnf;
elif command -v yum >/dev/null 2>&1; then PKG=yum;
else die "no supported package manager (apt/dnf/yum) found"; fi

pkg_install() {
  case "$PKG" in
    apt) apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y "$@";;
    dnf|yum) "$PKG" install -y "$@";;
  esac
}

# ── Install dependencies ─────────────────────────────────────────────────────
log "installing system packages ($PKG)"
PKGS=(nginx curl rsync)
[[ "$TLS_MODE" == "letsencrypt" ]] && PKGS+=(certbot)
[[ "$PKG" == "apt" && "$TLS_MODE" == "letsencrypt" ]] && PKGS+=(python3-certbot-nginx)
pkg_install "${PKGS[@]}"

# ── Install Deno if needed ───────────────────────────────────────────────────
DENO_BIN="$(command -v deno || true)"
if [[ -z "$DENO_BIN" ]]; then
  log "installing Deno"
  curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh
  DENO_BIN=/usr/local/bin/deno
fi
log "deno: $DENO_BIN ($("$DENO_BIN" --version | head -1))"

# ── Deploy app files ─────────────────────────────────────────────────────────
if [[ "$USE_SERVICE" -eq 1 ]]; then
  log "deploying app to $APP_DIR"
  mkdir -p "$APP_DIR"
  rsync -a --delete \
    --exclude node_modules --exclude .git --exclude '.env*' \
    "$SRC_DIR/" "$APP_DIR/"

  mkdir -p "$DATA_DIR"

  id -u flockwatch >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin flockwatch
  chown -R flockwatch:flockwatch "$APP_DIR" "$DATA_DIR"

  # Pre-warm Deno's dependency cache as the service user so the app never needs
  # to reach JSR/npm at boot (fixes "JSR package manifest failed to load").
  log "pre-warming Deno dependency cache"
  runuser -u flockwatch -- env DENO_DIR="$APP_DIR/.deno_cache" \
    "$DENO_BIN" cache --node-modules-dir=auto "$APP_DIR/main.ts" \
    || warn "cache pre-warm failed; the app will fetch deps on first start"
  chown -R flockwatch:flockwatch "$APP_DIR" "$DATA_DIR"

  log "installing systemd unit"
  sed -e "s|__APP_DIR__|$APP_DIR|g" \
      -e "s|__DENO_BIN__|$DENO_BIN|g" \
      "$SRC_DIR/deploy/flockwatch.service" > /etc/systemd/system/flockwatch.service
  systemctl daemon-reload
  systemctl enable --now flockwatch
  systemctl is-active --quiet flockwatch && log "flockwatch service running" || die "service failed to start (see: journalctl -u flockwatch)"
else
  warn "--no-service set; ensure the app is running on 127.0.0.1:$APP_PORT"
fi

# ── TLS certificate ──────────────────────────────────────────────────────────
CERT=/etc/nginx/ssl/flockwatch.crt
CERT_KEY=/etc/nginx/ssl/flockwatch.key
mkdir -p /etc/nginx/ssl /var/www/letsencrypt

case "$TLS_MODE" in
  none)
    warn "TLS disabled; serving HTTP on port 80 only"
    ;;
  selfsigned)
    log "generating self-signed certificate"
    openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
      -keyout "$CERT_KEY" -out "$CERT" \
      -subj "/CN=$DOMAIN" 2>/dev/null
    warn "self-signed cert: browsers will warn"
    ;;
  letsencrypt)
    log "obtaining Let's Encrypt certificate for $DOMAIN"
    # Render a temporary HTTP-only config so certbot can solve the challenge.
    sed -e "s|__DOMAIN__|$DOMAIN|g" \
        -e "s|__CERT__|$CERT|g" \
        -e "s|__CERT_KEY__|$CERT_KEY|g" \
        "$SRC_DIR/deploy/nginx.conf" > /etc/nginx/sites-available/flockwatch.conf
    ln -sf /etc/nginx/sites-available/flockwatch.conf /etc/nginx/sites-enabled/flockwatch.conf
    nginx -t && systemctl reload nginx || systemctl start nginx
    EMAIL_ARGS=(--register-unsafely-without-email)
    [[ -n "$EMAIL" ]] && EMAIL_ARGS=(--email "$EMAIL")
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos "${EMAIL_ARGS[@]}" || {
      warn "certbot failed; falling back to self-signed"
      openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
        -keyout "$CERT_KEY" -out "$CERT" -subj "/CN=$DOMAIN" 2>/dev/null
    }
    # certbot may have rewritten the config to reference its own cert paths.
    if [[ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]]; then
      CERT="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
      CERT_KEY="/etc/letsencrypt/live/$DOMAIN/privkey.pem"
    fi
    ;;
esac

# ── nginx config ─────────────────────────────────────────────────────────────
log "configuring nginx"
sed -e "s|__DOMAIN__|$DOMAIN|g" \
    -e "s|__CERT__|$CERT|g" \
    -e "s|__CERT_KEY__|$CERT_KEY|g" \
    -e "s|127.0.0.1:8000|127.0.0.1:$APP_PORT|g" \
    "$SRC_DIR/deploy/nginx.conf" > /etc/nginx/sites-available/flockwatch.conf

# If TLS is off, strip the 443 server block and the port-80 redirect.
if [[ "$TLS_MODE" == "none" ]]; then
  awk '
    /^# ── Port 443/ {skip=1}
    skip==0 && /return 301 https/ {next}
    skip==0 {print}
  ' "$SRC_DIR/deploy/nginx.conf" | sed -e "s|__DOMAIN__|$DOMAIN|g" \
    > /etc/nginx/sites-available/flockwatch.conf
fi

ln -sf /etc/nginx/sites-available/flockwatch.conf /etc/nginx/sites-enabled/flockwatch.conf
# Remove the distro default site if it would shadow ours.
[[ -e /etc/nginx/sites-enabled/default ]] && rm -f /etc/nginx/sites-enabled/default

nginx -t || die "nginx config test failed"
systemctl reload nginx || systemctl start nginx

# ── Firewall (best-effort) ───────────────────────────────────────────────────
if command -v ufw >/dev/null 2>&1; then
  ufw allow 'Nginx Full' >/dev/null 2>&1 && log "ufw: allowed Nginx Full" || true
elif command -v firewall-cmd >/dev/null 2>&1; then
  firewall-cmd --permanent --add-service=http --add-service=https >/dev/null 2>&1 \
    && firewall-cmd --reload >/dev/null 2>&1 && log "firewalld: allowed http/https" || true
fi

log "done."
echo
echo "  App:    127.0.0.1:$APP_PORT $( [[ $USE_SERVICE -eq 1 ]] && echo '(systemd: flockwatch.service)' )"
if [[ "$TLS_MODE" == "none" ]]; then
  echo "  Public: http://$DOMAIN/"
else
  echo "  Public: https://$DOMAIN/  (http redirects to https)"
fi
[[ "$TLS_MODE" == "selfsigned" ]] && echo "  Note:   self-signed cert — expect a browser warning"
echo
