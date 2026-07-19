// torihikichu.js — R121(承認済み完成予想図の逐語採用)。mkt-torihikichu-forecast の
// "画面の形"はそのまま、表示値を実API(GET /api/v1/market/transactions/mine・同一
// オリジン cookie 認証)へ配線する。派生ロジック(誰の番/段階/急ぎ色/押せる遷移)は
// サーバ側 market-transactions-view.ts に集約済み=このJSは描画+遷移POSTのみ。
const $ = (sel) => document.querySelector(sel);
const yen = (n) => (typeof n === "number" ? "¥" + n.toLocaleString("ja-JP") : "—");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// このページ自身がセッションを確認する(middleware は *.html を素通しするため・finder と同型)。
async function requireSession() {
  const res = await fetch("/api/v1/auth/session", { credentials: "include" }).catch(() => null);
  const body = res ? await res.json().catch(() => null) : null;
  if (!body || body.authenticated !== true) {
    location.href = "/s/login";
    return false;
  }
  return true;
}

let deals = [];
let selected = 0;

async function load() {
  const res = await fetch("/api/v1/market/transactions/mine", { credentials: "include" }).catch(() => null);
  const body = res && res.ok ? await res.json().catch(() => null) : null;
  deals = (body && body.transactions) || [];
  $("#deal-count").textContent = String(deals.length);
  renderList();
  renderDetail();
}

function flagHtml(f) {
  return `<span class="flag ${f.level === "hot" ? "hot" : "warn"}">${esc(f.text)}</span>`;
}

function renderList() {
  const el = $("#deal-list");
  if (deals.length === 0) {
    el.innerHTML =
      `<div class="empty"><span class="e-ico">🍃</span>進行中の取引はありません。<br><a href="/s/market-trade">市場で探す・出品する →</a></div>`;
    $("#detail").innerHTML = "";
    return;
  }
  el.innerHTML = deals
    .map((d, i) => {
      const isSell = d.role === "sell";
      const flags = (d.flags || []).map(flagHtml).join(" ");
      return `<div class="deal-row ${i === selected ? "sel" : ""}" data-i="${i}">
        <div class="deal-thumb ${isSell ? "sell" : "buy"}">🪲</div>
        <div class="deal-main">
          <div class="deal-title">${esc(d.title || "(無題の出品)")}</div>
          <div class="deal-sub">
            <span class="role-pill ${isSell ? "sell" : "buy"}">${isSell ? "出品" : "買う"}</span>
            <span class="state-pill">${esc(d.state_label)}</span>
            ${flags}
          </div>
        </div>
        <div class="turn">
          <div class="who ${d.turn === "you" ? "you" : "them"}">${d.turn === "you" ? "あなたの番" : "相手待ち"}</div>
          <div class="act">${esc(d.turn_action)}</div>
        </div>
      </div>`;
    })
    .join("");
  el.querySelectorAll(".deal-row").forEach((row) => {
    row.addEventListener("click", () => {
      selected = Number(row.dataset.i);
      renderList();
      renderDetail();
    });
  });
}

const STEP_META = {
  成立: "マッチング成立",
  お支払い: "買い手が相手へ直接お支払い(IHLはお金を預かりません)",
  発送: "相手が匿名の配送リンクを送付 → 発送",
  受け取り: "届いたら検品(一致確定 / 相違を記録して確定 / もめごと相談)",
  "評価・完了": "受け取り＋評価がそろうと完了。観測データが引き継がれます",
};

function stepperHtml(d) {
  const steps = d.stepper || [];
  return steps
    .map((s, i) => {
      const last = i === steps.length - 1;
      const nowCard =
        s.status === "now" && d.turn === "you"
          ? `<div class="step-now-card"><div class="snc-do">あなたの番:${esc(d.turn_action)}</div>次の操作は下のブロックから行えます。</div>`
          : "";
      const dot = s.status === "done" ? "✓" : String(i + 1);
      return `<div class="step ${s.status}">
        <div class="step-col"><div class="step-dot">${dot}</div>${last ? "" : '<div class="step-line"></div>'}</div>
        <div class="step-body">
          <div class="step-name">${esc(s.name)}${s.status === "now" ? " ← 今ここ" : ""}</div>
          <div class="step-meta">${esc(STEP_META[s.name] || "")}</div>
          ${nowCard}
        </div>
      </div>`;
    })
    .join("");
}

function paymentHtml(d) {
  const p = d.payment || {};
  const confirmMsg = p.confirmed_at
    ? '<span class="v" style="color:var(--primary);">相手が入金を確認しました</span>'
    : p.declared_at
      ? '<span class="v" style="color:var(--secondary);">振込申告済み・相手の確認待ち</span>'
      : '<span class="v" style="color:var(--muted);">まだ確認されていません</span>';
  const mismatch = p.mismatch
    ? `<div class="caution-item"><span class="ci-tag">i</span>相手が「${p.mismatch === "partial" ? "一部だけ入金" : "多く入金"}」を記録しています(自動の返金・充当・ペナルティはありません=ゆる運用)。</div>`
    : `<div class="caution-item"><span class="ci-tag">i</span>金額が食い違ったときは、相手が「<b>一部だけ入金</b>」「<b>多く入金</b>」を記録できます(自動の返金・充当・ペナルティはありません=ゆる運用)。</div>`;
  // 銀行振込は当事者へ直接。売り手は「相手が振込名義に添えるコード」を、買い手は自分が添えるコードを見る。
  const codeRow = d.transfer_code
    ? `<div class="kv-row"><span class="k">${d.role === "buy" ? "振込名義に添える" : "相手が添えるコード"}</span><span class="v"><span class="copycode" id="tcode">${esc(d.transfer_code)}</span> <span class="mini-tap" id="copycode">タップでコピー</span></span></div>`
    : "";
  const declareBtn =
    d.action_kind === "pay_declare"
      ? `<div class="selfdeclare"><span class="btn primary sm" data-act="pay_declare">振込しました(申告)</span><span>→ 相手が入金を確認すると次へ進みます</span></div>`
      : d.action_kind === "pay_confirm"
        ? `<div class="selfdeclare"><span class="btn primary sm" data-act="pay_confirm">入金を確認する</span><span>→ 発送に進めます</span></div>`
        : "";
  return `<div class="method-toggle">
    <div class="method sel">
      <div class="m-head">🏦 銀行振込 <span class="m-tag default">既定・無料</span></div>
      <div class="m-body">相手の口座へ自分の銀行アプリで直接振込。本人確認なし。IHLは関与しません。</div>
      <div class="kv">
        <div class="kv-row"><span class="k">金額</span><span class="v">${yen(d.amount)}</span></div>
        ${codeRow}
      </div>
      ${declareBtn}
    </div>
    <div class="method">
      <div class="m-head">💳 カード払い(PAY.JP) <span class="m-tag opt">オプション</span> <span class="m-tag soon">準備中</span></div>
      <div class="m-body">カードで支払うと、システム維持費<b>5%が自動で差し引かれ</b>残りが相手へ振り込まれます(相手はテナント本人確認が必要)。
        <div class="caution-item" style="margin-top:10px;"><span class="ci-tag">△</span>この方式は<b>まだ使えません</b>。PAY.JP Platformの申込・審査・本番鍵の投入・資金移動業の法的確認が済んでから開放します(準備は完了・テストモードで検証済み)。</div>
      </div>
    </div>
  </div>
  <div class="kv"><div class="kv-row"><span class="k">相手の入金確認</span>${confirmMsg}</div></div>
  ${mismatch}`;
}

function shippingHtml(d) {
  const link = d.shipping_link || {};
  if (link.url) {
    return `<div class="relay"><div class="r-ico">🕊</div><div class="r-body">
      出品者が日本郵便系の匿名配送リンクを中継しました。このリンクで受け取り先を入力します(IHLは住所を保持しません)。
      <div class="r-url">${esc(link.url)}</div>
    </div></div>`;
  }
  return `<div class="relay"><div class="r-ico">🕊</div><div class="r-body">
    出品者が日本郵便系の匿名配送リンクを作って送ります。あなたはそのリンクで受け取り先を入力します(IHLは住所を保持しません)。
    <div style="color:var(--muted);font-size:11.5px;margin-top:6px;">※ まだ発送前のため、このリンクは発送段階で表示されます。</div>
  </div></div>`;
}

function disputeHtml(d) {
  const cr = d.cancel_request || { status: "none" };
  const crLabel = { none: "依頼なし", pending: "承認待ち", approved: "承認された", declined: "却下された" }[cr.status] || "依頼なし";
  const canCancel = d.state === "matched";
  return `<div class="two-col">
    <div class="mini-card">
      <h4>🔁 キャンセルを依頼</h4>
      <p>無料キャンセルの窓(成立から60分)を過ぎたら、相手の承認をもらう方式に切り替わります。</p>
      <div class="cancel-state">今の状態:${esc(crLabel)}</div>
      ${canCancel ? `<span class="btn ghost sm" data-act="cancel_request">キャンセルを依頼する</span>` : ""}
    </div>
    <div class="mini-card">
      <h4>💬 もめごとを相談</h4>
      <p>死着・性別違い・系統違いなどの重大な相違は、受け取り時に自動で相談(話し合いの場)へ回ります。アプリへの不満・改善要望もここへ。</p>
      <div class="cancel-state" style="background:var(--danger-bg);color:var(--danger);">重大相違を見つけたら → 話し合いの場</div>
      <a class="btn ghost sm" href="/s/dispute">話し合いの場をひらく</a>
    </div>
  </div>`;
}

function renderDetail() {
  if (deals.length === 0) return;
  const d = deals[selected] || deals[0];
  const isSell = d.role === "sell";
  $("#detail").innerHTML = `
    <section class="block">
      <div class="section-head">
        <h2 class="section-title">🪜 取引の進み方(この取引の今)</h2>
        <p class="section-caption">成立→お支払い→発送→受け取り→評価→完了。今どこか・誰の番かがひと目で。</p>
      </div>
      <div class="card">
        <div class="detail-head">
          <div class="dh-title">${esc(d.title || "(無題の出品)")}</div>
          <span class="role-pill ${isSell ? "sell" : "buy"}">${isSell ? "出品" : "買う"}</span>
        </div>
        <div class="ctx-chips">
          ${d.counterparty ? `<span class="chip">相手 @${esc(d.counterparty)}</span>` : ""}
          <span class="chip">${yen(d.amount)}</span>
          <span class="chip">${esc(d.state_label)}</span>
        </div>
        <div class="stepper">${stepperHtml(d)}</div>
      </div>
    </section>

    <section class="block">
      <div class="section-head">
        <h2 class="section-title">💳 お支払い方法を選ぶ</h2>
        <p class="section-caption">取引ごとに選べます。IHLはお金を預かりません(非エスクロー)。</p>
      </div>
      <div class="card">${paymentHtml(d)}</div>
    </section>

    <section class="block">
      <div class="section-head">
        <h2 class="section-title">📦 配送(住所を教え合わない)</h2>
        <p class="section-caption">住所はIHLも相手も受け取りません。出品者が外部の配送リンクを中継するだけ。</p>
      </div>
      <div class="card">${shippingHtml(d)}</div>
    </section>

    <section class="block">
      <div class="section-head">
        <h2 class="section-title">🛟 うまくいかない時</h2>
        <p class="section-caption">キャンセル依頼ともめごと相談への入口。深刻な相違は相談へ強制的に回ります。</p>
      </div>
      ${disputeHtml(d)}
    </section>`;

  const copy = $("#copycode");
  if (copy) {
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText($("#tcode").textContent);
        copy.textContent = "コピーしました";
      } catch (e) {
        copy.textContent = "手動でコピーしてください";
      }
    });
  }
  $("#detail").querySelectorAll("[data-act]").forEach((btn) => {
    btn.addEventListener("click", () => doTransition(d.listing_id, btn.dataset.act, btn));
  });
}

async function doTransition(listingId, kind, btn) {
  if (kind === "cancel_request" && !confirm("この取引のキャンセルを相手に依頼します。よろしいですか?")) return;
  btn.textContent = "処理中…";
  const res = await fetch(`/api/v1/market/listings/${encodeURIComponent(listingId)}/transition`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ kind }),
  }).catch(() => null);
  if (res && res.ok) {
    await load(); // 再投影して画面を更新
  } else {
    btn.textContent = "できませんでした(時間をおいて再度)";
  }
}

(async () => {
  if (!(await requireSession())) return;
  // 取引中は観測対象で絞らない例外画面。scope chrome は「すべて」表示で誤解を避ける。
  const scope = $("#gb-scope-name");
  if (scope) scope.textContent = "すべて";
  await load();
})();
