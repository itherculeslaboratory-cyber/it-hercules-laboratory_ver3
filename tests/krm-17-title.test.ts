// V3-KRM-17 称号システム(design19 §T1-5・w-gov3)。付与(貢献軸/他称軸の機械付与・投影)の
// みを本テストで検証する。自称(表示設定)は差し戻し済み(contribution-title.ts 冒頭コメント
// 参照)のため対象外。称号は権限に一切影響しない=requireRole を一切呼ばないことをコードで
// 保証する(本ファイルは authz.ts を import しない設計・grepでも確認)。
import { describe, expect, it } from "vitest";
import { TruthStore } from "@ihl/truth";
import { appendContribution } from "../apps/api/src/contribution";
import { CONTRIBUTION_TITLE_THRESHOLD } from "../apps/api/src/economy-constants";
import {
  appendTitleGrant,
  projectTitles,
  maybeGrantContributionTitle,
  countExternalVotes,
  TITLE_TYPE,
} from "../apps/api/src/contribution-title";
import { FakeR2Bucket } from "./helpers";

describe("V3-KRM-17 title grant (append-only, Truth)", () => {
  it("appendTitleGrant writes an ihl.krm.title.v1 event and projectTitles reads it back", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    const res = await appendTitleGrant(s, "titled-actor", "auto", "contribution");
    expect(res.status).toBe("inserted");
    const titles = await projectTitles(s, "titled-actor");
    expect(titles).toHaveLength(1);
    expect(titles[0]).toMatchObject({ actor_id: "titled-actor", granted_by: "auto", axis: "contribution" });
  });

  it("stores under the ihl.krm.title.v1 Truth prefix", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await appendTitleGrant(s, "a", "auto", "contribution");
    const events = await s.listEvents(`truth/${TITLE_TYPE}/`);
    expect(events).toHaveLength(1);
  });
});

describe("V3-KRM-17 maybeGrantContributionTitle (machine grant from static threshold)", () => {
  it("does nothing below CONTRIBUTION_TITLE_THRESHOLD", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await appendContribution(s, "climber", "node-1", "research", CONTRIBUTION_TITLE_THRESHOLD - 1, "manual");
    const results = await maybeGrantContributionTitle(s, "climber");
    expect(results).toHaveLength(0);
    expect(await projectTitles(s, "climber")).toHaveLength(0);
  });

  it("grants exactly once when a threshold is crossed, and is idempotent on repeat calls", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    await appendContribution(s, "climber2", "node-1", "development", CONTRIBUTION_TITLE_THRESHOLD, "manual");
    const first = await maybeGrantContributionTitle(s, "climber2");
    expect(first).toHaveLength(1);
    expect(first[0].status).toBe("inserted");

    const second = await maybeGrantContributionTitle(s, "climber2");
    expect(second).toHaveLength(0); // already granted -> no duplicate append

    const titles = await projectTitles(s, "climber2");
    expect(titles).toHaveLength(1);
  });
});

describe("V3-KRM-17 countExternalVotes (read-only, reuses projectSocialEval)", () => {
  it("counts to 0 with no votes", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    expect(await countExternalVotes(s, "nobody")).toBe(0);
  });
});
