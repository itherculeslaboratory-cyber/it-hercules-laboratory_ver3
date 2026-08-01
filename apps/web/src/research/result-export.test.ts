import { describe, it, expect } from "vitest";
import { resultsToJson, resultsToCsv } from "./result-export";

describe("resultsToJson / resultsToCsv (design §4-3 CSV/JSON出力)", () => {
  const rows = [
    { event_id: "e1", type: "obs-capture", subject: "individual/1" },
    { event_id: "e2", type: "obs-photo", subject: null },
  ];

  it("JSON出力は行データをそのまま整形する", () => {
    expect(JSON.parse(resultsToJson(rows))).toEqual(rows);
  });

  it("CSV出力はヘッダ行+値行になる", () => {
    const csv = resultsToCsv(rows);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("event_id,type,subject");
    expect(lines[1]).toBe("e1,obs-capture,individual/1");
    expect(lines[2]).toBe("e2,obs-photo,");
  });

  it("空配列はヘッダ無しの空文字列", () => {
    expect(resultsToCsv([])).toBe("");
  });

  it("カンマ・改行を含む値はダブルクォートでエスケープする", () => {
    const csv = resultsToCsv([{ text_repr: 'a,b\n"c"' }]);
    expect(csv).toBe('text_repr\n"a,b\n""c"""');
  });
});
