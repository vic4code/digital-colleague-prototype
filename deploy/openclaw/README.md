# Ada event gateway (OpenClaw + Codex)

這個目錄提供一個**可選、鎖版本**的事件入口，讓 Gmail、Slack 與經過
轉接的 Notion／Outlook／Calendar 事件可以在沒有人開著前端聊天時喚醒
Ada。OpenClaw 管理 channel、webhook、session、delivery 與 audit；實際
agent turn 由 Codex app-server 執行。

OpenClaw 的 Codex harness 是 **OpenClaw 官方能力**，不是 OpenAI 對
OpenClaw 的背書。OpenAI 官方目前提供 Codex app-server、Scheduled Tasks
與 Workspace Agents Trigger API，但沒有一個可直接接收各 provider webhook
並把雙向回覆送回本機 Codex thread 的通用 gateway。

## 已落地的範圍

| 來源 | Repo 內已完成 | 啟用前仍需做 |
|---|---|---|
| Gmail | 官方 Gmail preset、安全 hook policy、Codex Gmail plugin | 在 host-native runtime 執行 Pub/Sub setup、完成 Google OAuth、提供公開 HTTPS push endpoint |
| Slack | 官方 HTTP channel patch、Slack 簽章驗證、user/channel allowlist | 建 Slack app、填入 stable IDs 與 secrets，再把 patch 的 `enabled` 改為 `true` |
| Notion | `/hooks/notion` 的 normalized receiver contract | 先捕捉 automation 實際 payload，再建立 exact property mapping 或 reviewed transform；一般 integration webhook 驗證不在此 profile 內 |
| Outlook Email/Calendar | `/hooks/outlook-*` 的 normalized receiver contract | 以 Power Automate／Logic Apps 轉送；嚴格 Microsoft Graph push 仍需驗證與續期 relay |
| Google Calendar | `/hooks/google-calendar` 的 normalized receiver contract | OpenClaw 目前無原生 Calendar push setup；先用 Scheduled Task，或另行審查 provider relay |

`openclaw.profile.json` 不保存 OAuth token，也不假裝上述 provider setup 已經
完成。所有被 native app metadata 標為 destructive 的 action 會被拒絕；背景
prompt／skill 另外禁止任何 provider write。事件 profile 還會逐項排除目前鎖版
OpenClaw 的 dynamic message、web、browser、session、agent、node 與 control-plane
tools。這不是對六個 provider 所有 write tool 的形式化證明；要宣稱
deterministic read-only，仍要逐一檢查 app inventory 的 tool annotation。

## 事件流

```text
provider event
  -> provider 驗證／官方 channel 或受控轉接
  -> OpenClaw Gateway（驗證、session、audit、wake）
  -> @openclaw/codex
  -> Codex app-server thread
  -> 明確列入 allowlist 的 Codex connector／skill
```

Connector 是 Ada 被叫醒後使用的工具；connector 本身不是事件來源。

## 安全預設

- 原生 profile 只綁 loopback。Docker 內為了 port mapping 以 `lan` bind 啟動，
  但 host 只 publish 到 `127.0.0.1`。Control UI 與 terminal 關閉。
- `Caddyfile` 只轉送 Slack 與四個固定 provider route；`/hooks/agent`、
  `/hooks/wake`、`/hooks/gmail` 和其他路徑一律 404。公開 tunnel 只能指向
  allowlist ingress port `18890`，不能指向 Gateway port `18889`。
- Gateway token 與 hook token 必須分開，且 query-string token 不可使用。
- 外部 hook 只能喚醒 `ada`。未設定 `defaultSessionKey` 時，OpenClaw 會為每次
  mapped hook 產生 `hook:*` session，因此 startup 要求 base `hook:` prefix；
  Gmail preset 另使用 `hook:gmail:*`。Caddy 不公開 `/hooks/agent`，固定 provider
  mapping 也不讀 payload 的 `sessionKey`，所以 public caller 不能藉此選 session。
- Gmail body 關閉，僅傳 headers 與 provider snippet；`maxBytes=4096` 只在未來
  啟用 body 時限制 text/plain body，不會限制 Gmail snippet。
- Event worker 設為 `tools.exec.mode=ask`，讓 Codex app-server 可以啟動，但任何
  未核准的 host exec 都必須由人批准；Codex sandbox 維持 `read-only`，且
  `codexDynamicToolsExclude` 另外移除 OpenClaw exec、process、file、PDF、message、
  browser、web、session/spawn、node 與 gateway tools。這個 unattended profile
  沒有人批准 exec，因此 shell 請求會 fail closed，而不是卡在啟動階段。
  Codex app-server child environment 也會移除 Gateway、hook、Slack 與 keyring
  secret。
- 不能用一般 `tools.profile` 或 `tools.allow/deny` 取代上述 harness-specific
  排除：OpenClaw `v2026.7.1` 會把 restricted tool policy 視為 Codex native tool
  surface restriction，連 native connector app config 一併停用。
- 所有 Codex connector 的 `allow_destructive_actions` 都是 `false`；這會
  deterministic decline 被 app metadata 標記為 destructive 的 action。
- OTEL content capture 關閉，但 OpenClaw transcript mirror 與 Codex thread
  仍會落盤。Profile 將 session cleanup 設為 7 天／500 entries；state 目錄仍應
  使用 0700 權限、加密磁碟與受控備份。
- Provider delivery 是 at-least-once；目前 generic mapped hooks 沒有 durable
  dedupe。重送可能產生第二個 Codex turn 與 token 成本，外部 relay 若有副作用
  必須先以 provider event id 做 durable dedupe。
- `computer-use.local.patch.json` 只適用於有人登入的本機 macOS session；
  patch 會同時關閉 hooks 與 Slack channel，不套到無桌面的 Docker／server
  event worker。

## macOS / Windows 原生設定

OpenClaw `2026.7.1` 要求 Node `>=22.22.3 <23`、`>=24.15 <25` 或 `>=25.9`。
這台機器的 system Node `24.5.0` 不符合；可先切到已安裝的 Node `22.22.3`，
再鎖定安裝：

```bash
nvm use 22.22.3
npm install --global openclaw@2026.7.1
```

不要直接覆蓋既有的 `~/.openclaw`。只設定 `OPENCLAW_STATE_DIR` 還不夠：
OpenClaw `2026.7.1` 仍會從有效 home 尋找 legacy `exec-approvals.json` 並搬移它。
因此先保存原本 home，再同時隔離 `OPENCLAW_HOME` 與 state：

```bash
USER_HOME="$HOME"
mkdir -p .state/openclaw .state/openclaw-home/.config/openclaw
chmod 700 .state/openclaw .state/openclaw-home \
  .state/openclaw-home/.config .state/openclaw-home/.config/openclaw
cp deploy/openclaw/openclaw.profile.json .state/openclaw/openclaw.json
chmod 600 .state/openclaw/openclaw.json

export OPENCLAW_HOME="$PWD/.state/openclaw-home"
export OPENCLAW_STATE_DIR="$PWD/.state/openclaw"
export OPENCLAW_CONFIG_PATH="$PWD/.state/openclaw/openclaw.json"
export OPENCLAW_ADA_WORKSPACE="$PWD/colleagues/ada"
export DIGITAL_COLLEAGUE_REPO_ROOT="$PWD"
export OPENCLAW_GATEWAY_TOKEN="$(openssl rand -hex 32)"
export OPENCLAW_HOOK_TOKEN="$(openssl rand -hex 32)"

openclaw plugins install @openclaw/codex@2026.7.1
openclaw plugins install @openclaw/slack@2026.7.1
openclaw config validate
openclaw doctor
openclaw models auth login --provider openai
```

若第一個 hook run 回報 `Missing optional dependency @openai/codex-<platform>`，
代表 Codex plugin 的平台 binary 未完整安裝；先移除任何 npm `omit=optional`
設定並重裝同一鎖版 plugin，通過 `/codex status` 前不可把 receiver 標成 ready。

PowerShell 先以 `$userHome = $HOME` 保存原值，再用相同變數名稱及
`$env:NAME = "value"` 設定，特別是 `$env:OPENCLAW_HOME`；兩個 token 可用
PowerShell 的安全亂數產生器建立，並用 Windows ACL 限制 state 只讓目前帳號
讀寫。`18889` 是本 repo 的隔離測試 port，避免撞到既有 OpenClaw 預設
`18789`。

Profile 裡列出 connector 只代表 admitted，不代表 installed、OAuth-connected
或 accessible。`homeScope: agent` 不會重用目前 `~/.codex`；啟動前必須用同一
組 state 跑 migration/readiness gate。因為已審查 profile 先宣告六個 target
plugins，migration 必須使用 `--overwrite` 才能安裝 bundle；但 migration 會暫時
把 global destructive policy 寫成 `true`，所以完成後一定要再次覆蓋回本 repo
profile。不要加 `--yes`：非互動模式會預設選取來源 Codex 的所有 planned
skills。

```bash
openclaw migrate codex --dry-run --verify-plugin-apps --no-auth-credentials \
  --overwrite --from "$USER_HOME/.codex" \
  --plugin gmail --plugin google-calendar \
  --plugin outlook-email --plugin outlook-calendar \
  --plugin slack --plugin notion
openclaw migrate apply codex --verify-plugin-apps --no-auth-credentials \
  --overwrite --from "$USER_HOME/.codex" \
  --plugin gmail --plugin google-calendar \
  --plugin outlook-email --plugin outlook-calendar \
  --plugin slack --plugin notion

# 在互動式 skill 選單選 `Toggle all off`，只安裝上面六個 plugins。
# migration 完成後再次覆蓋已審查 profile，收回 destructive policy。
cp deploy/openclaw/openclaw.profile.json .state/openclaw/openclaw.json
chmod 600 .state/openclaw/openclaw.json
openclaw config validate

openclaw gateway --port 18889
```

在 Ada 的 owner-only chat 檢查 `/status`、`/codex status`、
`/codex plugins list`，再對六個 app 各做一次 bounded read probe。任何 app
顯示 missing、disabled、auth_required 或 inaccessible 都不算接通。

若要在**另一個本機互動 state** 重用目前 `~/.codex` 的登入、plugins 與
Computer Use，先審查 patch，再執行：

```bash
openclaw config patch --file deploy/openclaw/computer-use.local.patch.json --dry-run
openclaw config patch --file deploy/openclaw/computer-use.local.patch.json
```

這會把 `homeScope` 改成 `user`、允許互動式 exec，並關閉所有 webhook 與
Slack ingress。不要把它套到 unattended event worker，也不要同時從 Codex
Desktop／CLI 與 OpenClaw 寫入同一個 native Codex thread；需要共存時請 fork
thread。

## Gmail：官方 Pub/Sub setup

這個版本的正確指令不是 `openclaw gmail watch`。Gmail 有兩段不同 endpoint：
Pub/Sub 打 `gog watch serve` 的 push endpoint；gog 再打本機 OpenClaw hook。
Tailscale Funnel 路徑可讓 wizard 管 push endpoint：

```bash
export ADA_GMAIL_ACCOUNT="ada@example.com"
openclaw webhooks gmail setup \
  --account "$ADA_GMAIL_ACCOUNT" \
  --hook-url http://127.0.0.1:18889/hooks/gmail

# setup 預設會開 body；完成後重新鎖回 metadata/snippet-only。
openclaw config set hooks.gmail.includeBody false
openclaw config set hooks.gmail.maxBytes 4096
openclaw config set hooks.gmail.renewEveryMinutes 720
```

Gateway 在 `hooks.gmail.account` 存在時會自行監督 `gog gmail watch serve` 與
watch 續期；不要再啟動第二個 watcher。開發可用 Tailscale Funnel 或其他
HTTPS tunnel，24/7 則應放在常駐主機。

若不用 Tailscale，兩個 URL 必須明確分開：

```bash
openclaw webhooks gmail setup \
  --account "$ADA_GMAIL_ACCOUNT" \
  --tailscale off \
  --push-endpoint https://YOUR_PUBLIC_HOST/gmail-pubsub \
  --hook-url http://127.0.0.1:18889/hooks/gmail \
  --bind 127.0.0.1 --port 8788 --path /gmail-pubsub
```

此時 reverse proxy 只把 public `/gmail-pubsub` 送到 watcher `127.0.0.1:8788`；
不要把 Pub/Sub 直接指到 `/hooks/gmail`。Pub/Sub 可能重送通知，本 profile
沒有 durable dedupe。

## Slack：官方 HTTP Events channel

1. 在 `slack-http.patch.json` 用真實的 Slack `U...` 與 `C...` stable IDs
   取代拒絕所有人的 placeholder。
2. 填好 `SLACK_BOT_TOKEN`、`SLACK_SIGNING_SECRET`。
3. 把 `enabled` 改為 `true`，再執行：

```bash
openclaw config patch --file deploy/openclaw/slack-http.patch.json --dry-run
openclaw config patch --file deploy/openclaw/slack-http.patch.json
```

Slack app 的 Event Request URL 設為
`https://YOUR_PUBLIC_HOST/slack/events`。OpenClaw 會用 signing secret 驗章，
channel 僅允許列出的 ID，群組預設必須 `@mention`。

本機如果不要求 literal HTTP webhook，可把 mode 改為 Socket Mode，避免公開
URL；事件仍會主動喚醒 Ada。

## Notion / Outlook / Calendar normalized payload

通用 mapping 接受 normalized 最少欄位，不接受 caller 指定 agent 或任意
session；每次非 Gmail hook 會建立隔離 session：

```json
{
  "eventId": "provider-stable-event-id",
  "itemId": "provider-item-id",
  "pageId": "notion-page-id-when-applicable",
  "changeType": "created|updated|deleted",
  "type": "provider-event-type"
}
```

Sender 必須加上 `Authorization: Bearer <OPENCLAW_HOOK_TOKEN>` 或
`x-openclaw-token`。Notion database automation 可以送自訂 header；但 Notion
不保證原始 automation payload 就有 top-level `eventId/pageId/type`，
也無法 preview payload。啟用前先用測試接收器捕捉實際 JSON，確認能選出 exact
property keys；否則加 reviewed transform/relay。一般 Notion integration webhook
還需要 verification token 與簽章驗證，不能直接套此 contract。

Outlook 可用 Power Automate／Logic Apps 將 Office 365 trigger 正規化成上述
payload，但不保證 strict webhook latency，極少數事件可能延遲；不要選已
deprecated 的舊 email webhook trigger。

Microsoft Graph subscription 不能只把 callback URL 指到 generic hook 就算
完成，因為它還要求 validation challenge、notification validation 與
subscription renewal。若需求是嚴格 Graph push latency，應新增一個獨立、
可審查的 adapter，而不是把驗證塞進 prompt。

Google Calendar 原生 push 只有 notification headers，不會直接附上本 contract
的 JSON `itemId`，也無法直接帶 OpenClaw bearer；因此一定要有 reviewed relay
或退回 Scheduled Task。

## 手動 wake smoke test

Gateway 與 allowlist ingress 啟動後，可先用不含敏感內容的假事件驗證
hook -> Codex。Docker 使用 `18890`；原生部署可另行啟動 Caddy：

```bash
OPENCLAW_INTERNAL_PORT=18889 caddy run --config deploy/openclaw/Caddyfile
```

```bash
curl -i http://127.0.0.1:18890/hooks/notion \
  -H "Authorization: Bearer $OPENCLAW_HOOK_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"eventId":"smoke-1","pageId":"page-does-not-exist","type":"smoke"}'
```

再確認 `POST http://127.0.0.1:18890/hooks/agent` 與 `/hooks/wake` 都回 404。
未授權固定 route 應被 Gateway 拒絕；相同 event 可能產生重複 turn，不能把它
當作 dedupe 成功。最後確認 audit 出現 run metadata、Codex runtime 顯示為
Codex 而不是 fallback，再執行：

```bash
openclaw security audit
openclaw doctor
```

這個 profile 的 audit 預期仍會提示 `allowRequestSessionKey=true` 與未設定
`defaultSessionKey`：前者是 Gmail preset 的 per-message session 所需，後者讓
非 Gmail mapped hook 每次使用隔離 session。`hook:` base prefix 是 OpenClaw
generated session 的啟動要求；風險由固定 route、mapping 不接受 sessionKey 與
Caddy 不公開 `/hooks/agent`／`/hooks/gmail` 來收斂；若看到任何 critical，或
公開 ingress 能打到 generic route，就不可上線。安裝 Codex／Slack plugin 後，
audit 也可能因未使用一般 `tools.allow/deny` 而提示 plugin tools policy；這是為了
保留 Codex native app config 的已知限制，必須再確認 `codexDynamicToolsExclude`
完整排除鎖版的 OpenClaw 動態工具，而且 Slack plugin inventory 沒有 agent tool。

## Docker

Docker profile 將 OpenClaw 與 Caddy 鎖到 immutable multi-arch digest、使用
非 root image user、drop capabilities、`no-new-privileges`，而且不掛 Docker
socket。Container 只會唯讀掛入 `colleagues/ada` 與單一 safety-boundary
resource，不會把包含 `deploy/openclaw/.env` 的整個 repo 暴露給 app-server；
OpenClaw state/plugin state 放在 `.state/openclaw`，OAuth encryption key 另放
`.state/openclaw-home/.config/openclaw`。這些目錄都必須備份且權限設為 0700。

Docker bootstrap 的固定順序是：建立 state → 安裝 channel plugin → model
OAuth → connector migration → 重套 hardened profile → validate/readiness → 才
啟動 public ingress。這些步驟不能用 profile 裡的 allowlist 取代。

以下 bootstrap 是 POSIX shell 流程。Windows Docker Desktop 必須從 WSL 2
執行（不要直接貼到 PowerShell）；WSL path 可避免 Windows drive-letter bind
mount 的解析差異。macOS／Linux／WSL 都要讓 Gateway 與 CLI 使用目前 host
UID/GID，否則權限 0700 的 state 與 migration snapshot 可能對 container UID 1000
不可讀寫。將同一組數值保存在 `deploy/openclaw/.env`，之後重啟也要沿用。

```bash
set -euo pipefail

if [ ! -f deploy/openclaw/.env ]; then
  cp deploy/openclaw/.env.example deploy/openclaw/.env
fi
# 先在 .env 填入兩個不同的 32-byte token，並把 UID/GID 改成以下輸出。
export OPENCLAW_UID="$(id -u)"
export OPENCLAW_GID="$(id -g)"
mkdir -p .state/openclaw .state/openclaw-home/.config/openclaw
chmod 700 .state/openclaw .state/openclaw-home \
  .state/openclaw-home/.config .state/openclaw-home/.config/openclaw
cp deploy/openclaw/openclaw.profile.json .state/openclaw/openclaw.json
chmod 600 .state/openclaw/openclaw.json

# 官方 image 已 bundled Codex；只安裝外部 Slack channel plugin。
docker compose --env-file deploy/openclaw/.env \
  -f deploy/openclaw/compose.yaml run --rm --no-deps \
  --entrypoint node openclaw-gateway \
  dist/index.js plugins install @openclaw/slack@2026.7.1

# 在持久化 state/auth-secret mounts 內完成 Codex model OAuth。
docker compose --env-file deploy/openclaw/.env \
  -f deploy/openclaw/compose.yaml run --rm --no-deps \
  --entrypoint node openclaw-gateway \
  dist/index.js models auth login --provider openai

# Codex app-server 啟動時必須在 source home 初始化 SQLite，所以不能把原本
# ~/.codex 直接唯讀掛入，也絕不能把原本 home 變成可寫。建立權限 0700、
# 可寫但一次性的敏感快照；即使指令失敗，trap 也會刪除它。
umask 077
MIGRATION_SOURCE="$(mktemp -d "$PWD/.state/codex-migration-source.XXXXXX")"
trap 'rm -rf -- "$MIGRATION_SOURCE"' EXIT HUP INT TERM
cp -R "$HOME/.codex/." "$MIGRATION_SOURCE/"
chmod -R go-rwx "$MIGRATION_SOURCE"

# 不要加 --yes；在 skill 選單選 Toggle all off。
docker compose --env-file deploy/openclaw/.env \
  -f deploy/openclaw/compose.yaml run --rm --no-deps \
  -v "$MIGRATION_SOURCE:/source-codex:rw" \
  --entrypoint node openclaw-gateway \
  dist/index.js migrate codex --dry-run --verify-plugin-apps \
  --no-auth-credentials --overwrite --from /source-codex \
  --plugin gmail --plugin google-calendar \
  --plugin outlook-email --plugin outlook-calendar \
  --plugin slack --plugin notion

docker compose --env-file deploy/openclaw/.env \
  -f deploy/openclaw/compose.yaml run --rm --no-deps \
  -v "$MIGRATION_SOURCE:/source-codex:rw" \
  --entrypoint node openclaw-gateway \
  dist/index.js migrate apply codex --verify-plugin-apps \
  --no-auth-credentials --overwrite --from /source-codex \
  --plugin gmail --plugin google-calendar \
  --plugin outlook-email --plugin outlook-calendar \
  --plugin slack --plugin notion

rm -rf -- "$MIGRATION_SOURCE"
trap - EXIT HUP INT TERM
unset MIGRATION_SOURCE

# migration 完成後再次覆蓋已審查 profile，再由同一 image 驗證。
cp deploy/openclaw/openclaw.profile.json .state/openclaw/openclaw.json
chmod 600 .state/openclaw/openclaw.json
docker compose --env-file deploy/openclaw/.env \
  -f deploy/openclaw/compose.yaml run --rm --no-deps \
  --entrypoint node openclaw-gateway dist/index.js config validate

# 先只啟動 loopback Gateway，完成 /codex status、plugin list 與六個 read probes。
docker compose --env-file deploy/openclaw/.env \
  -f deploy/openclaw/compose.yaml up -d openclaw-gateway
# 全部 ready 後才開固定路徑 ingress。
docker compose --env-file deploy/openclaw/.env \
  -f deploy/openclaw/compose.yaml up -d event-ingress
```

Public tunnel／reverse proxy 只能指到 host `127.0.0.1:18890`；`18889` 是本機
operator control plane。Docker 是無桌面 event worker，不套 Computer Use patch。

重要限制：OpenClaw `2026.7.1` 官方 image 沒有 `gog`、`gcloud` 或 Tailscale，
所以這份 stock Compose **不宣稱 Gmail watcher 可用**。Gmail 先使用上面的
host-native OpenClaw setup；若一定要容器化，需另做鎖版、跨架構、可審查的
image/sidecar 並驗證 watcher renewal，不能只開 8788 port 假裝完成。Slack 與
normalized fixed hooks 不受此限制。

Container replacement 只在 `.state/openclaw` 與
`.state/openclaw-home/.config/openclaw` 都保存且可還原時才保證 OpenClaw OAuth
可解密。Codex native app readiness gate 仍要在同一份 state 上完成；allowlist
不等於 OAuth 已連接。Migration snapshot 會包含敏感 OAuth/state，雖然位於已被
gitignore 的 `.state/`，仍必須以 0700 保護並在成功或失敗後立刻刪除；不要把
原本 `~/.codex` 直接可寫掛載來繞過保護。

## 官方來源

- OpenAI Workspace Agents trigger:
  https://developers.openai.com/workspace-agents/trigger-runs
- OpenAI Codex app-server:
  https://learn.chatgpt.com/docs/app-server
- OpenAI Scheduled Tasks:
  https://learn.chatgpt.com/docs/automations
- OpenClaw `v2026.7.1` Codex harness:
  https://github.com/openclaw/openclaw/blob/v2026.7.1/docs/plugins/codex-harness.md
- OpenClaw `v2026.7.1` Gmail webhooks:
  https://github.com/openclaw/openclaw/blob/v2026.7.1/docs/cli/webhooks.md
- OpenClaw `v2026.7.1` Slack channel:
  https://github.com/openclaw/openclaw/blob/v2026.7.1/docs/channels/slack.md
- OpenClaw `v2026.7.1` generic webhooks:
  https://github.com/openclaw/openclaw/blob/v2026.7.1/docs/automation/webhook.md
