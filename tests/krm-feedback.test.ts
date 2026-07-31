// V3-KRM-22②③(design19 §T1-1・w-gov3): krm-feedback(一般ユーザー評価+純関数の重み更新)と
// krm-preference-template(価値観テンプレの fork/append)。①(取引評価)は w-mkt2 の別領域。
import { describe, expect, it } from "vitest";
import { TruthStore, ulid } from "@ihl/truth";
import {
  appendFeedback,
  projectFeedbackWeight,
  feedbackGradeToY,
  appendPreferenceTemplateVersion,
  projectPreferenceTemplateVersion,
  projectPreferenceTemplateLatest,
  PREFERENCE_TEMPLATE_TYPE,
} from "../apps/api/src/contribution-krm";
import { FakeR2Bucket } from "./helpers";

const ACTOR = "rater-1";
const TARGET = "ratee-1";

describe("V3-KRM-22② krm-feedback (append / weight projection)", () => {
  it("good/bad/normal grades map to the ±1/0 teacher signal", () => {
    expect(feedbackGradeToY("good")).toBe(1);
    expect(feedbackGradeToY("bad")).toBe(-1);
    expect(feedbackGradeToY("normal")).toBe(0);
  });

  it("appends a feedback event and projects an aggregate weight (w += LEARNING_RATE * y)", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    expect((await appendFeedback(s, ACTOR, TARGET, "good")).status).toBe("inserted");
    expect((await appendFeedback(s, "rater-2", TARGET, "good")).status).toBe("inserted");
    expect((await appendFeedback(s, "rater-3", TARGET, "bad", "スパム的な連絡")).status).toBe("inserted");

    const proj = await projectFeedbackWeight(s, TARGET);
    expect(proj.count).toBe(3);
    // 2 good (+1 each) + 1 bad (-1) = net y=+1, weight = LEARNING_RATE(0.1) * 1.
    expect(proj.weight).toBeCloseTo(0.1, 10);
  });

  it("an unrated actor projects to a zero weight, zero count", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    const proj = await projectFeedbackWeight(s, "nobody-rated-me");
    expect(proj).toEqual({ target_actor_id: "nobody-rated-me", weight: 0, count: 0 });
  });
});

describe("V3-KRM-22③ krm-preference-template (append / fork / latest)", () => {
  it("append then fork round-trips and projectPreferenceTemplateLatest returns the newest version", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    const v1Id = ulid();
    const v1 = await appendPreferenceTemplateVersion(s, ACTOR, {
      template_id: "tmpl-a",
      version_id: v1Id,
      items: [{ tag: "quiet", value: 1 }],
    });
    expect(v1.status).toBe("inserted");

    // fork: forked_from points back to v1.
    const v2Id = ulid();
    const v2 = await appendPreferenceTemplateVersion(s, "forker", {
      template_id: "tmpl-a",
      version_id: v2Id,
      items: [{ tag: "quiet", value: 1 }, { tag: "loud", value: -1 }],
      forked_from: v1Id,
    });
    expect(v2.status).toBe("inserted");

    const stored = await projectPreferenceTemplateVersion(s, v2Id);
    expect(stored?.forked_from).toBe(v1Id);
    expect(stored?.items).toEqual([{ tag: "quiet", value: 1 }, { tag: "loud", value: -1 }]);

    const latest = await projectPreferenceTemplateLatest(s, "tmpl-a");
    expect(latest?.version_id).toBe(v2Id);
  });

  it("duplicate version_id append conflicts (put-if-absent 409, append-only)", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    const versionId = ulid();
    const data = { template_id: "tmpl-b", version_id: versionId, items: [{ tag: "x", value: 0 as const }] };
    expect((await appendPreferenceTemplateVersion(s, ACTOR, data)).status).toBe("inserted");
    const dup = await appendPreferenceTemplateVersion(s, ACTOR, {
      ...data,
      items: [{ tag: "tampered", value: 1 as const }],
    });
    expect(dup.status).toBe("conflict");
  });

  it("an unknown version_id projects to null", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    expect(await projectPreferenceTemplateVersion(s, ulid())).toBeNull();
    expect(await projectPreferenceTemplateLatest(s, "no-such-template")).toBeNull();
  });

  it("stores under the ihl.krm.preference_template.v1 Truth prefix", async () => {
    const s = new TruthStore(new FakeR2Bucket());
    const versionId = ulid();
    await appendPreferenceTemplateVersion(s, ACTOR, {
      template_id: "tmpl-c",
      version_id: versionId,
      items: [{ tag: "x", value: 0 }],
    });
    const stored = await s.readEvent(`truth/${PREFERENCE_TEMPLATE_TYPE}/${versionId}.json`);
    expect(stored).not.toBeNull();
  });
});
