// hanashiai.js — R141(承認済み予想図の逐語採用)。「話し合いの場」を dispute バックエンド
// (gov-routes.ts・同一オリジン cookie 認証)へ配線。私の相談一覧→相談ルーム(2人チャット)→
// 決着(合意/公開投票)。投票は二層: 無料投票=実装(vote-result)・プラチナ権能投票=これから。
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function requireSession() {
  const res = await fetch("/api/v1/auth/session", { credentials: "include" }).catch(() => null);
  const body = res ? await res.json().catch(() => null) : null;
  if (!body || body.authenticated !== true) { location.href = "/s/login"; return false; }
  return true;
}
const getJson = async (p) => { const r = await fetch(`/api/v1/${p}`, { credentials: "include" }).catch(() => null); return r && r.ok ? r.json().catch(() => null) : null; };
const post = (p, body) => fetch(`/api/v1/${p}`, { method: "POST", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify(body || {}) }).catch(() => null);

const CAT = { market: { label: "取引", cls: "market", ico: "🪲" }, board: { label: "掲示板", cls: "board", ico: "💬" }, bugfix: { label: "アプリ改善", cls: "bugfix", ico: "🛠" } };
const remainH = (iso) => { if (!iso) return ""; const ms = new Date(iso).getTime() - Date.now(); if (ms <= 0) return "締切済み"; const h = Math.floor(ms / 3600000); return h >= 24 ? `あと${Math.floor(h / 24)}日` : `あと${Math.max(1, h)}時間`; };

let disputes = [];
let selected = 0;

function statusPill(d) {
  if (d.status === "resolved" || d.status === "force_closed") return `<span class="st-pill resolved">決着</span>`;
  if (d.public) return `<span class="st-pill vote">みんなで投票中</span>`;
  return `<span class="st-pill open">相手と話し合い中</span>`;
}

async function load() {
  const body = await getJson("gov/disputes/mine");
  disputes = (body && body.disputes) || [];
  renderList();
  renderRoom();
}

function renderList() {
  const el = $("#talk-list");
  if (disputes.length === 0) {
    el.innerHTML = `<div style="text-align:center;color:var(--muted);padding:30px;">まだ相談はありません。<br>取引でもめたら「取引中」から、アプリへの要望はこの下の入口から始められます。</div>`;
    $("#room").innerHTML = "";
    return;
  }
  el.innerHTML = disputes
    .map((d, i) => {
      const c = CAT[d.category] || { label: d.category, cls: "bugfix", ico: "•" };
      return `<div class="talk-row ${i === selected ? "sel" : ""}" data-i="${i}">
        <div class="talk-ico ${c.cls}">${c.ico}</div>
        <div class="talk-main">
          <div class="talk-title">${c.label}の相談${d.counterparty ? `（相手 @${esc(d.counterparty)}）` : ""}</div>
          <div class="talk-sub"><span class="cat-pill ${c.cls}">${c.label}</span>${statusPill(d)}<span>あなたは${d.role === "opener" ? "相談を開いた側" : "相談された側"}</span></div>
        </div>
        <div class="talk-when">${d.public && d.vote_deadline ? remainH(d.vote_deadline) : ""}</div>
      </div>`;
    })
    .join("");
  el.querySelectorAll(".talk-row").forEach((r) => r.addEventListener("click", async () => { selected = Number(r.dataset.i); renderList(); await renderRoom(); }));
}

function msgHtml(m, myId) {
  const me = m.actor_id === myId;
  return `<div class="msg ${me ? "me" : ""}">
    <div class="av">${me ? "私" : "相"}</div>
    <div class="bubble"><div class="who">${me ? "あなた" : "@" + esc(m.actor_id)}${m.lang ? ` <span class="lang">${esc(m.lang)}</span>` : ""}</div>${esc(m.body)}</div>
  </div>`;
}

function voteHtml(view, tally) {
  const s = tally ? Number(tally.seller_votes || 0) : 0;
  const b = tally ? Number(tally.buyer_votes || 0) : 0;
  const total = s + b;
  const sp = total ? Math.round((s / total) * 100) : 50;
  const closed = tally && tally.window_closed;
  const result = closed ? `締切・${tally.winner === "tie" ? "引き分け" : tally.winner === "seller" ? "売り手が優勢で確定" : "買い手が優勢で確定"}` : `締切まで ${remainH(view.vote_deadline)}（締切後に確定）`;
  return `<div style="font-weight:800;font-size:13px;margin:14px 0 6px;">🗳 みんなの投票（今の集計）</div>
    <div class="vote-tally"><div class="vote-bar"><div class="s" style="width:${sp}%"></div><div class="b" style="width:${100 - sp}%"></div></div></div>
    <div class="vote-nums">売り手 ${s}票 ・ 買い手 ${b}票 ・ 合計 ${total}人　／　${esc(result)}</div>
    <div class="honest" style="margin-top:8px;">${closed ? "" : "投票中は結果を「未確定」として表示します（締切が来るまで勝敗を出しません）。"}正直に：<b>今の投票は1票＝プラチナ1枚（PT）を消費</b>します（今のバックエンドの実挙動）。あなたの言う<b>二層化はこれから</b>：①<b>完全に無料</b>の投票層 ②<b>プラチナコイン権能投票</b>（1権能＝ふつうの100票級の重みで、本気の1票が数に流されない層）。二層の集計は要件採番（C9 round-18）後に実装します。権能投票は経済価値を持つため所有者検証・統一authz（T-71残）が前提。</div>`;
}

async function renderRoom() {
  const el = $("#room");
  if (disputes.length === 0) return;
  const d = disputes[selected] || disputes[0];
  const view = await getJson(`gov/disputes/${encodeURIComponent(d.dispute_id)}`);
  if (!view) { el.innerHTML = `<div class="card"><div style="color:var(--muted);">相談を読み込めませんでした。</div></div>`; return; }
  const c = CAT[view.category] || { label: view.category, cls: "bugfix" };
  const myId = view.participants ? view.participants[d.role] : null;
  const messages = Array.isArray(view.messages) ? view.messages : [];
  const isOpen = view.status === "open";
  let tally = null;
  if (view.public) tally = await getJson(`gov/disputes/${encodeURIComponent(d.dispute_id)}/vote-result`);

  const threadHtml = messages.length
    ? messages.map((m) => msgHtml(m, myId)).join("")
    : `<div style="color:var(--muted);font-size:13px;">まだ発言がありません。最初のひとことを書いて、経緯を伝えましょう。</div>`;

  const composer = isOpen
    ? `<div class="composer"><input class="inp" id="msg-input" placeholder="メッセージを書く…" style="border:1px solid var(--border);"><span class="btn primary sm" data-act="send">送信</span></div>`
    : "";
  const resolve = isOpen
    ? `<div class="resolve-two">
        <div class="resolve-card agree"><h4>🤝 合意して決着</h4><p>折り合えたら決着の内容を残します。これが<b>判例</b>になり、みんなの参考に。</p><span class="btn ghost sm" data-act="close">決着にする（判例を残す）</span></div>
        <div class="resolve-card vote"><h4>🗳 みんなで決める</h4><p>折り合わなければ公開し、みんなの投票で決めます。あなたの立場（売り手／買い手）を宣言して公開。</p>${view.public ? `<span class="btn blue sm" style="opacity:.6;">公開済み</span>` : `<span class="btn blue sm" data-act="publicize">公開して投票にかける</span>`}</div>
      </div>`
    : `<div class="plain-state" style="border:1px dashed var(--border);border-radius:10px;padding:12px 14px;font-size:13px;color:var(--primary);background:var(--primary-bg);">✅ この相談は決着しました。内容は判例として残っています。</div>`;

  el.innerHTML = `<div class="card">
    <div class="room-head">
      <span class="room-title">${c.label}の相談</span>
      <span class="cat-pill ${c.cls}">${c.label}</span>
      ${statusPill({ status: view.status, public: view.public })}
    </div>
    <div class="subject">📎 何について：<b>${c.label}</b>${view.subject_ref && view.subject_ref.id ? `（${esc(view.subject_ref.id)}）` : ""}${d.counterparty ? ` ・ 相手 @${esc(d.counterparty)}` : ""}</div>
    <div class="thread">${threadHtml}</div>
    ${composer}
    ${view.public ? voteHtml(view, tally) : ""}
    ${resolve}
  </div>`;

  const send = el.querySelector('[data-act="send"]');
  if (send) send.addEventListener("click", async () => {
    const body = $("#msg-input").value.trim();
    if (!body) return;
    send.textContent = "送信中…";
    const r = await post(`gov/disputes/${encodeURIComponent(d.dispute_id)}/messages`, { body });
    if (r && r.ok) await renderRoom(); else send.textContent = "送れませんでした";
  });
  const closeBtn = el.querySelector('[data-act="close"]');
  if (closeBtn) closeBtn.addEventListener("click", async () => {
    const title = prompt("決着のタイトル（判例の見出し）を入力してください");
    if (!title) return;
    const summary = prompt("何をどう解決したか（要約）を入力してください");
    if (!summary) return;
    const r = await post(`gov/disputes/${encodeURIComponent(d.dispute_id)}/close`, { title, summary });
    if (r && r.ok) await load(); else alert("決着にできませんでした（相手の承認や状態をご確認ください）");
  });
  const pubBtn = el.querySelector('[data-act="publicize"]');
  if (pubBtn) pubBtn.addEventListener("click", async () => {
    const role = prompt("あなたの立場を入力してください（seller＝売り手 / buyer＝買い手）", "buyer");
    if (role !== "seller" && role !== "buyer") { if (role !== null) alert("seller か buyer で入力してください"); return; }
    const r = await post(`gov/disputes/${encodeURIComponent(d.dispute_id)}/publicize`, { opener_role: role });
    if (r && r.ok) await load(); else alert("公開できませんでした（開いた本人のみ・open状態のみ）");
  });
}

(async () => { if (!(await requireSession())) return; await load(); })();
