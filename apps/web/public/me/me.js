// me.js — R147(承認済み完成予想図 me-forecast.html の逐語採用)+ R163 実装。
// 承認絵の "画面の形"(:root変数・カード・レイアウト)はそのまま、表示値を実API
// (同一オリジン cookie 認証)へ配線する。MEゾーン恒久原則(R135/R147・
// facts-only-no-odd-requirements): 合成指標(信頼度メーター等)は作らない=
// カルマ/貢献度/取引評価の "生の事実" のみ。intl_trust(合成0-100)は返っても表示しない。
// 未実装/人間ゲートは「準備中/裁定待ち」を正直表示(捏造値ゼロ)。
const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const yen = (n) => (typeof n === "number" ? n.toLocaleString("ja-JP") : "—");

// このページ自身がセッションを確認する(middleware は *.html を素通しするため・
// torihikichu / finder と同型)。未ログインは /s/login へ。
async function requireSession() {
  const res = await fetch("/api/v1/auth/session", { credentials: "include" }).catch(() => null);
  const body = res ? await res.json().catch(() => null) : null;
  if (!body || body.authenticated !== true) {
    location.href = "/s/login";
    return false;
  }
  return true;
}

async function getJson(path) {
  const res = await fetch(path, { credentials: "include" }).catch(() => null);
  if (!res || !res.ok) return null;
  return res.json().catch(() => null);
}

const LOCALE_LABEL = { ja: "日本語", en: "English" };
const COUNTRY_LABEL = { JP: "日本", US: "アメリカ", "": "国 未設定" };

// ─────────────────────────────────────────── 1. プロフィール ───────────────
// GET /me/profile: karma{value,count,ban} / contribution.axes.research.score /
// market.rating{good,normal,bad} / public_safety_locked[] / configurable_public_fields[]。
// intl_trust は "合成指標" のため読み込んでも表示しない(R135)。
const PUBLIC_LABEL = {
  trade_record: "取引実績",
  karma: "カルマ",
  bad_reviews: "悪い評価",
  public_optin_appeal: "公開の不服申立て",
  country: "国",
  language: "言語",
  culture_tags: "文化タグ",
  bio: "自己紹介",
  icon: "アイコン",
};

function renderProfile(profile, prefs) {
  const name = (profile && profile.display_name) || null;
  $("#me-name").textContent = name || "名前未設定";
  $("#me-avatar").textContent = name ? name.trim().charAt(0) : "👤";

  const loc = prefs ? LOCALE_LABEL[prefs.locale] || prefs.locale || "—" : "—";
  const country = prefs ? (COUNTRY_LABEL[prefs.country] ?? (prefs.country || "国 未設定")) : "—";
  const handle = prefs && prefs.handle ? ` ・ @${esc(prefs.handle)}` : "";
  $("#me-sub").innerHTML = `${esc(country)} / ${esc(loc)}${handle}`;

  // 事実チップのみ(装飾の作り話チップは置かない)。取引の受け取り準備=pii_readiness(実フィールド)。
  const chips = $("#me-chips");
  chips.innerHTML = "";
  if (profile && profile.pii_readiness) {
    const ready = profile.pii_readiness.all_set === "yes";
    chips.innerHTML = `<span class="id-chip">🤝 取引の受け取り準備: ${ready ? "済み" : "まだ(設定で整えられます)"}</span>`;
  }

  if (!profile) {
    $("#me-karma").textContent = "—";
    $("#me-karma-sub").textContent = "読み込みに失敗しました。時間をおいて再度お試しください。";
    $("#me-contrib").textContent = "—";
    $("#me-rating").textContent = "—";
    $("#me-priv").innerHTML = "";
    return;
  }

  const k = profile.karma || { value: 0, count: 0, ban: false };
  $("#me-karma").innerHTML = `${k.value >= 0 ? "+" : ""}${k.value}`;
  $("#me-karma-sub").textContent = `評価の回数: ${k.count}件 / アカウント制限(BAN): ${k.ban ? "あり" : "なし"}`;

  const research =
    profile.contribution && profile.contribution.axes && profile.contribution.axes.research
      ? profile.contribution.axes.research.score
      : profile.contribution
        ? profile.contribution.research_score
        : 0;
  $("#me-contrib").textContent = `研究 ${research ?? 0}`;

  const r = (profile.market && profile.market.rating) || { good: 0, normal: 0, bad: 0 };
  $("#me-rating").innerHTML =
    `<span class="good">良 ${r.good ?? 0}</span> <span>普 ${r.normal ?? 0}</span> <span class="bad">悪 ${r.bad ?? 0}</span>`;

  // 公開のきまり: 実際に API が返す2つの配列からラベル化(常に公開 / 公開を選べる)。
  const label = (arr) => (arr || []).map((f) => PUBLIC_LABEL[f] || f).join("・");
  $("#me-priv").innerHTML =
    `<div class="priv-row"><span class="priv-name">${esc(label(profile.public_safety_locked))}</span><span class="priv-badge locked">🔒 いつも公開</span></div>` +
    `<div class="priv-row"><span class="priv-name">${esc(label(profile.configurable_public_fields))}</span><span class="priv-badge choose">👁 公開・非公開を選べる</span></div>`;
}

// 作品一覧: GET /individuals(本人の個体)。空は正直に。
function renderWorks(data) {
  const el = $("#me-works");
  const items = (data && data.individuals) || [];
  if (items.length === 0) {
    el.innerHTML =
      `<div class="work-tile" style="grid-column:1/-1;"><div class="work-name" style="padding:14px;">登録した個体はまだありません。<span>観測ゾーンで登録すると、ここに作品として並びます。</span></div></div>`;
    return;
  }
  el.innerHTML = items
    .slice(0, 12)
    .map(
      (i) =>
        `<div class="work-tile"><div class="work-photo">🪲</div><div class="work-name">${esc(i.label || "(名称未設定)")}<span>${esc(i.species || "種未設定")}</span></div></div>`,
    )
    .join("");
}

// ─────────────────────────────────────────── 2. 設定(選好) ────────────────
// GET/PATCH /me/preferences。seg[data-pref] の各 opt[data-val] を現在値でハイライト。
// クリックで PATCH(append・後勝ち)し、成功したら UI を更新(捏造せず実応答を反映)。
function paintPrefs(prefs) {
  document.querySelectorAll("#me-prefs .seg").forEach((seg) => {
    const key = seg.getAttribute("data-pref");
    const cur = prefs ? prefs[key] : undefined;
    seg.querySelectorAll(".opt").forEach((opt) => {
      const on = opt.getAttribute("data-val") === cur;
      opt.classList.toggle("on", on);
      // 受取方法だけは承認絵と同じ青ハイライト(.opt.on.blue)。
      opt.classList.toggle("blue", on && key === "delivery_pref");
    });
  });
  const scope = $("#me-scope");
  if (scope) scope.textContent = (prefs && prefs.scope_species) || "すべて";
}

function wirePrefs() {
  document.querySelectorAll("#me-prefs .seg").forEach((seg) => {
    const key = seg.getAttribute("data-pref");
    seg.querySelectorAll(".opt").forEach((opt) => {
      opt.style.cursor = "pointer";
      opt.addEventListener("click", async () => {
        const val = opt.getAttribute("data-val");
        const res = await fetch("/api/v1/me/preferences", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ [key]: val }),
        }).catch(() => null);
        if (res && res.ok) {
          const prefs = await res.json().catch(() => null);
          paintPrefs(prefs);
        } else {
          opt.title = "保存できませんでした(時間をおいて再度)";
        }
      });
    });
  });
}

// ─────────────────────────────────────────── 2b. 機器連携 ──────────────────
// GET /devices(has_api_key のみ・平文鍵は返らない)。接続テスト=POST /devices/{id}/test。
function renderDevices(data) {
  const el = $("#me-devices");
  const rows = (data && data.devices) || [];
  const addRow =
    `<div class="dev-row"><span class="dev-ico">➕</span><div class="dev-meta"><div class="dev-name">機器を追加する</div><div class="dev-sub">機器は「置き場所」に結び付きます(個体には結び付けません)。</div></div></div>`;
  if (rows.length === 0) {
    el.innerHTML =
      `<div class="dev-row"><div class="dev-meta"><div class="dev-name">まだ機器がありません</div><div class="dev-sub">SwitchBot 等の温湿度計を追加すると、置き場所の環境データが自動で入ります。</div></div></div>` +
      addRow;
    return;
  }
  el.innerHTML =
    rows
      .map((d) => {
        const sub = `${esc(d.provider || "—")} ・ 置き場所: ${esc(d.placement_ref || "未設定")} ・ 開始: ${esc(d.started_on || "—")}`;
        const badge = d.has_api_key ? `<span class="dev-badge">🔑 鍵あり</span>` : "";
        return `<div class="dev-row"><span class="dev-ico">🌡</span><div class="dev-meta"><div class="dev-name">${esc(d.display_name || d.device_id)}</div><div class="dev-sub">${sub}</div></div>${badge}<span class="dev-test" role="button" tabindex="0" data-dev="${esc(d.device_id)}">接続テスト</span></div>`;
      })
      .join("") + addRow;
  el.querySelectorAll("[data-dev]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-dev");
      btn.textContent = "テスト中…";
      const res = await fetch(`/api/v1/devices/${encodeURIComponent(id)}/test`, {
        method: "POST",
        credentials: "include",
      }).catch(() => null);
      const body = res && res.ok ? await res.json().catch(() => null) : null;
      if (body && body.ok) btn.textContent = `✓ 接続OK(${(body.discovered || []).length}件)`;
      else btn.textContent = "接続できませんでした";
    });
  });
}

// ─────────────────────────────────────────── 3. AIプロファイル ─────────────
// LLM は既定オフ(不変条項①)。POST /ai/{task} は鍵未投入で 501 AI_DISABLED=
// 「未実装」ではなく本当にオフの状態。ボタンで実応答を確認して正直表示する。
function wireAiCheck() {
  const btn = $("#me-ai-check");
  const status = $("#me-ai-status");
  if (!btn || !status) return;
  btn.style.cursor = "pointer";
  btn.addEventListener("click", async () => {
    status.textContent = "● 確認中…";
    const res = await fetch("/api/v1/ai/summarize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ input: "" }),
    }).catch(() => null);
    if (res && res.status === 501) {
      status.textContent = "● 今はAIオフ(サーバ応答 501 AI_DISABLED・鍵を入れて有効化するまで動きません)";
    } else if (res && res.ok) {
      status.textContent = "● AIは有効です(鍵が投入されています)";
    } else {
      status.textContent = "● 状態を取得できませんでした(時間をおいて再度)";
    }
  });
}

// ─────────────────────────────────────────── 4. 運営コスト ─────────────────
// GET /costs: vps{label,monthly_yen,source} / r2{monthly_yen,source} / total_monthly_yen。
// R2 は CF 鍵未設定だと source:"manual"(手動値へ縮退)。決して 500 にしない設計。
function renderCosts(c) {
  if (!c) {
    $("#me-cost-total").textContent = "—";
    $("#me-cost-breakdown").innerHTML =
      `<div class="cost-tile"><div class="c-k">読み込みに失敗しました</div><div class="c-src">時間をおいて再度お試しください。</div></div>`;
    return;
  }
  $("#me-cost-total").textContent = yen(c.total_monthly_yen);
  const srcLabel = (src) => (src === "api" ? "Cloudflare API(実測)" : "手動入力の正本値");
  const r2Note = c.r2 && c.r2.source === "manual" ? "Cloudflare R2(手動値へ縮退中)" : "Cloudflare R2";
  const vps = c.vps || { label: "サーバー", monthly_yen: 0, source: "manual" };
  const r2 = c.r2 || { monthly_yen: 0, source: "manual" };
  $("#me-cost-breakdown").innerHTML =
    `<div class="cost-tile"><div class="c-k">サーバー</div><div class="c-v">${yen(vps.monthly_yen)}円<span style="font-size:12px;color:var(--muted);font-weight:700;"> /月</span></div><div class="c-src">${esc(vps.label)}(${srcLabel(vps.source)})</div></div>` +
    `<div class="cost-tile"><div class="c-k">ストレージ(R2)</div><div class="c-v">${yen(r2.monthly_yen)}円<span style="font-size:12px;color:var(--muted);font-weight:700;"> /月</span></div><div class="c-src">${esc(r2Note)}</div></div>`;
}

// ─────────────────────────────────────────── 5. テーマギャラリー ───────────
// GET /theme-packs: built-in 2 + みんなの fork。各 pack_id/name/mode/tokens。
// 適用中=現在の theme_pack_id 選好。「これにする」で PATCH theme_pack_id。
function modeLabel(m) {
  return m === "dark" ? "暗いモード" : m === "light" ? "明るいモード" : "自動";
}
function renderThemes(data, currentPackId) {
  const el = $("#me-themes");
  const packs = (data && data.theme_packs) || [];
  if (packs.length === 0) {
    el.innerHTML = `<div class="theme-card"><div class="theme-meta"><div class="theme-name">テーマを読み込めませんでした</div></div></div>`;
    return;
  }
  el.innerHTML = packs
    .map((p) => {
      const t = p.tokens || {};
      const sw = [t.bg, t.primary, t.info || t.focus, t.text]
        .map((col) => `<span style="background:${esc(col || "#ccc")};"></span>`)
        .join("");
      const active = p.pack_id === currentPackId;
      const isFork = typeof p.parent_pack_id === "string" && p.parent_pack_id;
      const tags =
        (p.builtin ? `<span class="theme-tag builtin">標準</span>` : "") +
        (isFork ? ` <span class="theme-tag fork">🍴 派生</span>` : "") +
        (active
          ? ` <span class="theme-tag on">✓ 適用中</span>`
          : ` <span class="theme-tag builtin" role="button" tabindex="0" style="cursor:pointer;" data-apply="${esc(p.pack_id)}">これにする</span>`);
      return `<div class="theme-card ${active ? "active" : ""}"><div class="theme-swatches">${sw}</div><div class="theme-meta"><div class="theme-name">${esc(p.name || p.pack_id)}</div><div class="theme-mode">${esc(modeLabel(p.mode))}</div>${tags}</div></div>`;
    })
    .join("");
  el.querySelectorAll("[data-apply]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const packId = btn.getAttribute("data-apply");
      btn.textContent = "適用中…";
      const res = await fetch("/api/v1/me/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ theme_pack_id: packId }),
      }).catch(() => null);
      if (res && res.ok) {
        const prefs = await res.json().catch(() => null);
        renderThemes(data, prefs ? prefs.theme_pack_id : packId);
        paintPrefs(prefs);
      } else {
        btn.textContent = "できませんでした";
      }
    });
  });
}

// ─────────────────────────────────────────── 表示名の変更 ──────────────────
// POST /me/display-name(上書きでなく追記・不変条項③)。
function wireNameEdit(reload) {
  const edit = $("#me-name-edit");
  if (!edit) return;
  edit.style.cursor = "pointer";
  edit.addEventListener("click", async () => {
    const cur = $("#me-name").textContent;
    const next = window.prompt("新しい表示名(40文字まで)", cur === "名前未設定" ? "" : cur);
    if (next === null) return;
    const name = next.trim();
    if (!name) return;
    const res = await fetch("/api/v1/me/display-name", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ display_name: name }),
    }).catch(() => null);
    if (res && (res.ok || res.status === 201)) {
      await reload();
    } else {
      window.alert("表示名を変更できませんでした(40文字以内でお試しください)。");
    }
  });
}

// ─────────────────────────────────────────── boot ─────────────────────────
async function loadAll() {
  const [profile, prefs, works, devices, costs, themes] = await Promise.all([
    getJson("/api/v1/me/profile"),
    getJson("/api/v1/me/preferences"),
    getJson("/api/v1/individuals"),
    getJson("/api/v1/devices"),
    getJson("/api/v1/costs"),
    getJson("/api/v1/theme-packs"),
  ]);
  renderProfile(profile, prefs);
  renderWorks(works);
  paintPrefs(prefs);
  renderDevices(devices);
  renderCosts(costs);
  renderThemes(themes, prefs ? prefs.theme_pack_id : undefined);
}

(async () => {
  if (!(await requireSession())) return;
  wirePrefs();
  wireAiCheck();
  wireNameEdit(loadAll);
  await loadAll();
})();
