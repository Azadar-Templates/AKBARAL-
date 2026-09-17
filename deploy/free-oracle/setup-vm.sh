#!/usr/bin/env bash
# AKBARAL! — Oracle Cloud Always Free VM bootstrap (Ubuntu 24.04 aarch64).
#
# Run ONCE on a fresh VM as a sudo-capable user:
#   curl -fsSL <repo>/deploy/free-oracle/setup-vm.sh | bash -s -- \
#     --repo https://github.com/Azadar-Templates/AKBARAL-.git --domain yourname.duckdns.org
#
# Idempotent: safe to re-run. Installs Docker + compose plugin, opens
# 22/80/443 in ufw, clones the repo, creates .env (generating a random
# SESSION_SECRET; NEVER stores secrets in Git), and starts the stack.
# It does NOT create accounts for you (Oracle/DuckDNS/Google are yours).
set -euo pipefail

REPO=""
DOMAIN=""
QUIET_SEED=false
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="${2:?}"; shift 2 ;;
    --domain) DOMAIN="${2:?}"; shift 2 ;;
    --seed) QUIET_SEED=true; shift ;;
    *) echo "unknown option: $1" >&2; exit 64 ;;
  esac
done
[ -n "$REPO" ] || { echo "usage: setup-vm.sh --repo <git-url> --domain <name.duckdns.org> [--seed]" >&2; exit 64; }
[ -n "$DOMAIN" ] || { echo "usage: setup-vm.sh --repo <git-url> --domain <name.duckdns.org> [--seed]" >&2; exit 64; }

echo "[setup] 1/5 — Docker Engine + compose plugin (skips if present)"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
sudo usermod -aG docker "$USER" || true
sudo systemctl enable --now docker

echo "[setup] 2/5 — Firewall (22 ssh, 80/443 web)"
sudo ufw allow 22/tcp  >/dev/null 2>&1 || true
sudo ufw allow 80/tcp  >/dev/null 2>&1 || true
sudo ufw allow 443/tcp >/dev/null 2>&1 || true
sudo ufw --force enable >/dev/null 2>&1 || true
# NOTE: also open 80/443 in the Oracle Cloud Security List for the VCN
# (Console → Networking → Virtual Cloud Networks → your VCN → Security
# Lists → Add Ingress Rules 0.0.0.0/0 TCP 80 and 443). ufw alone is not
# enough; Oracle filters before the OS sees traffic.

echo "[setup] 3/5 — Repository"
SRC="${AKBARAL_SRC_DIR:-$HOME/AKBARAL-}"
if [ -d "$SRC/.git" ]; then
  git -C "$SRC" fetch --all --prune
  git -C "$SRC" pull --ff-only || echo "[setup] WARNING: local changes in $SRC left untouched"
else
  git clone "$REPO" "$SRC"
fi

echo "[setup] 4/5 — .env (never committed; fill GOOGLE_API_KEY yourself)"
cd "$SRC"
if [ ! -f .env ]; then
  cp .env.example .env
  SECRET="$(head -c 48 /dev/urandom | base64 | tr -d '\n' )"
  # Replace the commented template with real values.
  sed -i "s|^# SESSION_SECRET=\"\"|SESSION_SECRET=\"$SECRET\"|" .env 2>/dev/null || true
  grep -q '^SESSION_SECRET=".."' .env || printf '\nSESSION_SECRET="%s"\n' "$SECRET" >> .env
  printf '\n# --- zero-cost launch values (set by setup-vm.sh) ---\nAKBARAL_DOMAIN="%s"\nAKBARAL_PUBLIC_WEB_URL="https://%s"\nTRUST_PROXY="1"\nCORS_ORIGINS="https://%s"\nNODE_ENV="production"\n' "$DOMAIN" "$DOMAIN" "$DOMAIN" >> .env
  # Apply the same values in the active (uncommented) section if present.
  sed -i "s|^AKBARAL_PUBLIC_WEB_URL=.*|AKBARAL_PUBLIC_WEB_URL=\"https://$DOMAIN\"|" .env
  sed -i "s|^TRUST_PROXY=.*|TRUST_PROXY=\"1\"|" .env
  sed -i "s|^CORS_ORIGINS=.*|CORS_ORIGINS=\"https://$DOMAIN\"|" .env
  sed -i "s|^NODE_ENV=.*|NODE_ENV=\"production\"|" .env
  echo "[setup] .env created. EDIT IT NOW: add GOOGLE_API_KEY=\"...\" (free from aistudio.google.com), then re-run this script or start the stack."
  exit 0
fi
if [ "$QUIET_SEED" = true ]; then
  sed -i 's|^SEED_DATABASE=.*|SEED_DATABASE="true"|' .env 2>/dev/null || true
fi

echo "[setup] 5/5 — Starting stack (build on this VM; first build takes a few minutes)"
docker compose -f deploy/free-oracle/docker-compose.free.yml --env-file .env up -d --build
if [ "$QUIET_SEED" = true ]; then
  sleep 5
  sed -i 's|^SEED_DATABASE=.*|SEED_DATABASE="false"|' .env 2>/dev/null || true
fi

echo
echo "[setup] DONE."
echo "  Health : curl -f https://$DOMAIN/api/health"
echo "  Ready  : curl -f https://$DOMAIN/api/ready   (after first boot)"
echo "  Logs   : docker compose -f deploy/free-oracle/docker-compose.free.yml logs -f"
echo "  Verify : https://$DOMAIN  — then run the P0 smoke checklist."
