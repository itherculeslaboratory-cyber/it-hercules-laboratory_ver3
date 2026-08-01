import { createContext } from "react";
import type { Action, Transition } from "../types";

/* -------------------------------------------------------------------------- *
 * Runtime scope + action execution.
 *
 * The renderer is data-driven: screens bind to live API data instead of
 * hardcoding it. Three scopes feed `{{...}}` interpolation and list binding:
 *   - params : URL query (?id=…) — the runtime individual/capture id.
 *   - data   : responses of node `source_path` GETs, keyed by node id.
 *   - result : the parsed response of the last successful action.
 * Individual catalog parts read these via context; screens stay declarative
 * and never wire a11y/state/data-fetch by hand.
 * -------------------------------------------------------------------------- */

export type Execute = (
  action: Action,
  body?: Record<string, unknown>,
) => Promise<unknown>;

export type Scope = {
  params: Record<string, string>;
  data: Record<string, unknown>;
  result: Record<string, unknown>;
  // c8 UI磨き第2弾#1(受領10「買い手/売り手だけ表示」): GET /me/profile を
  // Renderer が一度だけ取得し {{viewer.actor_id}} として全ノードへ公開する —
  // `when` プリミティブが役割(買い手/売り手/スレ主)を判定する唯一の材料。
  // 未ログイン/取得失敗時は {}（`when` は単に false 側に倒れる・エラーにしない）。
  viewer: Record<string, unknown>;
};

type DataSink = {
  setNodeData: (id: string, value: unknown) => void;
  setActionResult: (value: unknown) => void;
};

export const ExecuteCtx = createContext<Execute>(async () => undefined);
export const InvalidCtx = createContext<Set<string>>(new Set());
export const ScopeCtx = createContext<Scope>({ params: {}, data: {}, result: {}, viewer: {} });
export const TransitionsCtx = createContext<Transition[]>([]);
export const NavigateCtx = createContext<(to: string, query?: Record<string, string>) => void>(
  () => {},
);
export const DataSinkCtx = createContext<DataSink>({
  setNodeData: () => {},
  setActionResult: () => {},
});
// V3-AUT-06: reactive submit gate. A submit button reads this; outside a gated
// form it defaults to true (no reactive disable), so only consent forms gate.
export const FormValidityCtx = createContext<boolean>(true);

// I18-08: text_key -> string resolver. The catalog + fallback chain live in
// lib/i18n (P5); the Renderer only calls resolve(key). Default is a no-op so
// screens using literal text render unchanged and tests can inject a resolver.
export type ResolveMessage = (key: string) => string | undefined;
export const MessagesCtx = createContext<ResolveMessage>(() => undefined);
// I18-06: viewer locale for the on-device UGC translate affordance. authored
// language is ja, so that is the default when i18n has not set one.
export const LocaleCtx = createContext<string>("ja");
// design-home-round.md 是正(統合オーナー追加指示・SL-1「.civ-page max-width:720px
// は幅の広い画面で使い切れない」診断・STRIP-1で720px自体を全ゾーン1160pxへ
// 統一済み): def.layout(schema既存の任意string)をAppShellNodeへ届け、その画面の
// .civ-app-shellへdata-layoutとして出すだけの最小フック。全幅化がグローバル
// 既定になったため、globals.css側の"wide"専用CSSは不要化して削除済み——この
// Ctx/data-layout配線自体は他消費者が現れた場合に備えて残置(無害)。
export const LayoutCtx = createContext<string>("standard");

// g79-bundleA(V3-UIX-59【R136/S1】・b2think §2-6): 「この画面について話す」導線が
// channel=当該screen_idをユーザーに手入力させず自動刻印するための最小フック。
// def.screen_id を Renderer が Provide し、AppShellNode の PageInfoPanel が読む。
export const ScreenIdCtx = createContext<string>("");

// HDR-1(c9-structure-canon.md §1/§1c・R112/R115採用)「観測対象」グローバル
// 文脈スイッチ。AppShellNode がヘッダーセレクタで確定した選択(層1=学術分類の
// 種・層2=血統ブランドタグ)を保持し、全画面の子ノードへ配る。空文字="すべて"
// (未選択・フィルタなし)。
//
// 第1スライス(commit 09e7a4a・HDR-1○実装方針): 個体ドメイン(individuals/
// pedigree-links/obs-search/universe)を配線。individual/clutch は species が
// もともと本人入力の必須コアフィールド(subspecies 確定ゲート付き)なので、
// この producer 機構は不要=対象外(装飾タグではなく実データそのもの)。
//
// 第2スライス(A1#4・read側): 残ドメインの一覧を species で絞る read 配線を
// 追加 — 知の広場(GET /plaza/channels/:channel/threads・GET /plaza/search を
// root投稿の species_id 代表値で絞り)・市場(GET /market/listings を絞り)・
// 研究(GET /research/content・POST /research/search を絞り・GET
// /research/projects は project.schema.json に種を持たせず content.project_id
// 結合で派生フィルタ)・clutches(既存 lineage_id と並ぶ species フィルタ)・
// BatchRosterNode(/individuals・/clutches の両 fetch)。
//
// 第2bスライス(slice2b・独立批評家blocking是正・本コミット): 第2スライスの
// read配線には市場/知の広場/研究へ species_id を書き込む producer が無く、
// scope選択時にそれらのアプリ作成コンテンツが一覧から消える(producer-less
// decoration)問題があった。本スライスで producer を配線——
// FormNode props.header_scoped_producer:true(market-trade.json
// create-listing-form・data-descriptor.json descriptor-form)は送信 body へ
// headerScope.species を自動付与(POST /market/listings・POST
// /research/content。空 scope は何も付けない)。plaza compose
// (KnowledgeHubNode.createThread → POST /plaza/posts)も同様に自動付与。
// これで市場/知の広場/研究の3ドメインは「作成→(scope絞り込み時)一覧に出る」
// が実際に機能する(tests/header-scope-producer.test.ts で実証)。
//
// 正直な限界(誇張ゼロ): (a) lineage_id は market/plaza/research のスキーマに
// フィールドが無いため producer 対象外——これら3ドメインは species のみ絞れ、
// lineage では絞れない。(b) home(届いた出来事・home-routes.ts)は list ではなく
// ダッシュボード集計エンドポイントのため今回の「全 list エンドポイント」配線の
// 対象外(structure-canon §1 が home tiles も切替と言うが、集計値の scope 切替は
// 別波で要検討・申し送り)。
//
// 原理的に対象外(誇張ゼロ・A1#4の正直表示): placement/device(物理什器スキーマに
// 種フィールドが無い)・taxon-species/taxon-morph(ヘッダーの選択肢そのものを供給する
// 分類カタログ自体・自己参照になるため対象外)。observation capture の生一覧
// エンドポイントは現状 API に存在しない(per-capture 詳細取得のみ)ため対象なし。
export type HeaderScope = { species: string; lineageId: string };
export const DEFAULT_HEADER_SCOPE: HeaderScope = { species: "", lineageId: "" };
export const HeaderScopeCtx = createContext<HeaderScope>(DEFAULT_HEADER_SCOPE);
