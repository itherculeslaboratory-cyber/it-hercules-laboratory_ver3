---
id: V3-DOC-OPS-RUNBOOK
title: 運用ランブック — VPS/HTTPS/本番 R2/cutover 手順
date: "2026-07-11"
status: active
requirement_ids: [V3-CST-05, V3-FND-11]
---

# 運用ランブック（V3-CST-05）

> 本番インフラの手動運用手順。**本書のすべての実行手順は人間ゲート**（不変条項④・AGENTS.md
> §人間ゲート 5 種: 公開の実施・実鍵/本番鍵の投入・金銭・物理治具・撤回台帳の復活）。
> AI/自律ランは本書を**書く**（可逆・docs）ことはできるが、ここに書かれた**実行（デプロイ/
> cutover/実鍵投入）は行わない**。実施は運用者が本書の手順に従い手動で行う。
> 設定の「型」は `.env.platform.example`（管理者/インフラ）・`.env.local.example`（ユーザー）を参照。

## 0. 前提と原則

- 一次配信は Cloudflare Workers/Pages/R2（`apps/api` = Workers・`apps/web` = Pages・Truth = R2
  append-only）。VPS は補助（長時間バッチ・collector リレー・staging プレビュー）の位置づけ。
- **常駐 DB を SSOT にしない**（不変条項①）。VPS 上でも Postgres/MySQL 等の常駐 SSOT は置かない。
  派生値は都度再計算し、正本は R2（append-only）に置く。
- 実値は VPS の `/etc/ihl/.env.platform`（管理者）と各ユーザーの `.env.local`（ローカル）で管理し、
  リポジトリには型（`*.example`）のみ。`.env` 実体は `.gitignore` 済。

## 1. VPS 初期構築 / 再構築（人間ゲート・手動）

> クリーン VPS からの再構築手順。root もしくは sudo 権限で実行する。

```bash
# 1-1. 基本パッケージ
sudo apt-get update && sudo apt-get install -y nginx certbot python3-certbot-nginx curl git

# 1-2. Node LTS（pm2 実行用）と pm2
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2

# 1-3. リポジトリ取得（単一 clone・不変条項②）
sudo mkdir -p /opt/ihl && sudo chown "$USER" /opt/ihl
git clone https://github.com/it-hercules-laboratory/ihl-ver3.git /opt/ihl
cd /opt/ihl && npm ci

# 1-4. 環境ファイル配置（実値の投入 = 人間ゲート）
sudo install -m 600 -o root -g root /dev/null /etc/ihl/.env.platform
sudo "$EDITOR" /etc/ihl/.env.platform   # .env.platform.example の型を実値で埋める
```

## 2. HTTPS（nginx + certbot・人間ゲート・手動）

> リバースプロキシと TLS 証明書。ドメインは `it-hercules.uk`。

```bash
# 2-1. nginx サーバブロック（例: staging プレビュー / collector リレー）
sudo tee /etc/nginx/sites-available/ihl.conf >/dev/null <<'NGINX'
server {
    server_name staging.it-hercules.uk;
    location / {
        proxy_pass http://127.0.0.1:8787;   # pm2 が管理するローカルプロセス
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINX
sudo ln -sf /etc/nginx/sites-available/ihl.conf /etc/nginx/sites-enabled/ihl.conf
sudo nginx -t && sudo systemctl reload nginx

# 2-2. TLS 証明書（Let's Encrypt）。自動更新は certbot.timer が担う。
sudo certbot --nginx -d staging.it-hercules.uk
sudo certbot renew --dry-run   # 更新経路の確認
```

**CORS/プロキシ注意（V3-FND-11）**: 本番 502/504 は nginx（プロキシ層）が生成するため、API が
付与する CORS ヘッダが載らない場合がある。`proxy_set_header` と `add_header` を**削らない**こと。
API 側は 401/500 を含む全応答に CORS ヘッダを付与する実装（`apps/api/src/index.ts` の
middleware + onError）で、プロキシ層はそれを素通しする設定を維持する。

## 3. プロセス管理（pm2・人間ゲート・手動）

```bash
# 3-1. 起動（環境ファイルを読み込ませて起動）
cd /opt/ihl
pm2 start "npm run start --workspace apps/api" --name ihl-api \
    --env-file /etc/ihl/.env.platform

# 3-2. 再起動時の自動復帰
pm2 save
pm2 startup systemd    # 出力されたコマンドを sudo で 1 回実行

# 3-3. 運用
pm2 status
pm2 logs ihl-api --lines 100
pm2 reload ihl-api     # ゼロダウンタイム再読込
```

## 4. 本番 R2 のシード（人間ゲート・手動・金銭/公開に準ずる）

> 本番 Truth バケットは append-only（不変条項③: INSERT ONLY・UPDATE/DELETE 禁止）。
> **空バケットの作成は可逆だが、本番データの投入 = 実運用開始**であり人間ゲート。

```bash
# 4-1. 本番バケット作成（未作成時のみ・空作成は可逆）
npx wrangler r2 bucket create ihl-ver3-truth-prod

# 4-2. wrangler.toml の binding を prod バケットへ向ける（cutover 時のみ・§5 参照）
#      本番シードの実投入は運用者が手動で 1 回だけ行う。put-if-absent により
#      同一キー再投入は 409（冪等）。UPDATE/DELETE は storage 層で拒否される。
```

シード投入前チェック（運用者が手動確認）:

- [ ] `GMO_CONNECTOR_MODE` が意図どおり（本番入金なら `live`・金銭 = 人間ゲート）
- [ ] `SESSION_SECRET` が本番用の 32+ byte ランダム値（開発値の流用禁止）
- [ ] `CORS_ALLOW_ORIGINS` に本番 origin が含まれる（`*` 不可・cookie 認証）
- [ ] `IHL_AI_PROVIDER` が未設定 = AI_DISABLED（実鍵投入時のみ人間ゲート）

## 5. 本番 cutover（人間ゲート・手動・公開の実施）

> DNS/route 切替・Pages 本番デプロイ・apps/web 直叩き URL の本番切替は cutover（C6/人間ゲート）。
> 本手順は運用者が段階実行する。各段は可逆な rollback 経路を持つ。

1. **staging 検証**: staging origin で E2E（`npm run e2e`）green を確認。
2. **本番 Workers デプロイ**: `npx wrangler deploy`（`apps/api`）。
3. **本番 Pages デプロイ**: `apps/web` を Pages プロジェクトへデプロイ。`.next` / Pages edge
   キャッシュを明示パージ（古い CORS/URL が残らないよう）。
4. **DNS 切替**: Cloudflare ダッシュボードで本番ドメインを新 Workers/Pages route へ向ける。
5. **検証**: 本番 origin から 200/401/500/OPTIONS の各応答に CORS ヘッダが載ることを確認
   （V3-FND-11・§2 のプロキシ注意）。
6. **rollback**: 異常時は DNS を旧 route へ戻す（可逆）。Truth は append-only のため
   データ巻き戻しは行わず、修正は新 record/snapshot で表現する（不変条項③）。

## 6. 日常運用（可逆・自動化可）

- ログ: `pm2 logs` / Cloudflare Workers の tail（`npx wrangler tail`）。
- 月次経済 cron: `wrangler.toml` の `[triggers] crons`（`handleScheduled`）。デプロイ =
  実行開始 = 常駐トークン消費 = 人間ゲート（承認 artifact = `config/consented-crons.json`）。
- 証明書更新: `certbot.timer`（自動）。手動確認は `sudo certbot renew --dry-run`。
- lint/GATE: `npm run lint`（filename・生成物・schema・frontmatter・secrets 等の機械 GATE）。

## 7. トラブルシュート早見

| 症状 | 一次切り分け |
|------|--------------|
| ブラウザで CORS エラー | origin が `CORS_ALLOW_ORIGINS` に含まれるか / プロキシが `add_header` を削っていないか（§2） |
| 502/504 | pm2 プロセス生存（`pm2 status`）/ nginx `proxy_pass` の先ポート一致 |
| メール届かない | `RESEND_API_KEY` 有効性 / 送信ドメイン DNS（SPF/DKIM）検証状況 |
| ingest 401 | collector の `COLLECTOR_ID` と API の `COLLECTOR_PUBLIC_KEYS` キー一致 / 署名鍵ペア整合 |
| 証明書期限切れ | `sudo certbot renew` / `certbot.timer` の稼働（`systemctl status certbot.timer`） |
