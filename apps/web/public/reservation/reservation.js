// reservation.js — R134(承認済み予想図の逐語採用)。「割り出し予約」買い手ダッシュボード。
// 実API(GET /market/reservations = 状態付き自分の予約一覧・同一オリジン cookie 認証)へ配線。
// 申込フォーム/しきい値設定/マッチング実行は出品・個体側の別画面(この画面は買い手の予約状態)。
const $ = (sel) => document.querySelector(sel);
const yen = (n) => (typeof n === "number" ? "¥" + n.toLocaleString("ja-JP") : "—");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function requireSession() {
  const res = await fetch("/api/v1/auth/session", { credentials: "include" }).catch(() => null);
  const body = res ? await res.json().catch(() => null) : null;
  if (!body || body.authenticated !== true) {
    location.href = "/s/login";
    return false;
  }
  return true;
}

const STATUS_LABEL = {
  pending: "マッチング待ち",
  offered: "あなたの確認待ち",
  confirmed: "成立",
  declined: "辞退済み",
  expired: "期限切れ",
};

let reservations = [];
let listingsById = {};
let selected = 0;
let rankCache = {}; // reservation_id -> rank(GET /market/transfer)

function remainingText(expiresAt) {
  if (!expiresAt) return "";
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "まもなく期限切れ";
  const h = Math.floor(ms / 3600000);
  if (h >= 1) return `あと${h}時間`;
  return `あと${Math.max(1, Math.floor(ms / 60000))}分`;
}

async function load() {
  const [resR, listR] = await Promise.all([
    fetch("/api/v1/market/reservations", { credentials: "include" }).catch(() => null),
    fetch("/api/v1/market/listings", { credentials: "include" }).catch(() => null),
  ]);
  reservations = (resR && resR.ok ? (await resR.json().catch(() => null))?.reservations : null) || [];
  const listings = (listR && listR.ok ? (await listR.json().catch(() => null))?.listings : null) || [];
  listingsById = {};
  for (const l of listings) listingsById[l.listing_id] = l;
  renderList();
  renderDetail();
}

function titleOf(r) {
  const l = listingsById[r.listing_id];
  return (l && l.title) || "(予約listing)";
}

function renderList() {
  const el = $("#res-list");
  if (reservations.length === 0) {
    el.innerHTML = `<div class="empty"><span class="e-ico">🥚</span>まだ予約はありません。<br><a href="/s/market-trade">割り出し予約を受付中の個体を探す →</a></div>`;
    $("#res-detail").innerHTML = "";
    return;
  }
  el.innerHTML = reservations
    .map((r, i) => {
      const st = r.status || "pending";
      return `<div class="res-row ${i === selected ? "sel" : ""}" data-i="${i}">
        <div class="res-thumb">🪲</div>
        <div class="res-main">
          <div class="res-title">${esc(titleOf(r))}</div>
          <div class="res-sub">
            <span class="st-pill ${st}">${esc(STATUS_LABEL[st] || st)}</span>
            <span>希望 ${yen(r.desired_unit_price)} × ${esc(r.desired_count)}頭</span>
          </div>
        </div>
        <div class="res-amt">
          <div class="a-price">${yen(r.desired_unit_price * r.desired_count)}</div>
          <div class="a-sub">希望合計</div>
        </div>
      </div>`;
    })
    .join("");
  el.querySelectorAll(".res-row").forEach((row) => {
    row.addEventListener("click", async () => {
      selected = Number(row.dataset.i);
      renderList();
      await ensureRank(reservations[selected]);
      renderDetail();
    });
  });
}

// offered の予約は GET /market/transfer で自分の順位(rank)を取れる(買い手は自分の行のみ可視)。
async function ensureRank(r) {
  if (!r || r.status !== "offered" || rankCache[r.reservation_id] !== undefined) return;
  const res = await fetch(`/api/v1/market/transfer/${encodeURIComponent(r.listing_id)}`, { credentials: "include" }).catch(() => null);
  const body = res && res.ok ? await res.json().catch(() => null) : null;
  const mine = body && body.reservations && body.reservations.find((x) => x.reservation_id === r.reservation_id);
  rankCache[r.reservation_id] = mine && typeof mine.rank === "number" ? mine.rank : null;
}

function detailBody(r) {
  const st = r.status || "pending";
  if (st === "offered") {
    const total = (r.offered_unit_price || 0) * (r.offered_count || 0);
    const rank = rankCache[r.reservation_id];
    return `<div class="offer">
      <div class="of-head">🎉 マッチしました！ <span class="st-pill offered">確認待ち</span></div>
      <div class="of-kv">
        ${typeof rank === "number" ? `<div><div class="k">順位</div><div class="v">${rank + 1}位</div></div>` : ""}
        <div><div class="k">単価</div><div class="v">${yen(r.offered_unit_price)}</div></div>
        <div><div class="k">頭数</div><div class="v">${esc(r.offered_count)}頭</div></div>
        <div><div class="k">合計</div><div class="v">${yen(total)}</div></div>
      </div>
      <div class="of-deadline">⏳ 応答期限：${esc(remainingText(r.expires_at))}（確認は24時間以内）</div>
      <div class="of-actions">
        <span class="btn primary" data-act="confirm">この内容で成立させる</span>
        <span class="btn danger sm" data-act="decline">辞退する</span>
      </div>
      <div class="karma-warn">⚠ 辞退・期限切れは<b>カルマ −1</b>（「予約したなら買う」責任）。成立すると、そのまま<b>取引中</b>（お支払い→発送→受け取り→評価）に進みます。</div>
    </div>`;
  }
  if (st === "confirmed") {
    return `<div class="plain-state">✅ 成立しました。<a href="/torihikichu/torihikichu.html" style="color:var(--primary);font-weight:700;">取引中の画面</a>でお支払いへ進めます。</div>`;
  }
  if (st === "declined" || st === "expired") {
    return `<div class="plain-state">${st === "declined" ? "この予約は辞退しました。" : "応答期限が過ぎ、未確定になりました。"}（カルマ −1）別の個体の予約はいつでも入れられます。</div>`;
  }
  // pending
  return `<div class="plain-state">まだ割り出し（クラッチ確定）前です。採れた頭数が決まると、<b>単価の高い順</b>で自動マッチングされ、ここに「確認待ち」が出ます。それまでお待ちください。</div>`;
}

function renderDetail() {
  if (reservations.length === 0) return;
  const r = reservations[selected] || reservations[0];
  $("#res-detail").innerHTML = `
    <section class="block">
      <div class="section-head">
        <h2 class="section-title">🪜 この予約の今</h2>
        <p class="section-caption">マッチしたら最終確認。ここを通って初めて取引が始まります。</p>
      </div>
      <div class="card">
        <div class="detail-head"><div class="dh-title">${esc(titleOf(r))}</div></div>
        <div class="ctx-chips">
          <span class="chip">希望単価 ${yen(r.desired_unit_price)}</span>
          <span class="chip">希望 ${esc(r.desired_count)}頭</span>
          <span class="chip">${esc(STATUS_LABEL[r.status] || r.status)}</span>
        </div>
        ${detailBody(r)}
      </div>
    </section>`;
  $("#res-detail").querySelectorAll("[data-act]").forEach((btn) => {
    btn.addEventListener("click", () => act(r.reservation_id, btn.dataset.act, btn));
  });
}

async function act(reservationId, kind, btn) {
  if (kind === "decline" && !confirm("この予約を辞退します。カルマが1下がります。よろしいですか?")) return;
  btn.textContent = "処理中…";
  const res = await fetch(`/api/v1/market/reservations/${encodeURIComponent(reservationId)}/${kind}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
  }).catch(() => null);
  if (res && res.ok) {
    rankCache = {};
    await load();
  } else {
    btn.textContent = "できませんでした(時間をおいて再度)";
  }
}

(async () => {
  if (!(await requireSession())) return;
  await load();
})();
