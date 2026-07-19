// economy-status.js — R148(承認済み予想図v2の逐語採用)。本人スコープの実データを
// 既存API(GET /me/ledger・/me/contribution・/me/pt・/costs・同一オリジンcookie認証)へ配線。
// 3層モデル・10%貢献度ボーナス・全体経済の正直表示は静的(本人データでない)。新route無し。
const $ = (s) => document.querySelector(s);
const yen = (n) => (typeof n === "number" ? "¥" + Math.round(n).toLocaleString("ja-JP") : "—");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function requireSession() {
  const res = await fetch("/api/v1/auth/session", { credentials: "include" }).catch(() => null);
  const body = res ? await res.json().catch(() => null) : null;
  if (!body || body.authenticated !== true) { location.href = "/s/login"; return false; }
  return true;
}

const getJson = async (path) => {
  const r = await fetch(`/api/v1/${path}`, { credentials: "include" }).catch(() => null);
  return r && r.ok ? r.json().catch(() => null) : null;
};

const AXIS_META = {
  research: { name: "研究", ico: "🔬" },
  capital: { name: "資本", ico: "💠" },
  development: { name: "開発", ico: "🛠" },
};

function renderAxes(axisList) {
  const el = $("#axes");
  if (!Array.isArray(axisList) || axisList.length === 0) {
    el.innerHTML = `<div class="axis"><div class="axis-main" style="color:var(--muted);">まだ貢献の記録がありません。</div></div>`;
    return;
  }
  el.innerHTML = axisList
    .map((a) => {
      const m = AXIS_META[a.axis] || { name: a.axis, ico: "•" };
      const next = typeof a.next_threshold === "number" && a.next_threshold > 0 ? a.next_threshold : null;
      const pct = next ? Math.min(100, Math.round((Number(a.score) / next) * 100)) : 0;
      const title = a.title
        ? `<span class="axis-title">称号：獲得済み ✓</span>`
        : `<span class="axis-title" style="color:var(--muted);">称号：これから</span>`;
      return `<div class="axis">
        <div class="axis-ico ${esc(a.axis)}">${m.ico}</div>
        <div class="axis-main">
          <div class="axis-name">${esc(m.name)}</div>
          ${title}
          <div class="axis-bar"><div class="fill" style="width:${pct}%"></div></div>
        </div>
        <div class="axis-num">スコア ${esc(a.score)}${next ? ` / ${esc(next)}` : ""}<br><span class="mint">🪙 mint ${esc(a.minted ?? 0)}</span></div>
      </div>`;
    })
    .join("");
}

async function load() {
  const [ledger, contribution, pt, costs] = await Promise.all([
    getJson("me/ledger"), getJson("me/contribution"), getJson("me/pt"), getJson("costs"),
  ]);

  if (ledger) {
    const kv = Number(ledger.karma_value ?? 0);
    $("#karma-value").textContent = (kv > 0 ? "+" : "") + kv;
    $("#karma-count").textContent = String(ledger.karma_count ?? 0);
    $("#platinum-coins").textContent = String(ledger.platinum_coins ?? 0);
  }
  if (pt) $("#pt-balance").textContent = String(pt.balance ?? 0);
  renderAxes(contribution && contribution.axis_list);
  if (costs) {
    const r2 = Number(costs.r2 && costs.r2.monthly_yen);
    $("#cost-vps").textContent = yen(costs.vps && costs.vps.monthly_yen);
    $("#cost-r2").textContent = r2 === 0 ? "¥0（無料枠内）" : yen(r2);
  }
}

(async () => {
  if (!(await requireSession())) return;
  await load();
})();
