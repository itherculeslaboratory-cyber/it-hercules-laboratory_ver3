// universe.js — R52(caseB7実物採用)。原型(caseB7/universe-focus.html)の
// 3d-force-graph宇宙+血統発光+近接ラベル/写真カードの"操作の形"はそのまま、
// データだけを架空乱数生成→実API(同一オリジン・cookie認証)へ配線し直す
// (CREED①②③④⑤)。座標は実測値の順位ベース(x=体長rank・y=体重rank・z=世代)、
// 血統は GET /individuals/pedigree-links から都度計算する(誇張ゼロ)。
import { computeGenerations, computeLineage, buildRankCoords, nearestByCoord, speciesColor, requireSession } from "./lib/finder-data.js";

const $ = (s) => document.querySelector(s);

async function loadData() {
  const [indRes, linksRes] = await Promise.all([
    fetch("/api/v1/individuals", { credentials: "include" }),
    fetch("/api/v1/individuals/pedigree-links", { credentials: "include" }),
  ]);
  const individuals = (await indRes.json()).individuals ?? [];
  const links = (await linksRes.json()).links ?? [];
  return { individuals, links };
}

async function main() {
  if (!(await requireSession())) return;
  const { individuals, links } = await loadData();

  const ids = individuals.map((i) => i.individual_id);
  const gen = computeGenerations(ids, links);
  const coords = buildRankCoords(
    individuals.map((i) => ({
      individual_id: i.individual_id,
      length_mm: i.latest_length_mm,
      weight_g: i.latest_weight_g,
      generation: gen.get(i.individual_id) ?? null,
    })),
    250,
  );
  const coordById = new Map(coords.map((c) => [c.individual_id, c]));

  const nodes = individuals.map((i) => {
    const c = coordById.get(i.individual_id);
    const g = gen.get(i.individual_id) ?? null;
    return {
      id: i.individual_id,
      label: i.label,
      species: i.species,
      color: i.species ? speciesColor(i.species) : "#8b94a3",
      gen: g,
      lineageId: i.lineage_id,
      latest_length_mm: i.latest_length_mm,
      latest_weight_g: i.latest_weight_g,
      thumbnail_path: i.thumbnail_path,
      fx: c.x,
      fy: c.y,
      fz: c.z,
      estimated: c.estimated,
      val: g == null ? 5 : g === 0 ? 7 : g === 1 ? 5 : 3.5,
    };
  });
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  // 血統エッジ(source=親->target=子・child_id/parent_idの向きをそのまま可視化)。
  const graphLinks = links.map((l) => ({ source: l.parent_id, target: l.child_id }));
  const sireOf = new Map(), damOf = new Map();
  const childrenOf = new Map();
  for (const l of links) {
    if (l.parent_role === "sire") sireOf.set(l.child_id, l.parent_id);
    else if (l.parent_role === "dam") damOf.set(l.child_id, l.parent_id);
    (childrenOf.get(l.parent_id) ?? childrenOf.set(l.parent_id, []).get(l.parent_id)).push(l.child_id);
  }

  document.getElementById("count").textContent = `個体 ${nodes.length}体 · 血統エッジ ${links.length}本`;

  if (nodes.length === 0) {
    const fb = $("#fallback");
    fb.innerHTML = 'まだ個体がいません。個体は<a class="d-link" href="finder.html" style="color:var(--acc)">ファインダーの一覧</a>から選べます。';
    fb.style.display = "flex";
    return;
  }

  // 種族チップ/凡例: 固定H/D/C→実データの種族を動的に列挙(自由記述のため)。
  // 凡例(#speciesLegend)は#detail(個体詳細)と同じ縦flexカラムを分け合うので、
  // 種族数が多い実データでは凡例だけが伸びて詳細パネルを圧迫する
  // (#legendはflex:none・#detailはflex:1で伸びる側)。原型は固定3種族の凡例
  // だったのでこの競合が無かった — 実データの種族数上限なしを受けて、凡例は
  // 上位6種族+「他N種族」に丸める(絞り込みチップ側は全種族を機能として出す
  // 必要があるため丸めない)。
  const speciesValues = [...new Set(nodes.map((n) => n.species).filter(Boolean))].sort();
  const LEGEND_CAP = 6;
  const legendEl = $("#speciesLegend");
  for (const sp of speciesValues.slice(0, LEGEND_CAP)) {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<span class="dot" style="color:${speciesColor(sp)};background:${speciesColor(sp)}"></span>${sp}`;
    legendEl.appendChild(row);
  }
  if (speciesValues.length > LEGEND_CAP) {
    const more = document.createElement("div");
    more.className = "row";
    more.style.color = "var(--dim)";
    more.style.fontSize = "11px";
    more.textContent = `他${speciesValues.length - LEGEND_CAP}種族(絞り込みチップに全種族あり)`;
    legendEl.appendChild(more);
  }
  const chipsEl = $("#speciesChips");
  for (const sp of speciesValues) {
    const b = document.createElement("button");
    b.className = "chip";
    b.dataset.sp = sp;
    b.textContent = sp;
    chipsEl.appendChild(b);
  }

  const state = { selected: null, speciesFilter: null, scope: null, hlNodes: new Set(), hlLinks: new Set(), ancNodes: new Set(), descNodes: new Set() };
  function isVisible(n) {
    if (state.speciesFilter && n.species !== state.speciesFilter) return false;
    if (state.scope && !state.scope.has(n.id)) return false;
    return true;
  }
  const DIM_NODE = "#39414f", DIM_LINK = "rgba(120,140,175,0.12)";
  const ANC_COLOR = "#4da3ff", DESC_COLOR = "#6ee7a8", SEL_COLOR = "#ff7a1a";

  function lineageFor(id) {
    const { ancestors, descendants, edgeKeys } = computeLineage(id, links);
    return { hlN: new Set([id, ...ancestors, ...descendants]), hlL: edgeKeys, ancN: ancestors, descN: descendants };
  }
  const lk = (l) => {
    const s = typeof l.source === "object" ? l.source.id : l.source;
    const t = typeof l.target === "object" ? l.target.id : l.target;
    return `${s}->${t}`;
  };
  function linkCategory(l) {
    const key = lk(l);
    if (!state.hlLinks.has(key)) return null;
    const t = typeof l.target === "object" ? l.target.id : l.target;
    return t === state.selected || state.ancNodes.has(t) ? "anc" : "desc";
  }

  let webglOk = true;
  let Graph;
  try {
    Graph = ForceGraph3D()(document.getElementById("graph3d"))
      .backgroundColor("#0d0f13")
      .graphData({ nodes, links: graphLinks })
      .nodeId("id")
      .nodeLabel((n) => `<div style="font-family:inherit;background:#161a21;border:1px solid #262c36;border-radius:8px;padding:11px 14px;min-width:180px">
        <div style="font-size:16px;font-weight:800;color:#ffffff;line-height:1.3">${n.label}</div>
        <div style="font-size:14px;font-weight:700;color:${n.color};margin-top:4px">${n.species ?? "種族未記録"} <span style="color:#8b94a3;font-weight:400;font-size:11.5px">/ ${n.gen == null ? "世代不明" : "G" + n.gen + "世代"}</span></div>
        <div style="font-size:11px;color:#8b94a3;margin-top:6px">体長 ${n.latest_length_mm ?? "—"}mm ・ 体重 ${n.latest_weight_g ?? "—"}g</div>
      </div>`)
      .nodeVal("val")
      .nodeColor((n) => {
        if (!state.hlNodes.size) return n.color;
        if (!state.hlNodes.has(n.id)) return DIM_NODE;
        if (n.id === state.selected) return SEL_COLOR;
        if (state.ancNodes.has(n.id)) return ANC_COLOR;
        if (state.descNodes.has(n.id)) return DESC_COLOR;
        return n.color;
      })
      .nodeOpacity(0.95)
      .nodeResolution(12)
      .nodeVisibility(isVisible)
      .linkVisibility((l) => isVisible(nodeById.get(typeof l.source === "object" ? l.source.id : l.source)) && isVisible(nodeById.get(typeof l.target === "object" ? l.target.id : l.target)))
      .linkColor((l) => {
        const cat = linkCategory(l);
        return cat === "anc" ? "rgba(77,163,255,0.85)" : cat === "desc" ? "rgba(110,231,168,0.85)" : DIM_LINK;
      })
      .linkWidth((l) => (linkCategory(l) ? 1.6 : 0.4))
      .linkDirectionalParticles((l) => (linkCategory(l) ? 3 : 0))
      .linkDirectionalParticleSpeed(0.006)
      .linkDirectionalParticleWidth(2.2)
      .linkDirectionalParticleColor((l) => {
        const cat = linkCategory(l);
        return cat === "anc" ? ANC_COLOR : cat === "desc" ? DESC_COLOR : "#ffb066";
      })
      .enableNodeDrag(false)
      .showNavInfo(false)
      .onNodeClick((n) => selectNode(n.id));
  } catch {
    webglOk = false;
  }
  if (!webglOk || !Graph) {
    $("#fallback").style.display = "flex";
    return;
  }

  const controls = Graph.controls();
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.5;
  const R = 820;
  Graph.cameraPosition({ x: 0, y: 150, z: R });

  function refresh() {
    Graph.nodeColor(Graph.nodeColor())
      .nodeVisibility(Graph.nodeVisibility())
      .linkVisibility(Graph.linkVisibility())
      .linkColor(Graph.linkColor())
      .linkWidth(Graph.linkWidth())
      .linkDirectionalParticles(Graph.linkDirectionalParticles())
      .linkDirectionalParticleColor(Graph.linkDirectionalParticleColor());
  }

  function setMode(t) {
    $("#modelabel").textContent = t;
  }

  // ── 個体詳細パネル(FinderDetailPanel相当・血統+形質プロファイル+実写真) ──
  const detailEl = $("#detail");
  function renderDetail(id) {
    const n = nodeById.get(id);
    const sireId = sireOf.get(id), damId = damOf.get(id);
    const sireLink = sireId && nodeById.has(sireId) ? `<a class="d-link" data-id="${sireId}">${nodeById.get(sireId).label}</a>` : '<span style="color:var(--dim)">— (記録なし・初代)</span>';
    const damLink = damId && nodeById.has(damId) ? `<a class="d-link" data-id="${damId}">${nodeById.get(damId).label}</a>` : '<span style="color:var(--dim)">— (記録なし・初代)</span>';
    const kids = (childrenOf.get(id) ?? []).filter((c) => nodeById.has(c));
    const kidsHtml = kids.length ? kids.map((c) => `<a class="d-link" data-id="${c}">${nodeById.get(c).label}</a>`).join("、") : '<span style="color:var(--dim)">— (子の記録なし)</span>';
    const profileHtml = [
      ["体長mm", n.latest_length_mm ?? "—"],
      ["体重g", n.latest_weight_g ?? "—"],
      ["世代", n.gen == null ? "—" : "G" + n.gen],
    ].map(([k, v]) => `<div><span class="k">${k}</span><span class="v">${v}</span></div>`).join("");
    const imgHtml = n.thumbnail_path ? `<img src="${n.thumbnail_path}" alt="">` : "写真未登録";
    detailEl.innerHTML = `
      <div class="d-top">
        <div class="d-img">${imgHtml}</div>
        <div>
          <div class="d-name">${n.label}</div>
          <div class="d-species" style="color:${n.color}">${n.species ?? "種族未記録"}</div>
          <div class="d-gen">世代 ${n.gen == null ? "不明" : "G" + n.gen} ・ 系統 ${n.lineageId ?? "—"}</div>
        </div>
      </div>
      <div class="d-sec">
        <div class="d-lab">個体ID</div>
        <div class="d-id">${n.id}</div>
      </div>
      <div class="d-sec">
        <div class="d-lab">血統(クリックで辿れる)</div>
        <div class="d-rel"><b>親(sire)</b>${sireLink}<br><b>親(dam)</b>${damLink}<br><b>子(${kids.length})</b>${kidsHtml}</div>
      </div>
      <div class="d-sec">
        <div class="d-lab">形質プロファイル(実測値)</div>
        <div class="d-grid">${profileHtml}</div>
      </div>
      <div class="d-sec d-sec-cta">
        <button type="button" class="btn primary" id="btnOpenDetail" data-id="${n.id}">詳細画面を開く</button>
      </div>
    `;
    detailEl.classList.add("show");
  }
  detailEl.addEventListener("click", (e) => {
    const a = e.target.closest(".d-link");
    if (a) return selectNode(a.dataset.id);
    const b = e.target.closest("#btnOpenDetail");
    if (b) location.href = `/s/individual-detail?id=${encodeURIComponent(b.dataset.id)}`;
  });

  function selectNode(id) {
    state.selected = id;
    state.scope = null;
    const { hlN, hlL, ancN, descN } = lineageFor(id);
    state.hlNodes = hlN;
    state.hlLinks = hlL;
    state.ancNodes = ancN;
    state.descNodes = descN;
    const n = nodeById.get(id);
    $("#starglow").style.background = `radial-gradient(circle, ${hexA(SEL_COLOR, 0.9)} 0%, ${hexA(SEL_COLOR, 0)} 68%)`;
    $("#btnSimilar").disabled = false;
    $("#selinfo").innerHTML = `選択: <b>${n.label}</b>(${n.species ?? "種族未記録"}/${n.gen == null ? "世代不明" : "G" + n.gen}) — 血統ハイライト <span class="accent">先祖${ancN.size} · 子孫${descN.size}</span>`;
    setMode("血統をたどる(発光) + 個体詳細");
    renderDetail(id);
    updateLineageLegend();
    refresh();
  }
  function updateLineageLegend() {
    $("#lineageLegend").style.display = state.hlNodes.size ? "block" : "none";
  }

  function frameNodes(ids) {
    let cx = 0, cy = 0, cz = 0, k = 0;
    ids.forEach((id) => {
      const n = nodeById.get(id);
      cx += n.fx; cy += n.fy; cz += n.fz; k++;
    });
    cx /= k; cy /= k; cz /= k;
    let maxd = 1;
    ids.forEach((id) => {
      const n = nodeById.get(id);
      maxd = Math.max(maxd, Math.hypot(n.fx - cx, n.fy - cy, n.fz - cz));
    });
    const dist = Math.max(200, maxd * 3 + 120);
    Graph.cameraPosition({ x: cx, y: cy + 30, z: cz + dist }, { x: cx, y: cy, z: cz }, 900);
  }

  function scopeSimilar() {
    if (!state.selected) return;
    const near = nearestByCoord(state.selected, coords, 12);
    state.scope = new Set([state.selected, ...near]);
    frameNodes([...state.scope]);
    state.hlNodes = new Set(); state.hlLinks = new Set(); state.ancNodes = new Set(); state.descNodes = new Set();
    updateLineageLegend();
    const self = nodeById.get(state.selected);
    const cross = near.filter((x) => nodeById.get(x).species !== self.species).length;
    $("#selinfo").innerHTML = `<b>${self.label}</b> に近い <span class="accent">${near.length}体</span>を表示中` + (cross ? ` — うち<span class="accent">他種族 ${cross}体</span>(順位が近い)` : ` — 同種族で密集`);
    setMode("近傍スコープ(この個体に近い)");
    refresh();
  }

  function filterSpecies(sp) {
    state.speciesFilter = sp === "" ? null : sp;
    document.querySelectorAll("#controls .chip").forEach((c) => c.classList.toggle("on", c.dataset.sp === sp));
    setMode(sp === "" ? "全体表示(星空)" : `${sp} で切り出し`);
    refresh();
    if (sp === "") Graph.cameraPosition({ x: 0, y: 150, z: R }, { x: 0, y: 0, z: 0 }, 900);
    else frameNodes(nodes.filter((n) => n.species === sp).map((n) => n.id));
  }
  function resetAll() {
    state.selected = null; state.speciesFilter = null; state.scope = null;
    state.hlNodes = new Set(); state.hlLinks = new Set(); state.ancNodes = new Set(); state.descNodes = new Set();
    document.querySelectorAll("#controls .chip").forEach((c) => c.classList.toggle("on", c.dataset.sp === ""));
    $("#btnSimilar").disabled = true;
    $("#selinfo").textContent = "星(個体)をクリックすると血統ラインが発光し、右に個体詳細が開きます。";
    setMode("全体表示(星空)");
    detailEl.classList.remove("show");
    updateLineageLegend();
    refresh();
    Graph.cameraPosition({ x: 0, y: 150, z: R }, { x: 0, y: 0, z: 0 }, 900);
  }

  function hexA(hex, a) {
    const h = hex.replace("#", "");
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6),16);
    return `rgba(${r},${g},${b},${a})`;
  }

  document.querySelectorAll("#controls .chip").forEach((c) => c.addEventListener("click", () => filterSpecies(c.dataset.sp)));
  $("#btnSimilar").addEventListener("click", scopeSimilar);
  $("#btnReset").addEventListener("click", resetAll);

  // ── 近接ラベル + 写真カード(だいぶ近づいたら 丸→写真。実写真が無ければ
  //    「写真未登録」の正直文言)。プールをDOMに事前生成し毎フレーム距離判定。 ──
  const LABEL_DIST = 340;
  const IMAGE_DIST = 130;
  const labelsRoot = $("#labels");
  const imgCardsRoot = $("#imagecards");
  const labelEls = new Map(), imgCardEls = new Map();
  for (const n of nodes) {
    const el = document.createElement("div");
    el.className = "plabel";
    el.style.borderLeftColor = n.color;
    el.textContent = n.label;
    labelsRoot.appendChild(el);
    labelEls.set(n.id, el);

    const card = document.createElement("div");
    card.className = "imgcard";
    const ph = n.thumbnail_path ? `<img src="${n.thumbnail_path}" alt="">` : "写真<br>未登録";
    card.innerHTML = `<div class="imgcard-ph" style="border-color:${n.color}">${ph}</div><div class="imgcard-lab">${n.label}</div>`;
    imgCardsRoot.appendChild(card);
    imgCardEls.set(n.id, card);
  }
  function updateLabels(camPos) {
    for (const n of nodes) {
      const el = labelEls.get(n.id), img = imgCardEls.get(n.id);
      if (!isVisible(n)) { el.style.display = "none"; img.style.display = "none"; continue; }
      const d = Math.hypot(n.fx - camPos.x, n.fy - camPos.y, n.fz - camPos.z);
      if (d < IMAGE_DIST) {
        const c = Graph.graph2ScreenCoords(n.fx, n.fy, n.fz);
        img.style.left = c.x + "px"; img.style.top = c.y + "px"; img.style.display = "flex";
        el.style.display = "none";
      } else if (d < LABEL_DIST) {
        const c = Graph.graph2ScreenCoords(n.fx, n.fy, n.fz);
        el.style.left = c.x + "px"; el.style.top = c.y + "px"; el.style.display = "block";
        img.style.display = "none";
      } else {
        el.style.display = "none"; img.style.display = "none";
      }
    }
  }

  const glow = $("#starglow");
  (function loop() {
    if (state.selected && nodeById.has(state.selected) && isVisible(nodeById.get(state.selected))) {
      const n = nodeById.get(state.selected);
      const c = Graph.graph2ScreenCoords(n.fx, n.fy, n.fz);
      glow.style.left = c.x + "px"; glow.style.top = c.y + "px"; glow.style.display = "block";
    } else {
      glow.style.display = "none";
    }
    updateLabels(Graph.camera().position);
    requestAnimationFrame(loop);
  })();

  // ── finder.html 連携: ?focus=個体ID でその個体をフォーカス表示 ──────────
  const focusId = new URLSearchParams(location.search).get("focus");
  if (focusId && nodeById.has(focusId)) {
    setTimeout(() => {
      selectNode(focusId);
      const n = nodeById.get(focusId);
      Graph.cameraPosition({ x: n.fx, y: n.fy + 18, z: n.fz + 90 }, { x: n.fx, y: n.fy, z: n.fz }, 900);
      const banner = $("#focusbanner");
      banner.textContent = `個体ファインダーからフォーカス中: ${n.label}(${n.species ?? "種族未記録"})`;
      banner.style.display = "block";
    }, 400);
  } else if (focusId) {
    console.warn("focus id not found:", focusId);
  }
}

main();
