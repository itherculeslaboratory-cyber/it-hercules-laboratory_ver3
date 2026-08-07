"use client";

// GraphView — g81-bundleD(V3-UIX-82/V3-UIX-83第2段・uib11finderway ○90「同じ部品で
// かたっくのがとってもいい」)。旧 apps/web/public/finder/universe.js(vanilla-JS・
// caseB7実物)の3d-force-graph宇宙面を、同じアルゴリズム(../universe-utils.ts)の
// 上に React 部品として作り直したもの。renderer.tsx の GraphViewNode がデータ取得
// (GET /individuals + /individuals/pedigree-links)を配線し、この部品自体は
// individuals/links を受け取るだけの再利用可能な"部品"(uib09検索グラフビューが
// 同じ props 形で後から乗る想定)。
//
// 正直な限界(誇張ゼロ。判断根拠は報告書参照):
//  - w1-universe(R0807-d01d30/2026-08-07)で近接ラベル/画像カード(universe-focus.html:
//    530-579)・呼吸発光(:176-183,569-579)・「★この個体に近い」のカメラ寄せ(:477-497)を
//    移植済み。画像カードは実データの thumbnail_path があれば実観測写真を表示し、
//    無い個体は「写真未登録」と正直表示する(プレースホルダのまま出さない・
//    LAUNCH1600-2 B裁定=2026-08-07ユーザー逐語「機能としては完成させたい」)。
//  - 6次元ベクトル(universe.js の擬似観測ベクトル)は実個体データに存在しないため、
//    座標配置は実測形質軸(体長・体重・世代)のランク正規化、近傍探索はcosine類似では
//    なくこの実測軸空間でのユークリッド距離を使う(誇張ゼロ・universe-utils.ts参照)。
//  - 種族/選択/血統ハイライトの配色はThemePackトークン(--civ-*)を再利用する
//    (universe.js の固定hexパレットは check-ui-tokens.mjs GATE が禁止するため
//    そのまま移植できない)。ANC/DESC相当のトークンが無いため --civ-info/
//    --civ-caution を代用する。種族専用のSSOTトークン新設(design-tokens.json)は、
//    codegen-theme-css.mjsのCOLOR_KEYS配列とschemas/events/theme-pack.schema.jsonの
//    additionalProperties:falseの両方が新規キーを拒否する構造であり、この2ファイルは
//    w1-universe発注書の「触ってよいファイル」に含まれないため未実施(判断が要った箇所
//    参照)。
//  - カメラの自動フレーミング(frameNodes)は初期位置・「★この個体に近い」使用時のみ。
//    種族フィルタ切替時の自動フレーミングは省略(オービットコントロールで手動視点変更は可能)。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import styles from "./graph-overlay.module.css";
import {
  computeLineage,
  computeGenerations,
  buildUniverseCoords,
  nearestByCoord,
  speciesColorVar,
  type PedigreeLink,
} from "../universe-utils";

export type { PedigreeLink };

// universe-focus.html:531-532 の近接ラベル/画像カード閾値をそのまま踏襲
// (座標系のspread=250はbuildUniverseCoordsの既定値と一致・R0807-d01d30 T2-4)。
const LABEL_DIST = 340;
const IMAGE_DIST = 130;

export interface GraphViewIndividual {
  individual_id: string;
  label: string;
  species: string | null;
  lineage_id?: string | null;
  latest_length_mm: number | null;
  latest_weight_g: number | null;
  thumbnail_path?: string | null;
}

export interface GraphViewProps {
  individuals: GraphViewIndividual[];
  links: PedigreeLink[];
  /** ?focus=個体ID ディープリンク相当(finder.js「★宇宙で見る」からの遷移)。 */
  focusId?: string | null;
  onOpenDetail?: (id: string) => void;
  /** 0件時の正直フォールバック導線(例: finder.htmlの一覧へ)。 */
  emptyHref?: string;
  emptyLabel?: string;
}

function resolveVar(name: string): string {
  if (typeof window === "undefined") return "gray";
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || "gray";
}

function linkEndpoints(l: { source: unknown; target: unknown }): { s: string; t: string } {
  const s = typeof l.source === "object" && l.source ? (l.source as { id: string }).id : String(l.source);
  const t = typeof l.target === "object" && l.target ? (l.target as { id: string }).id : String(l.target);
  return { s, t };
}
function linkKey(l: { source: unknown; target: unknown }): string {
  const { s, t } = linkEndpoints(l);
  return `${s}->${t}`;
}

export function GraphView({ individuals, links, focusId, onOpenDetail, emptyHref, emptyLabel }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<any>(null);
  const appliedFocus = useRef(false);
  const [webglOk, setWebglOk] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [speciesFilter, setSpeciesFilter] = useState<string | null>(null);
  const [scopeIds, setScopeIds] = useState<Set<string> | null>(null);

  // 近接ラベル/画像カード/呼吸発光(universe-focus.html:530-579)のオーバーレイ層。
  // 位置は毎フレームDOM直書き換えなのでReact stateにしない(mock踏襲・再描画回避)。
  const labelsRootRef = useRef<HTMLDivElement | null>(null);
  const imgCardsRootRef = useRef<HTMLDivElement | null>(null);
  const glowRef = useRef<HTMLDivElement | null>(null);
  const labelElsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const imgCardElsRef = useRef<Map<string, HTMLDivElement>>(new Map());

  const gen = useMemo(
    () => computeGenerations(individuals.map((i) => i.individual_id), links),
    [individuals, links],
  );
  const coords = useMemo(
    () =>
      buildUniverseCoords(
        individuals.map((i) => ({
          individual_id: i.individual_id,
          length_mm: i.latest_length_mm,
          weight_g: i.latest_weight_g,
          generation: gen.get(i.individual_id) ?? null,
        })),
      ),
    [individuals, gen],
  );
  const coordById = useMemo(() => new Map(coords.map((c) => [c.individual_id, c])), [coords]);
  const nodeById = useMemo(() => new Map(individuals.map((i) => [i.individual_id, i])), [individuals]);

  const graphNodes = useMemo(
    () =>
      individuals.map((i) => {
        const c = coordById.get(i.individual_id);
        return {
          id: i.individual_id,
          label: i.label,
          species: i.species,
          fx: c?.x ?? 0,
          fy: c?.y ?? 0,
          fz: c?.z ?? 0,
        };
      }),
    [individuals, coordById],
  );
  const nodeMetaById = useMemo(() => new Map(graphNodes.map((n) => [n.id, n])), [graphNodes]);

  // RAFループ(下記)から常に最新値を読むためのref同期。selectNodeRef(既存)と同じ
  // 「レンダー本体で直接ref代入」パターン(このファイル内の既存規約)。
  const overlayStateRef = useRef({ graphNodes, nodeMetaById, speciesFilter, scopeIds, selected });
  overlayStateRef.current = { graphNodes, nodeMetaById, speciesFilter, scopeIds, selected };
  const graphLinks = useMemo(() => links.map((l) => ({ source: l.parent_id, target: l.child_id })), [links]);

  const sireOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of links) if (l.parent_role === "sire") m.set(l.child_id, l.parent_id);
    return m;
  }, [links]);
  const damOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of links) if (l.parent_role === "dam") m.set(l.child_id, l.parent_id);
    return m;
  }, [links]);
  const childrenOf = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const l of links) {
      if (!m.has(l.parent_id)) m.set(l.parent_id, []);
      m.get(l.parent_id)!.push(l.child_id);
    }
    return m;
  }, [links]);

  const speciesValues = useMemo(
    () => Array.from(new Set(individuals.map((i) => i.species).filter((s): s is string => !!s))).sort(),
    [individuals],
  );

  const lineage = useMemo(() => (selected ? computeLineage(selected, links) : null), [selected, links]);

  const selectNode = useCallback((id: string) => {
    setSelected(id);
    setScopeIds(null);
  }, []);
  const selectNodeRef = useRef(selectNode);
  selectNodeRef.current = selectNode;

  // 初期化はGraphインスタンスが未取得の間だけ試みる(WebGL未対応環境はhonest
  // fallbackへ倒す — universe.js の try/catch webglOk パターンをそのまま踏襲)。
  // graphRef.current で判定する(先行するmountAttemptedフラグ方式は、React
  // StrictModeの開発時ダブル起動でcleanup→再実行が走ると、1回目の非同期処理が
  // cancelled=trueのまま握りつぶされ2回目の再試行もブロックする実バグを踏んだ
  // ため撤去した=実ブラウザでcanvas/fallbackのどちらも一切出ない不具合を実機で
  // 確認・修正済み)。
  useEffect(() => {
    if (!containerRef.current || graphNodes.length === 0 || graphRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const mod = await import("3d-force-graph");
        const ForceGraph3D = mod.default;
        if (cancelled || !containerRef.current) return;
        const Graph = ForceGraph3D()(containerRef.current)
          .backgroundColor(resolveVar("--civ-bg"))
          .nodeId("id")
          .nodeLabel((n: { label: string }) => n.label)
          .nodeVal(() => 5)
          .nodeResolution(10)
          .enableNodeDrag(false)
          .showNavInfo(false)
          .onNodeClick((n: { id: string }) => selectNodeRef.current(n.id));
        const controls = Graph.controls?.();
        if (controls) {
          controls.autoRotate = true;
          controls.autoRotateSpeed = 0.4;
        }
        Graph.cameraPosition({ x: 0, y: 120, z: 620 });
        graphRef.current = Graph;
        setWebglOk(true);
      } catch {
        if (!cancelled) setWebglOk(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [graphNodes.length]);

  // データ・ハイライト・絞り込みをGraphインスタンスへ反映(universe.js refresh()相当)。
  // 依存配列に webglOk を含める(g82-camerafit T1で発見・修正): graphRef.current は
  // ref なので値が変わってもこのeffectは再実行されない。実データでは個体一覧の
  // fetchがGraph初期化(3d-force-graphの非同期import)より先に終わることが多く、
  // webglOkが無いとGraphインスタンス生成後にgraphData()が一度も呼ばれないまま
  // (=3D領域にノードが1つも投入されない)になる実バグがあった。3D領域が実データで
  // 空白に見える根本原因はこれであり、カメラ位置の問題ではなかった。
  useEffect(() => {
    const Graph = graphRef.current;
    if (!Graph) return;
    const hlNodes = lineage
      ? new Set<string>([selected as string, ...lineage.ancestors, ...lineage.descendants])
      : new Set<string>();
    const hlLinks = lineage ? lineage.edgeKeys : new Set<string>();
    const selColor = resolveVar("--civ-primary");
    const ancColor = resolveVar("--civ-info");
    const descColor = resolveVar("--civ-caution");
    const dimNode = resolveVar("--civ-text-muted");
    const dimLink = resolveVar("--civ-border");
    const speciesColor = (species: string | null) => (species ? resolveVar(speciesColorVar(species)) : dimNode);
    const isVisibleId = (id: string) => {
      const n = nodeMetaById.get(id);
      if (!n) return false;
      if (speciesFilter && n.species !== speciesFilter) return false;
      if (scopeIds && !scopeIds.has(id)) return false;
      return true;
    };
    Graph.graphData({ nodes: graphNodes, links: graphLinks })
      .nodeColor((n: { id: string; species: string | null }) => {
        if (!hlNodes.size) return speciesColor(n.species);
        if (!hlNodes.has(n.id)) return dimNode;
        if (n.id === selected) return selColor;
        if (lineage?.ancestors.has(n.id)) return ancColor;
        if (lineage?.descendants.has(n.id)) return descColor;
        return speciesColor(n.species);
      })
      .nodeVisibility((n: { id: string }) => isVisibleId(n.id))
      .linkVisibility((l: { source: unknown; target: unknown }) => {
        const { s, t } = linkEndpoints(l);
        return isVisibleId(s) && isVisibleId(t);
      })
      .linkColor((l: { source: unknown; target: unknown }) => {
        const key = linkKey(l);
        if (!hlLinks.has(key)) return dimLink;
        const { t } = linkEndpoints(l);
        return t === selected || lineage?.ancestors.has(t) ? ancColor : descColor;
      })
      .linkWidth((l: { source: unknown; target: unknown }) => (hlLinks.has(linkKey(l)) ? 1.6 : 0.4))
      .linkDirectionalParticles((l: { source: unknown; target: unknown }) => (hlLinks.has(linkKey(l)) ? 3 : 0));
  }, [graphNodes, graphLinks, selected, speciesFilter, scopeIds, lineage, nodeMetaById, webglOk]);

  // ?focus=id ディープリンク: Graph初期化後・データがある時に1度だけ選択する。
  useEffect(() => {
    // 選択(=個体詳細パネル)はWebGL成否と独立させる: Graph未対応端末でも詳細
    // パネルはReact stateだけで動くので、フォールバック表示時にも機能する。
    if (appliedFocus.current) return;
    if (!focusId || !nodeMetaById.has(focusId)) return;
    appliedFocus.current = true;
    selectNode(focusId);
  }, [focusId, nodeMetaById, selectNode]);

  // カメラ初期フレーミング(zoomToFit相当・g82-camerafit): 実データの座標分布に
  // 応じて全ノードが視野に収まる位置へカメラを寄せる。固定値{0,120,620}は
  // 座標が広い/狭いデータで空白に見える(束D正直な限界)ため、ノード集合が
  // 実際に変わった時だけ1回フレーミングする(選択・絞り込みの再描画では動かさない
  // = 操作中に勝手にカメラが動く体験を避ける)。ライブラリ標準API
  // (3d-force-graph の zoomToFit)をそのまま使い、旧universe.jsのframeNodesは
  // 自作しない(reuse-first)。focusIdがある場合は旧universe.jsのフォーカス
  // 挙動(選択個体の近傍へ寄る)を踏襲する。
  const framedNodesKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const Graph = graphRef.current;
    if (!Graph || graphNodes.length === 0) return;
    const key = graphNodes.map((n) => n.id).join(",");
    if (framedNodesKeyRef.current === key) return;
    framedNodesKeyRef.current = key;
    if (focusId && nodeMetaById.has(focusId)) {
      const n = nodeMetaById.get(focusId)!;
      Graph.cameraPosition({ x: n.fx, y: n.fy + 18, z: n.fz + 90 }, { x: n.fx, y: n.fy, z: n.fz }, 900);
    } else {
      Graph.zoomToFit(900, 80);
    }
  }, [graphNodes, focusId, nodeMetaById, webglOk]);

  // 近接ラベル/画像カードのDOM要素をプール生成(mock踏襲・universe-focus.html:536-549)。
  // individuals(=graphNodes)が変わった時だけ作り直す。位置は下のRAFループが毎フレーム書き換える。
  useEffect(() => {
    const labelsRoot = labelsRootRef.current;
    const imgCardsRoot = imgCardsRootRef.current;
    if (!labelsRoot || !imgCardsRoot) return;
    labelsRoot.innerHTML = "";
    imgCardsRoot.innerHTML = "";
    const labelEls = new Map<string, HTMLDivElement>();
    const imgCardEls = new Map<string, HTMLDivElement>();
    for (const n of graphNodes) {
      const ind = nodeById.get(n.id);
      const color = ind?.species ? resolveVar(speciesColorVar(ind.species)) : resolveVar("--civ-text-muted");

      const label = document.createElement("div");
      label.className = styles.label;
      label.style.borderLeftColor = color;
      label.textContent = n.label;
      labelsRoot.appendChild(label);
      labelEls.set(n.id, label);

      const card = document.createElement("div");
      card.className = styles.imgCard;
      // 実写真配線(LAUNCH1600-2 B・R0807-d01d30裁定): thumbnail_pathがあれば実観測写真を
      // 表示する。無い個体は正直プレースホルダ(サンプル未接続ではなく「写真未登録」=実データの
      // 正直表示)。
      if (ind?.thumbnail_path) {
        const img = document.createElement("img");
        img.className = styles.imgCardPhoto;
        img.src = ind.thumbnail_path;
        img.alt = "";
        card.appendChild(img);
      } else {
        const ph = document.createElement("div");
        ph.className = styles.imgCardPh;
        ph.style.borderColor = color;
        ph.textContent = "写真未登録";
        card.appendChild(ph);
      }
      const lab = document.createElement("div");
      lab.className = styles.imgCardLab;
      lab.textContent = n.label;
      card.appendChild(lab);
      imgCardsRoot.appendChild(card);
      imgCardEls.set(n.id, card);
    }
    labelElsRef.current = labelEls;
    imgCardElsRef.current = imgCardEls;
  }, [graphNodes, nodeById]);

  // 呼吸発光+近接ラベル/画像カード: 毎フレームDOM位置更新(universe-focus.html:569-579踏襲)。
  // webglOk===true(Graphインスタンス確立後)にだけ1本のRAFループを張る。
  useEffect(() => {
    if (!webglOk) return;
    const Graph = graphRef.current;
    if (!Graph) return;
    let raf = 0;
    const loop = () => {
      const { graphNodes: nodes, nodeMetaById: metaById, speciesFilter: spFilter, scopeIds: scope, selected: sel } =
        overlayStateRef.current;
      const camPos = Graph.camera().position;
      if (glowRef.current) {
        const n = sel ? metaById.get(sel) : null;
        if (n) {
          const c = Graph.graph2ScreenCoords(n.fx, n.fy, n.fz);
          glowRef.current.style.left = `${c.x}px`;
          glowRef.current.style.top = `${c.y}px`;
          glowRef.current.style.display = "block";
        } else {
          glowRef.current.style.display = "none";
        }
      }
      for (const n of nodes) {
        const label = labelElsRef.current.get(n.id);
        const card = imgCardElsRef.current.get(n.id);
        if (!label || !card) continue;
        const visible = (!spFilter || n.species === spFilter) && (!scope || scope.has(n.id));
        if (!visible) {
          label.style.display = "none";
          card.style.display = "none";
          continue;
        }
        const d = Math.hypot(n.fx - camPos.x, n.fy - camPos.y, n.fz - camPos.z);
        if (d < IMAGE_DIST) {
          const c = Graph.graph2ScreenCoords(n.fx, n.fy, n.fz);
          card.style.left = `${c.x}px`;
          card.style.top = `${c.y}px`;
          card.style.display = "flex";
          label.style.display = "none";
        } else if (d < LABEL_DIST) {
          const c = Graph.graph2ScreenCoords(n.fx, n.fy, n.fz);
          label.style.left = `${c.x}px`;
          label.style.top = `${c.y}px`;
          label.style.display = "block";
          card.style.display = "none";
        } else {
          label.style.display = "none";
          card.style.display = "none";
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [webglOk]);

  const handleNear = () => {
    if (!selected) return;
    const near = nearestByCoord(selected, coords, 12);
    const scope = new Set([selected, ...near]);
    setScopeIds(scope);
    // カメラを近傍スコープへ寄せる(universe-focus.html:477-482 frameNodes踏襲)。
    const Graph = graphRef.current;
    if (Graph) {
      const pts = Array.from(scope)
        .map((id) => coordById.get(id))
        .filter((c): c is NonNullable<typeof c> => !!c);
      if (pts.length) {
        const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
        const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
        const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
        const maxd = Math.max(1, ...pts.map((p) => Math.hypot(p.x - cx, p.y - cy, p.z - cz)));
        const dist = Math.max(200, maxd * 3 + 120);
        Graph.cameraPosition({ x: cx, y: cy + 30, z: cz + dist }, { x: cx, y: cy, z: cz }, 900);
      }
    }
  };
  const handleReset = () => {
    setSelected(null);
    setSpeciesFilter(null);
    setScopeIds(null);
  };
  const handleSpeciesChip = (sp: string) => {
    setSpeciesFilter((cur) => (cur === sp ? null : sp));
  };

  if (individuals.length === 0) {
    return (
      <p className="civ-empty" data-testid="graph-view-empty">
        まだ個体がいません。
        {emptyHref && emptyLabel ? (
          <>
            {" "}
            個体は<a className="civ-link" href={emptyHref}>{emptyLabel}</a>から選べます。
          </>
        ) : null}
      </p>
    );
  }

  const selectedIndividual = selected ? nodeById.get(selected) ?? null : null;
  const sireId = selected ? sireOf.get(selected) : undefined;
  const damId = selected ? damOf.get(selected) : undefined;
  const kids = selected ? childrenOf.get(selected) ?? [] : [];

  // 近傍スコープ中(★この個体に近い)は他種族件数を添える(universe-focus.html:492-494踏襲)。
  let statusText: string;
  if (scopeIds && selectedIndividual) {
    const crossCount = Array.from(scopeIds).filter(
      (id) => id !== selected && nodeById.get(id)?.species !== selectedIndividual.species,
    ).length;
    statusText = `${selectedIndividual.label} に近い ${scopeIds.size - 1}体だけを切り出し表示${
      crossCount ? ` — うち他種族 ${crossCount}体(距離的に類似)` : " — 同種族で密集"
    }`;
  } else if (selectedIndividual) {
    statusText = `選択: ${selectedIndividual.label}(${selectedIndividual.species ?? "種族未記録"}) — 血統ハイライト 先祖${
      lineage?.ancestors.size ?? 0
    } ・ 子孫${lineage?.descendants.size ?? 0}`;
  } else {
    statusText = "星(個体)をクリックすると血統ラインがハイライトされ、下に個体詳細が開きます。";
  }

  return (
    <div className="civ-graph-view" data-testid="graph-view-root">
      <div className="civ-graph-view-controls">
        <button
          type="button"
          className={cn("civ-interactive", "civ-badge", "civ-facet-chip")}
          aria-pressed={speciesFilter === null}
          onClick={() => setSpeciesFilter(null)}
        >
          すべて
        </button>
        {speciesValues.map((sp) => (
          <button
            key={sp}
            type="button"
            className={cn("civ-interactive", "civ-badge", "civ-facet-chip")}
            aria-pressed={speciesFilter === sp}
            onClick={() => handleSpeciesChip(sp)}
          >
            {sp}
          </button>
        ))}
        <button
          type="button"
          className={cn("civ-interactive", "civ-button")}
          disabled={!selected}
          onClick={handleNear}
        >
          ★ この個体に近い
        </button>
        <button type="button" className={cn("civ-interactive", "civ-button")} onClick={handleReset}>
          リセット
        </button>
      </div>

      <p className="civ-text" data-muted="true">
        {statusText}
      </p>

      <div ref={containerRef} className="civ-graph-view-canvas" data-testid="graph-view-canvas">
        <div ref={labelsRootRef} className={styles.overlayLayer} />
        <div ref={imgCardsRootRef} className={cn(styles.overlayLayer, styles.imgLayer)} />
        <div ref={glowRef} className={styles.starglow} />
      </div>
      {webglOk === false && (
        <p className="civ-empty" data-testid="graph-view-fallback">
          この端末ではWebGL宇宙面を表示できませんでした。
          {emptyHref && emptyLabel ? (
            <>
              {" "}
              個体は<a className="civ-link" href={emptyHref}>{emptyLabel}</a>から確認できます。
            </>
          ) : null}
        </p>
      )}

      {selectedIndividual && (
        <div className="civ-card" data-testid="graph-view-detail">
          <div className="civ-card-head">
            <h3 className="civ-card-title">{selectedIndividual.label}</h3>
          </div>
          {selectedIndividual.thumbnail_path ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="civ-profile-thumb" src={selectedIndividual.thumbnail_path} alt="" />
          ) : (
            <p className="civ-empty">写真未登録</p>
          )}
          <p className="civ-text">
            種族 {selectedIndividual.species ?? "未記録"} ・ 世代{" "}
            {gen.get(selectedIndividual.individual_id) == null ? "不明" : `G${gen.get(selectedIndividual.individual_id)}`}
          </p>
          <p className="civ-text">
            体長 {selectedIndividual.latest_length_mm ?? "—"}mm ・ 体重 {selectedIndividual.latest_weight_g ?? "—"}g
          </p>
          <p className="civ-text">
            親(sire):{" "}
            {sireId && nodeById.has(sireId) ? (
              <button
                type="button"
                className={cn("civ-interactive", "civ-link")}
                onClick={() => selectNode(sireId)}
              >
                {nodeById.get(sireId)!.label}
              </button>
            ) : (
              "— (記録なし・初代)"
            )}
          </p>
          <p className="civ-text">
            親(dam):{" "}
            {damId && nodeById.has(damId) ? (
              <button type="button" className={cn("civ-interactive", "civ-link")} onClick={() => selectNode(damId)}>
                {nodeById.get(damId)!.label}
              </button>
            ) : (
              "— (記録なし・初代)"
            )}
          </p>
          <p className="civ-text">
            子({kids.length}):{" "}
            {kids.filter((k) => nodeById.has(k)).length === 0
              ? "— (子の記録なし)"
              : kids
                  .filter((k) => nodeById.has(k))
                  .map((k) => (
                    <button
                      key={k}
                      type="button"
                      className={cn("civ-interactive", "civ-link")}
                      onClick={() => selectNode(k)}
                      style={{ marginRight: "8px" }}
                    >
                      {nodeById.get(k)!.label}
                    </button>
                  ))}
          </p>
          {onOpenDetail && (
            <button
              type="button"
              className={cn("civ-interactive", "civ-button")}
              onClick={() => onOpenDetail(selectedIndividual.individual_id)}
            >
              詳細画面を開く
            </button>
          )}
        </div>
      )}
    </div>
  );
}
