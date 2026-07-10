---
source: "docs/planning/ver3/b2/research-smtp-secrets-migration-v1.md@4a56cf6"
id: B2-RES-SMTP-SECRETS-v1
title: SMTP シークレット管理移行提案（マジックリンク送信経路 + 鍵保管 + ローテーション）
date: 2026-07-10
status: draft
decision: "送信は Resend（無料枠 3,000通/月・独自ドメイン it-hercules.uk + SPF/DKIM/DMARC）に移行し、鍵は API キー 1 本に集約。保管は「いま=.env.platform(chmod 600) 継続 + rotation playbook に SMTP 節追記」「ver3 新repo=systemd LoadCredential 化」「ver4=Workers secret + HTTPS API 直送信（VPS の SMTP 薄常駐前提の再裁定を人間ゲートに付議）」の3段。実鍵投入は人間ゲート。"
sources_count: 15
revalidate_before_impl: true
---

# SMTP シークレット管理移行提案 v1（Phase B2 deep-research）

> 調査日: 2026-07-10。本書は**提案のみ**。鍵の実投入・DNS 変更・プロバイダ契約はすべて人間ゲート（V3-AUT-04）。移行作業は本書とは**別コミット**で、手順を runbook に記載してから行う。

## 1. 結論（選定）

マジックリンク送信のプロバイダを **Resend** に選定する（無料枠 3,000 通/月・100 通/日、独自ドメイン 1 つ、クレカ不要）。Resend は **SMTP インターフェース**（`smtp.resend.com`、ユーザー名固定 `resend`、パスワード = API キー）を提供するため、現行 `libs/ihl/identity/magic_link_mail.py`（stdlib smtplib）は**コード変更ゼロ**で移行できる。シークレットは Gmail アプリパスワード（アカウント全体に波及・Google 側の一方的規約変更リスクあり）から **用途限定の Resend API キー 1 本**に置き換え、保管は 3 段で移行する: (a) いま = VPS `.env.platform`（chmod 600）のまま値だけ差し替え + `secrets-rotation-playbook.md` に SMTP 節を追記して穴を塞ぐ、(b) ver3 新 repo で VPS を組み直す時 = systemd `LoadCredential` でファイル渡しに昇格、(c) ver4 Workers 化後 = `wrangler secret put RESEND_API_KEY` で Workers secret に置き、Workers から HTTPS API 直送信（この場合 VPS の「SMTP 薄常駐」が不要になるため、ver4 合意の該当条項の改訂を人間ゲートに付議する）。送信ドメインは `it-hercules.uk` サブドメイン（例: `send.it-hercules.uk`）に SPF/DKIM/DMARC を設定する — Gmail 宛は 2024-02 以降 SPF または DKIM が全送信者の必須要件。

## 2. 根拠（出典付き・web 5 件以上）

1. **Gmail アプリパスワード方式は継続リスクが高い（現行 example の示唆する方式）** — Google は 2025-05-01 に Less Secure Apps を全面停止し、Workspace ではパスワード式 SMTP 認証自体が廃止された。個人 Gmail のアプリパスワードは残るが「パスワード式の最後の経路」であり、送信上限 500 通/日・rolling 24h・行動ベースの不可視ブロックも報告されている。認証基盤の唯一経路（V3-AUT-01: マジックリンクのみ）を Google の一方的判断に依存させるのは不適。
   出典: https://serversmtp.com/limits-of-gmail-smtp-server/ ・ https://prospeo.io/s/gmail-smtp-limits
2. **Resend の無料枠は用途に十分で恒久** — 無料: 3,000 通/月・100 通/日・独自ドメイン 1 つ（トライアルではない）。一人運用のマジックリンク（1 ユーザー・ログイン時のみ）は月数十通規模であり、コスト最小(不変条項①)に合致。有料化しても Pro $20/月。
   出典: https://resend.com/pricing ・ https://resend.com/blog/new-free-tier
3. **Resend は SMTP インターフェースを持ち、現行実装がコード変更ゼロで動く** — `smtp.resend.com`（port 465/587 ほか）、username 固定 `resend`、password に API キー。現行の env 名（SMTP_HOST/PORT/USER/PASS）にそのまま入る: `libs/ihl/identity/magic_link_mail.py:31-39`（SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS を読む stdlib 実装）、`.env.platform.example:20-30`（同名の env テンプレート）。
   出典: https://resend.com/docs/send-with-smtp
4. **SendGrid 無料枠は 2025-07 に廃止済み、SES 無料枠も縮小** — SendGrid は 2025-05-27 告知で Free Plan を終了（2025-07-26 に送信停止）。Amazon SES は $0.10/1,000 通と最安だが、無料枠は 62,000 通/月から「新規顧客 3,000 通/月・12 ヶ月限定」に縮小され、AWS アカウント/IAM/サンドボックス解除申請の運用コストが一人運用に重い。
   出典: https://www.twilio.com/en-us/changelog/sendgrid-free-plan ・ https://aws.amazon.com/ses/pricing/
5. **Gmail 宛到達性には SPF または DKIM が必須（2024-02〜全送信者要件）** — 独自ドメイン送信では SPF/DKIM 認証・有効な PTR・TLS 送信・spam 率 0.3% 未満が Google の送信者ガイドライン要件。Resend 等の API プロバイダはドメイン検証フローで SPF/DKIM の DNS レコードを発行するため、`it-hercules.uk`（Cloudflare DNS 管理下）に貼るだけで満たせる。DMARC は p=none から開始で可（5,000 通/日未満はバルク送信者要件の対象外）。
   出典: https://support.google.com/a/answer/81126 ・ https://dmarcwise.io/blog/gmail-yahoo-new-requirements-2024
6. **Cloudflare Email Service（送信）はまだ Beta かつ Workers Paid 限定** — 任意宛先への送信（Email Sending）は Beta で Workers Paid プランが必要。無料で送れるのは「自アカウントの検証済み宛先」のみ。将来の ver4 候補にはなるが、2026-07 時点で認証メールの唯一経路を Beta に載せるのは不適。
   出典: https://developers.cloudflare.com/email-service/ ・ https://developers.cloudflare.com/email-routing/email-workers/send-email-workers/
7. **env 平文よりファイル渡し（systemd LoadCredential）が安全** — env は子プロセスに継承され `/proc/<pid>/environ` や `systemctl show` で露出しうる。LoadCredential は対象サービスのみが読める in-memory のファイルとして渡し、swap にも載らない。VPS を systemd unit で組み直すタイミングでの昇格先として妥当。
   出典: https://systemd.io/CREDENTIALS/ ・ https://dev.to/lyraalishaikh/stop-using-env-for-linux-services-safer-secrets-with-systemd-credentials-5hco
8. **API キー方式はローテーションが 3 段手順（追加→grace→失効）に素直に載る** — Resend はキーを複数発行できるため「新キー発行→VPS/Workers に配備→旧キー失効」が無停止で回る。Gmail アプリパスワードはアカウント側 2FA 設定と結合しており、この 3 段が組めない。既存 playbook の共通原則（`05-運用/runbooks/secrets-rotation-playbook.md:17`「新鍵を追加→両対応期間→旧鍵を失効」）にそのまま適合し、現在 SMTP が対象外である穴（同 playbook:5 は JWT/VAPID/GMO/SwitchBot/R2 のみ）を塞げる。
   出典: https://resend.com/docs/send-with-cloudflare-workers （API キーを env/secret から読む前提の公式手順）
9. **HTTPS API 方式なら Workers から直接送信可能** — Workers は外向き SMTP(25/465/587) を張れないが、`fetch()` で Resend API に POST するのは公式チュートリアルがある標準構成。つまり ver4 で「実メール経路のために VPS 薄常駐が必須」という前提（`docs/ver4-infra-agreement.md:102`「Workers のみで SMTP 送信まで完結させ VPS をゼロにする構成は禁止」）は、**SMTP プロトコル前提の記述**であり、メール API 経由なら「実メール経路の欠落」は起きない。合意の趣旨（経路欠落防止）は満たしつつ条文の改訂余地がある — ただし合意変更は人間ゲート。
   出典: https://developers.cloudflare.com/workers/tutorials/send-emails-with-resend/
10. **repo 内の現状整合** — `docs/registry/INFRA-SECRET-SPLIT-v1.csv:5` は `SMTP_*,VPS,VPS only` であり、段階 (a)(b) はこの登記と完全整合。段階 (c) は登記の改訂（`SMTP_*` → `RESEND_API_KEY,Workers,Workers secret` 等）を伴うため、本書では「付議」に留める。

補助出典（保管方式比較）: sops-age は「git に暗号化して正本を置く」用途（https://devops.datenkollektiv.de/using-sops-with-age-and-git-like-a-pro.html）だが、鍵 1 本・サーバ 1 台・git 管理外運用が既に確立している本件では過剰（却下理由は §3）。

## 3. 比較した代替案と却下理由

| 代替案 | 却下理由 |
|---|---|
| **Gmail SMTP アプリパスワード継続**（現 example の示唆） | 2025-05 LSA 停止で「最後のパスワード経路」化。500 通/日・不可視ブロック・アカウント全体と結合したシークレット（漏洩時の爆発半径が Gmail アカウント全体）。ローテ 3 段が組めない。 |
| **SendGrid** | 無料枠が 2025-07-26 に廃止済み。最安有料でも Resend Pro と同等以上。 |
| **Amazon SES** | 単価最安（$0.10/1k）だが無料枠は新規 12 ヶ月限定 3,000 通/月に縮小。AWS アカウント・IAM・サンドボックス解除申請の固定運用コストが一人運用の月数十通に見合わない。将来大量送信が必要になったら再検討。 |
| **Postmark** | 到達性評価は高いが無料は開発者枠 100 通/月のみで、最小有料 $15/月〜。無料で足りる用途に月額固定は不変条項①違反。 |
| **Cloudflare Email Service（送信）** | Beta + Workers Paid 限定（2026-07 時点）。認証の唯一経路を Beta に置かない。GA 後に ver4 で再評価（§6）。 |
| **保管: sops-age（git に暗号化正本）** | 鍵 1 本・配布先 1 台・既に git 管理外の chmod 600 運用が確立。age 鍵という「鍵の鍵」の管理が増えるだけで得るものが少ない。鍵種が増えチーム化したら再検討。 |
| **保管: Docker secrets** | Compose の file-based secrets は `/run/secrets` マウントでアプリ側の読み替え（env→ファイル）実装が必要になり、LoadCredential と同じコストでロックイン先が Docker になる。VPS 再構築時に systemd 直起動へ寄せる計画と競合。 |
| **保管: クラウドシークレットマネージャ（AWS SM/Vault 等）** | 月額固定 or 常駐が発生（Vault は自前常駐、AWS SM は $0.40/シークレット/月 + AWS 依存）。512MB VPS・一人運用・鍵数個の規模で過剰。 |
| **自前 SMTP サーバ（VPS 上 postfix 等）** | IP レピュテーション・PTR・ブロックリスト運用を一人で負うことになり、Sakura VPS の共有 IP 帯からの Gmail 到達性は不安定。保守面最小（V3-AUT-01 の趣旨）に反する。 |

## 4. ver3 要件との接続

| 対象 | 適合 |
|---|---|
| **V3-AUT-01**（マジックリンクのみ・保守面最小） | 送信経路を無料・保守最小のマネージドに固定。コード変更ゼロ（SMTP 互換）。 |
| **V3-AUT-04**（本番 SMTP 鍵・送信ドメインは人間ゲート、実メール送信は VPS、Workers 単独 SMTP 完結禁止） | 段階 (a)(b) は完全準拠（送信は VPS のまま）。段階 (c) は本要件の条文改訂を要するため**提案止まり・人間ゲート付議**。 |
| **V3-AUT-05**（SMTP 未設定時 dev_token フォールバック） | `magic_link_mail.py:13-14` の「SMTP_HOST 未設定→送信スキップ」挙動を維持。移行失敗時もログイン経路が死なない。 |
| **V3-FND-10 / ver4 インフラ合意**（Workers 主 API・VPS 薄常駐） | 段階 (c) が該当。API 送信なら VPS 薄常駐の主用途が消えるため、合意 §102 の再裁定材料を提示（§2-9）。 |
| **不変条項①コスト最小** | 追加費用 0 円（Resend 無料枠）。 |
| **不変条項②fork 文化** | プロバイダは env 値の差し替えのみで交換可能（SMTP 互換 or HTTPS API）。ロックインなし。 |
| **不変条項③append-only** | 送信ログ・ローテ記録は変更管理に追記で残す（鍵本体は記録しない — playbook 既定）。 |
| **不変条項④人間ゲート** | 実鍵投入・DNS(SPF/DKIM/DMARC) 変更・Resend アカウント作成・ver4 合意改訂の 4 点を人間ゲートに明記。 |
| **不変条項⑤批評家ゲート** | 本書は draft。B2 レビューで批評家ゲートを通してから B3 へ。 |

### 提案本体: 段階移行 + playbook 追記案

**段階 (a) いま（ver3 現行 VPS・別コミットで実施、鍵投入は人間ゲート）**
1. 人間: Resend アカウント作成 → `it-hercules.uk` のサブドメイン（例 `send.it-hercules.uk`）をドメイン検証、Cloudflare DNS に SPF/DKIM（+DMARC p=none）レコード追加。
2. 人間: API キー発行 → VPS `.env.platform` に `SMTP_HOST=smtp.resend.com` / `SMTP_PORT=465` / `SMTP_SECURE=true` / `SMTP_USER=resend` / `SMTP_PASS=<APIキー>` / `MAIL_FROM=IT Hercules Laboratory <login@send.it-hercules.uk>` を設定（chmod 600 維持）。
3. AI 可: `.env.platform.example` の SMTP 節を Gmail 例から Resend 例に差し替え + `CLOUDFLARE_ACCOUNT_ID` 実値（`.env.platform.example:34`、R2_ENDPOINT 内の同値含む）をプレースホルダ化。
4. 検証: 自分の Gmail 宛にマジックリンク送信 → 受信・SPF/DKIM pass をヘッダで確認。

**段階 (b) ver3 新 repo / VPS 再構築時**
- API サービスを systemd unit 化する際に `LoadCredential=smtp_pass:/etc/credstore/ihl-smtp-pass` へ昇格し、起動ラッパで `SMTP_PASS=$(cat $CREDENTIALS_DIRECTORY/smtp_pass)` を注入（アプリ変更不要）。`.env.platform` からは SMTP_PASS 行を撤去。

**段階 (c) ver4 Workers 化後（合意改訂の人間ゲート通過が前提）**
- `wrangler secret put RESEND_API_KEY` で Workers secret 化し、Workers から `fetch()` で Resend API に直送信。`INFRA-SECRET-SPLIT-v1.csv` の `SMTP_*` 行を改訂。VPS 薄常駐の要否を再裁定。

**secrets-rotation-playbook.md への追記案（SMTP 節・そのまま貼れる形）**

```markdown
## SMTP（マジックリンク送信 — Resend API キー）
- 対象: SMTP_PASS（= Resend API キー）。SMTP_HOST/USER は非シークレット。
- 平時ローテ: 年1回 or 漏洩疑い時。
- 手順（無停止・3段）:
  1. Resend ダッシュボードで新 API キーを発行（旧キーは残す）
  2. VPS の .env.platform（ver4 後: wrangler secret put）を新キーに更新 → サービス再起動
     → 自分宛にマジックリンク送信し受信を確認
  3. 確認後、Resend で旧キーを失効
- 失敗時フォールバック: SMTP_HOST を空にすれば送信スキップ+dev_token 経路（V3-AUT-05）で
  ログイン継続可能。
- 記録: 変更管理に日時・対象（"SMTP_PASS"）・確認結果を追記。キー本体は記録しない。
```

## 5. リスクと再検証条項

本書の価格・プラン・Beta 状況はすべて **2026-07-10 時点**の web 情報。実装着手時（`revalidate_before_impl: true`）に以下を再確認すること。

| リスク | 再検証項目 |
|---|---|
| Resend 無料枠の改悪（SendGrid 前例あり） | resend.com/pricing の無料枠（3,000/月・100/日・独自ドメイン数）を着手時に再確認。改悪時の次点は SES（$0.10/1k）。 |
| Resend SMTP インターフェースの仕様変更 | smtp.resend.com のホスト/ポート/認証方式を docs で再確認。変更されていたら HTTPS API へ切替（VPS からも curl 可能）。 |
| Cloudflare Email Service の GA | GA + 無料/低額で任意宛先送信が可能になっていれば ver4 段階 (c) の第一候補に昇格しうる（Workers binding はシークレット自体が不要になる）。 |
| 到達性（Gmail 側要件の強化） | Google 送信者ガイドラインの要件変化（DMARC 必須化の下方拡大等）。DMARC は最初から p=none で設定しておく。 |
| 単一プロバイダ依存 | Resend 障害時はマジックリンクが送れない。dev_token フォールバック（V3-AUT-05）が生きていることを移行時に e2e で確認。 |
| VPS 再構築の時期ずれ | 段階 (b) は VPS systemd 化と同時でよい（chmod 600 env の実害は単一運用者・単一テナントでは限定的）。前倒しの必要なし。 |
| 日本からの到達性 | 主要宛先が運用者自身の Gmail である現状では問題になりにくいが、公開ユーザー登録（V3-AUT-42 の裁定後）でキャリアメール宛が発生する場合は再調査。 |

## 6. 未解決の問い

1. ver4 で「Workers 単独 SMTP 完結禁止」条項（V3-AUT-04 / ver4-infra-agreement.md:102）を「メール API(HTTPS) 経由なら Workers 完結可」に改訂するか — VPS 薄常駐の存廃に直結。人間裁定待ち。
2. 送信元アドレス設計: ルートドメイン `it-hercules.uk` 直か、サブドメイン `send.it-hercules.uk` 分離か（レピュテーション分離の定石はサブドメインだが、DNS レコードが 1 セット増える）。
3. 公開登録（V3-AUT-42）が解禁された場合の月間送信量見込みと、無料枠 100 通/日で足りるかの試算。
4. `.env.platform.example` の Cloudflare アカウント ID 実値の扱い — プレースホルダ化を段階 (a) の同コミットに含めるか、別コミットか。
5. Resend アカウントのオーナーメール・2FA 設定をどの人間ゲート記録に登記するか（アカウント自体が新たなシークレット面になる）。
