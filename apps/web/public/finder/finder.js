// finder.js — R52(caseB7実物採用)。原型(caseB7/finder.html)のTabulator一覧+
// フィルタ+プリセット+行選択+「宇宙で見る」の"操作の形"はそのまま、データだけを
// 架空乱数生成→実API(同一オリジン・cookie認証)へ配線し直す(CREED①②③④⑤)。
import { computeGenerations, percentileThreshold, speciesColor, requireSession } from "./lib/finder-data.js";

const $ = (sel) => document.querySelector(sel);

function fmtDate(iso) {
  return iso ? String(iso).slice(0, 10) : "—";
}

async function loadRows() {
  const [indRes, linksRes] = await Promise.all([
    fetch("/api/v1/individuals?sort=latest_length_mm&order=desc", { credentials: "include" }),
    fetch("/api/v1/individuals/pedigree-links", { credentials: "include" }),
  ]);
  const individuals = (await indRes.json()).individuals ?? [];
  const links = (await linksRes.json()).links ?? [];
  const ids = individuals.map((i) => i.individual_id);
  const gen = computeGenerations(ids, links);
  return individuals.map((i) => ({
    individual_id: i.individual_id,
    label: i.label,
    species: i.species,
    generation: gen.get(i.individual_id) ?? null,
    latest_length_mm: i.latest_length_mm,
    latest_weight_g: i.latest_weight_g,
    capture_count: i.capture_count,
    last_capture_at: i.last_capture_at,
    lineage_id: i.lineage_id,
  }));
}

async function main() {
  if (!(await requireSession())) return;
  const rows = await loadRows();

  // 種族チップ: 固定H/D/C→実データの種族を動的に列挙(自由記述のため)。
  const speciesValues = [...new Set(rows.map((r) => r.species).filter(Boolean))].sort();
  const chipsEl = $("#speciesChips");
  for (const sp of speciesValues) {
    const b = document.createElement("button");
    b.className = "chip";
    b.dataset.sp = sp;
    b.textContent = sp;
    chipsEl.appendChild(b);
  }

  const table = new Tabulator("#table", {
    data: rows,
    index: "individual_id",
    layout: "fitColumns",
    height: "560px",
    selectableRows: 1,
    placeholder: "まだ個体がいません。観測を記録すると、ここに一覧ができます。",
    initialSort: [{ column: "latest_length_mm", dir: "desc" }],
    columns: [
      { title: "個体名", field: "label", widthGrow: 2 },
      {
        title: "種族",
        field: "species",
        widthGrow: 2,
        sorter: "string",
        formatter: (cell) => {
          const d = cell.getRow().getData();
          if (!d.species) return "—";
          return `<span class="clr-dot" style="color:${speciesColor(d.species)};background:${speciesColor(d.species)}"></span>${d.species}`;
        },
      },
      {
        title: "世代",
        field: "generation",
        width: 64,
        hozAlign: "center",
        sorter: "number",
        formatter: (cell) => {
          const v = cell.getValue();
          return v == null ? "—" : `G${v}`;
        },
      },
      {
        title: "体長 mm",
        field: "latest_length_mm",
        width: 100,
        hozAlign: "right",
        sorter: "number",
        formatter: (cell) => (cell.getValue() == null ? "—" : cell.getValue()),
      },
      {
        title: "体重 g",
        field: "latest_weight_g",
        width: 100,
        hozAlign: "right",
        sorter: "number",
        formatter: (cell) => (cell.getValue() == null ? "—" : cell.getValue()),
      },
      { title: "観測回数", field: "capture_count", width: 90, hozAlign: "right", sorter: "number" },
      {
        title: "直近記録",
        field: "last_capture_at",
        width: 110,
        sorter: "string",
        formatter: (cell) => fmtDate(cell.getValue()),
      },
      {
        title: "系統",
        field: "lineage_id",
        widthGrow: 1,
        formatter: (cell) => cell.getValue() || "—",
      },
    ],
  });

  // ── フィルタ ──────────────────────────────────────────────────────────
  const state = { species: "" };
  function applyFilters() {
    const filters = [];
    if (state.species) filters.push({ field: "species", type: "=", value: state.species });
    const lengthMin = parseFloat($("#lengthMin").value);
    const lengthMax = parseFloat($("#lengthMax").value);
    const weightMin = parseFloat($("#weightMin").value);
    const weightMax = parseFloat($("#weightMax").value);
    if (!isNaN(lengthMin)) filters.push({ field: "latest_length_mm", type: ">=", value: lengthMin });
    if (!isNaN(lengthMax)) filters.push({ field: "latest_length_mm", type: "<=", value: lengthMax });
    if (!isNaN(weightMin)) filters.push({ field: "latest_weight_g", type: ">=", value: weightMin });
    if (!isNaN(weightMax)) filters.push({ field: "latest_weight_g", type: "<=", value: weightMax });
    table.setFilter(filters.length ? filters : []);
  }
  // 種族チップの選択色: 原型の .chip.on.h/.d/.c(固定3種)と同じ「on の間だけ
  // 種族色で塗る」動きを、動的な種族名向けに inline style で再現する。
  function paintChips(activeEl) {
    document.querySelectorAll("#filterbar .chip[data-sp]").forEach((x) => {
      const active = x === activeEl;
      x.classList.toggle("on", active);
      if (x.dataset.sp) {
        x.style.background = active ? speciesColor(x.dataset.sp) : "";
        x.style.borderColor = active ? speciesColor(x.dataset.sp) : "";
      }
    });
  }
  document.querySelectorAll("#filterbar .chip[data-sp]").forEach((c) =>
    c.addEventListener("click", () => {
      state.species = c.dataset.sp;
      paintChips(c);
      applyFilters();
    }),
  );
  ["lengthMin", "lengthMax", "weightMin", "weightMax"].forEach((id) =>
    $("#" + id).addEventListener("input", applyFilters),
  );
  $("#btnResetFilter").addEventListener("click", () => {
    state.species = "";
    ["lengthMin", "lengthMax", "weightMin", "weightMax"].forEach((id) => ($("#" + id).value = ""));
    paintChips(document.querySelector('#filterbar .chip[data-sp=""]'));
    table.setFilter([]);
  });

  // 体長 上位10%: 現在の種族フィルタ後の母集団の実データ分位点を都度計算
  // (design-individual-finder.md §2.3・ハードコード閾値は使わない)。
  $("#btnPreset").addEventListener("click", () => {
    const pop = table.getData("active").map((r) => r.latest_length_mm);
    const threshold = percentileThreshold(pop, 90);
    $("#lengthMin").value = threshold == null ? "" : threshold;
    $("#lengthMax").value = "";
    $("#weightMin").value = "";
    $("#weightMax").value = "";
    table.setSort([{ column: "latest_length_mm", dir: "desc" }]);
    applyFilters();
  });

  // ── 行選択 → 「★宇宙で見る」(原型どおり別タブで宇宙面へ) ────────────────
  let selectedId = null;
  const btnUniverse = $("#btnUniverse");
  table.on("rowSelected", (row) => {
    const d = row.getData();
    selectedId = d.individual_id;
    btnUniverse.disabled = false;
    const gen = d.generation == null ? "—" : `G${d.generation}`;
    const len = d.latest_length_mm == null ? "—" : `${d.latest_length_mm}mm`;
    const wt = d.latest_weight_g == null ? "—" : `${d.latest_weight_g}g`;
    $("#selinfo").innerHTML = `選択: <b>${d.label}</b>(${d.species ?? "種族未記録"}/${gen}・体長${len}・体重${wt})`;
  });
  table.on("rowDeselected", () => {
    selectedId = null;
    btnUniverse.disabled = true;
    $("#selinfo").textContent = "行を選択すると、その個体を宇宙で見られます。";
  });
  btnUniverse.addEventListener("click", () => {
    if (!selectedId) return;
    window.open(`universe.html?focus=${selectedId}`, "_blank");
  });
}

main();
