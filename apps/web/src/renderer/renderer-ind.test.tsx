// 個体・種(IND)ゾーン 5画面 dedicated nodes の実データ配線テスト。
// 目的: 承認絵の逐語採用に加えて「実装済みAPIの実フィールドが実際に描画される」
// ことと「データが無い/未接続のときに捏造せず正直な空表示になる」ことを固定する
// (誇張ゼロの回帰防止)。API はスタブ(onAction)で差し込む。
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Renderer } from "./renderer";
import type { ScreenDef } from "./types";

afterEach(() => cleanup());

function def(variant: string): ScreenDef {
  return {
    screen_id: "t",
    route: "/t",
    title: "t",
    nodes: [{ id: variant, type: "list", props: { variant } }],
  } as ScreenDef;
}

describe("IND individual-detail — real profile/pedigree/authenticity wiring", () => {
  it("renders the individual label, stage, the 3 judgement tiles and a real life event", async () => {
    const onAction = vi.fn(async (a: { path?: string; method?: string }) => {
      if (a.path?.endsWith("/profile"))
        return {
          individual_id: "ind-7",
          master: { local_label_text: "ヘラクレス No.7", species: "ヘラクレスオオカブト" },
          name: "ヘラクレス No.7",
          species: "ヘラクレスオオカブト",
          stage: "third",
          status: "alive",
          thumbnail_path: null,
          placement_id: "棚A-3",
          environment: [{ device_id: "dev-1", metric: "temperature", bucket_start_ms: 2, mean: 23.4, count: 5 }],
          schedule: { next_observation_at: "2026-07-24" },
          parents: { sire: { individual_id: "ind-3", label: "父レッド" } },
          siblings: [{ individual_id: "ind-6", label: "No.6", dead: true, eclosed: false }],
          children: [],
          observations: [
            { capture_id: "c1", time: "2025-11-02T00:00:00Z", measurements: [{ item: "weight", value: 40 }] },
            { capture_id: "c2", time: "2026-01-20T00:00:00Z", measurements: [{ item: "weight", value: 62 }] },
          ],
          life_events: [{ individual_id: "ind-7", kind: "birth", at: "2025-09-14T00:00:00Z" }],
          parent_observations: { sire: [], dam: [] },
          cohort_observations: [],
        };
      if (a.path?.endsWith("/pedigree"))
        return { individual_id: "ind-7", known: true, parents: [] };
      if (a.path?.endsWith("/authenticity"))
        return {
          individual_id: "ind-7",
          continuity_score: 0.75,
          image_chain: { photos: 2, with_sha256: 2, intact: true },
          growth_monotonic: true,
          registration: { registered_events: 1, evidenced_observations: 2, consistent: true },
          lineage_conflicts: [],
          doubts: [],
        };
      return undefined;
    });
    render(<Renderer def={def("ind-detail")} onAction={onAction} params={{ id: "ind-7" }} />);
    expect(await screen.findByText("ヘラクレス No.7")).toBeInTheDocument();
    expect(screen.getByText("3令(直近の脱皮から)")).toBeInTheDocument();
    expect(screen.getByText("成長のぐあい")).toBeInTheDocument();
    expect(screen.getByText("血統の確かさ")).toBeInTheDocument();
    expect(screen.getByText("近い血の度合い(近交)")).toBeInTheDocument();
    // 母不明 → 血縁レールに「わかりません」+ ⓘ帯が第一級で出る(誇張ゼロ)。
    expect(screen.getByText("♀ 母 わかりません")).toBeInTheDocument();
    // 実 life event が JA ラベルで並ぶ。
    expect(screen.getByText("誕生(孵化)")).toBeInTheDocument();
    // 実 environment(温度)が数値で出る。
    expect(screen.getByText("温度(直近の平均)")).toBeInTheDocument();
  });

  it("prompts to open from an individual when no id is given (no fabricated content)", () => {
    render(<Renderer def={def("ind-detail")} onAction={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/個体を選ぶと/)).toBeInTheDocument();
  });
});

describe("IND match — convergence + ranking wiring, honest limits", () => {
  it("shows the two top-ranked candidates enriched from bio-card and the convergence state", async () => {
    const onAction = vi.fn(async (a: { path?: string }) => {
      if (a.path === "/api/v1/match/ranking") return { ranking: [{ item_id: "ind-a" }, { item_id: "ind-b" }] };
      if (a.path === "/api/v1/match/convergence") return { auc: 0.82, converged: true, n_events: 12 };
      if (a.path?.includes("ind-a"))
        return { individual_id: "ind-a", species: "ヘラクレス", morph: null, latest_size: 83, feature_tags: ["胸角 長め"], qr_url: "/individuals/ind-a" };
      if (a.path?.includes("ind-b"))
        return { individual_id: "ind-b", species: "ヘラクレス", morph: null, latest_size: 76, feature_tags: ["スリム"], qr_url: "/individuals/ind-b" };
      return undefined;
    });
    render(<Renderer def={def("ind-match")} onAction={onAction} />);
    expect(await screen.findByText("胸角 長め")).toBeInTheDocument();
    expect(screen.getByText("いま好みに近い(1位)")).toBeInTheDocument();
    expect(screen.getByText("🎯 好みが固まってきました")).toBeInTheDocument();
  });

  it("shows an honest empty state when there are fewer than two candidates", async () => {
    const onAction = vi.fn(async (a: { path?: string }) => {
      if (a.path === "/api/v1/match/ranking") return { ranking: [] };
      if (a.path === "/api/v1/match/convergence") return { auc: null, converged: false, n_events: 0 };
      return undefined;
    });
    render(<Renderer def={def("ind-match")} onAction={onAction} />);
    expect(await screen.findByText(/好みくらべに使える個体がまだ足りません/)).toBeInTheDocument();
  });
});

describe("IND species — real stats + honest nulls", () => {
  it("renders each species with its recomputed sample count and shows a dash for missing averages", async () => {
    const onAction = vi.fn(async (a: { path?: string }) => {
      if (a.path?.startsWith("/api/v1/species"))
        return {
          species: [
            {
              species_id: "sp-1",
              name: "ヘラクレスオオカブト",
              stats: { sample_count: 312, avg_size: 148, avg_weight: null, avg_market_price: null },
            },
          ],
        };
      return undefined;
    });
    render(<Renderer def={def("ind-species")} onAction={onAction} />);
    expect(await screen.findByText("ヘラクレスオオカブト")).toBeInTheDocument();
    expect(screen.getByText("312")).toBeInTheDocument();
    expect(screen.getByText("148mm")).toBeInTheDocument();
  });
});

describe("IND cross — real rates, honest guidance without an id", () => {
  it("renders rate percentages from the cohort aggregate", async () => {
    const onAction = vi.fn(async (a: { path?: string }) => {
      if (a.path?.endsWith("/cross"))
        return {
          cohort_size: 24,
          weight_by_instar: { first: 4.2, second: 18, third_early: 54, third_late: 82 },
          size_extremes: { max_weight: 96, max_length: 158, min_length: 121 },
          rates: {
            mortality: 0.12,
            survival: 0.88,
            completion: 0.79,
            eclosion_failure: 0.08,
            hatch_rate: 0.92,
            sex_ratio: 0.54,
            color_reproducibility: null,
          },
        };
      return undefined;
    });
    render(<Renderer def={def("ind-cross")} onAction={onAction} params={{ id: "ind-7" }} />);
    expect(await screen.findByText("88%")).toBeInTheDocument(); // survival
    expect(screen.getByText("79%")).toBeInTheDocument(); // completion
    expect(screen.getByText("色の再現性は後の波")).toBeInTheDocument(); // honest defer
  });

  it("guides the user to open from an individual when no id is given", () => {
    render(<Renderer def={def("ind-cross")} onAction={vi.fn()} />);
    expect(screen.getByText(/個体の詳細から開くと/)).toBeInTheDocument();
  });
});

describe("IND bio-card — real fields + name lookup", () => {
  it("renders the meishi with species, feature tag, and display name from the name lookup", async () => {
    const onAction = vi.fn(async (a: { path?: string }) => {
      if (a.path?.endsWith("/bio-card"))
        return {
          individual_id: "ind-7",
          species: "ヘラクレスオオカブト",
          morph: null,
          latest_size: 82,
          feature_tags: ["レッド系"],
          qr_url: "/individuals/ind-7",
        };
      if (a.path === "/api/v1/individuals/ind-7")
        return { individual_id: "ind-7", master: { local_label_text: "ヘラクレス No.7" }, name: null, species: "ヘラクレスオオカブト" };
      return undefined;
    });
    render(<Renderer def={def("ind-bio-card")} onAction={onAction} params={{ id: "ind-7" }} />);
    expect(await screen.findByText("ヘラクレス No.7")).toBeInTheDocument();
    expect(screen.getByText("レッド系")).toBeInTheDocument();
  });
});
