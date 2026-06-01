# Oracle Cloud Always Free Deployment

This runbook deploys YBB Tally Bot to an **Oracle Cloud Infrastructure (OCI) Always Free** VM,
running in **long-polling mode** (no public endpoint, no domain, no TLS required).

The database stays on **Supabase** (unchanged). Only the Node process moves here.

---

## Why long polling

The bot picks its transport via `shouldUseWebhook()` in `src/utils/transportMode.ts`:

- `WEBHOOK_URL` set (in production/staging) → webhook mode (needs a public HTTPS endpoint).
- `WEBHOOK_URL` blank/unset → **long polling** (outbound HTTPS only; runs on any VM).

For a plain VM, leave `WEBHOOK_URL` blank. No inbound ports need to be opened.

---

## Phase A — Create the Oracle account (one-time)

1. Go to https://www.oracle.com/cloud/free/ and click **Start for free**.
2. Choose your **Home Region**: pick **Singapore (ap-singapore-1)**. This is permanent.
3. Provide a credit card for identity verification. **Always Free resources are not charged.**
   - Gotcha: if signup loops on "unable to verify," try a different card or browser, or retry later.

## Phase B — Create the VM instance

1. Console → ☰ → **Compute → Instances → Create instance**.
2. **Name:** `ybb-tally-bot`.
3. **Image:** Canonical **Ubuntu 22.04**.
4. **Shape:** click **Change shape**.
   - First try **Ampere (ARM): `VM.Standard.A1.Flex`**, set **1 OCPU / 6 GB**. (Always Free includes 4 OCPU / 24 GB of A1 total.)
   - If you see **"Out of capacity"** (common for A1), switch to **`VM.Standard.E2.1.Micro`** (AMD, 1 OCPU / 1 GB) — always available. Add swap (Phase D, step 2).
   - Either shape runs this bot. The Docker image supports both arm64 and x86_64.
5. **SSH keys:** choose **Generate a key pair for me** and **download the private key**, OR paste your own public key.
   - Save the private key locally, e.g. `~/.ssh/oracle_ybb`, then `chmod 600 ~/.ssh/oracle_ybb`.
6. **Networking:** keep the default VCN/subnet, **Assign a public IPv4 address = Yes**.
   - **Do NOT open any inbound ports.** Long polling is outbound-only.
7. Click **Create**. When it's running, copy the **Public IP address**.

**Verify (from your Mac):**
```bash
ssh -i ~/.ssh/oracle_ybb ubuntu@<PUBLIC_IP> 'echo ok && uname -m'
# expect: ok  +  aarch64 (A1) or x86_64 (E2)
```

---

## Phase C — Install Docker on the VM

SSH in, then:
```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io
sudo usermod -aG docker ubuntu
sudo systemctl enable --now docker
newgrp docker
```
**Verify:** `docker run --rm hello-world` prints a hello message.

---

## Phase D — Prepare the app + secrets

1. **Get the code:**
```bash
sudo mkdir -p /opt/ybb-tally-bot && sudo chown $USER:$USER /opt/ybb-tally-bot
cd /opt
git clone https://github.com/bryan-seto/ybb-tally-bot.git
cd ybb-tally-bot
```

2. **Add swap (mandatory on E2.1.Micro / 1 GB; harmless elsewhere):**
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h   # confirm 2.0Gi swap
```

3. **Create the env file** at `/opt/ybb-tally-bot/env.production`. Copy values **verbatim from the
   Railway dashboard** (Variables tab). See `.env.example` for the full required set. For long polling,
   leave `WEBHOOK_URL` blank:
```
NODE_ENV=production
# WEBHOOK_URL intentionally omitted -> long polling
DATABASE_URL=<Supabase prod URL from Railway>
TELEGRAM_BOT_TOKEN=*** from Railway>
GEMINI_API_KEY=<from Railway>
USER_A_ID=<from Railway>
USER_A_NAME=<from Railway>
USER_B_ID=<from Railway>
USER_B_NAME=<from Railway>
BACKUP_RECIPIENT_ID=<from Railway>
ALLOWED_USER_IDS=<from Railway>
GROQ_API_KEY=*** Railway, if set>
SENTRY_DSN=<from Railway, if set>
PORT=10000
```
Then lock it down: `chmod 600 /opt/ybb-tally-bot/env.production`

4. **Confirm DB schema is present** (same Supabase DB the prod bot uses; idempotent):
```bash
docker build -t ybb-tally-bot:latest .
docker run --rm --env-file env.production ybb-tally-bot:latest npx prisma migrate deploy
# expect: "No pending migrations to apply" (or it applies cleanly)
```

---

## Phase E — Run

```bash
cd /opt/ybb-tally-bot
bash deploy/oracle/run.sh
```
Watch the logs for:
```
💻 Running in PRODUCTION mode with LONG POLLING
Server listening on port 10000
```
**Verify (second SSH session):** `curl -s localhost:10000/health` → `{"status":"ok",...}`

---

## Cutover from Railway (ordering matters!)

A Telegram token allows only ONE active update consumer. To avoid a `409 Conflict`:

1. **Stop Railway FIRST** (dashboard → pause/remove deployment, or scale to 0). Wait ~30s.
2. **Start Oracle:** `bash deploy/oracle/run.sh`.
3. **Smoke test in Telegram:** message the bot; confirm replies; confirm the other authorized user works.
4. Check `docker logs ybb-tally-bot` for any `409 CONFLICT`.

---

## Verification

- **Reboot survival:** `sudo reboot`; after ~60s reconnect and `docker ps` shows `ybb-tally-bot` Up.
- **Cron jobs** (the whole point of always-on): recurring expenses fire **01:00** Asia/Singapore,
  DB backup **18:00**. After the next 18:00, confirm a backup message to `BACKUP_RECIPIENT_ID`, and:
  ```bash
  docker logs --since 24h ybb-tally-bot | grep -iE 'recurring|backup'
  ```

## Rollback

1. On the VM: `docker stop ybb-tally-bot`.
2. Railway dashboard → resume the deployment (it re-sets its webhook on boot).
3. Back on Railway within ~1 min. No data loss (shared Supabase DB).

## Decommission Railway

After 24–48h stable (including at least one 01:00 and one 18:00 cron), delete the Railway project to stop billing.

---

## Staging on the same VM (optional, recommended before cutover)

Run the **dev/test bot** (`@bryan_dev_tally_bot`, separate token) on the VM first, while the real
bot still runs on Railway untouched. Use a separate container + a throwaway Postgres with mock data:

```bash
# Throwaway Postgres with a persistent volume (mock data survives restarts)
docker run -d --name ybb-staging-db --restart=always \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=password -e POSTGRES_DB=ybb_tally_bot \
  -v ybb_staging_pgdata:/var/lib/postgresql/data \
  postgres:15-alpine

# env.staging: dev bot token, NODE_ENV=staging, no WEBHOOK_URL, DB points at the container
# DATABASE_URL=postgresql://postgres:***@<host>:5432/ybb_tally_bot?schema=public
docker build -t ybb-tally-bot:latest .
docker run -d --name ybb-tally-bot-staging --restart=always \
  --env-file /opt/ybb-tally-bot/env.staging \
  --network host \
  ybb-tally-bot:latest

# Seed mock data once:
docker exec -it ybb-tally-bot-staging npx tsx seed-staging.ts   # (or prisma db seed)
```
Then message `@bryan_dev_tally_bot` to validate the deployment before cutting the real bot over.
