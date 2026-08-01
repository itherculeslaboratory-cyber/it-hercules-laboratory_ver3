import { describe, it, expect, vi, afterEach } from "vitest";
import { buildResearchQueryEventData, saveResearchQueryToTruth } from "./truth-query-save";

afterEach(() => vi.unstubAllGlobals());

describe("buildResearchQueryEventData", () => {
  it("carries the query verbatim + manifest_generation + a fresh ULID-format query_id", () => {
    const data = buildResearchQueryEventData(
      { conditions: [{ column: "type", operator: "=", value: "obs-capture" }] },
      7,
      "actor-1",
      "2026-08-01T00:00:00.000Z",
    );
    expect(data.manifest_generation).toBe(7);
    expect(data.actor_id).toBe("actor-1");
    expect(data.created_at).toBe("2026-08-01T00:00:00.000Z");
    expect(data.query).toEqual({ conditions: [{ column: "type", operator: "=", value: "obs-capture" }] });
    expect(String(data.query_id)).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});

describe("saveResearchQueryToTruth", () => {
  it("POSTs a schemas/events/research-query.schema.json-shaped envelope to /events", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ key: "truth/ihl.research.query.v1/x.json" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await saveResearchQueryToTruth(
      { conditions: [], limit: 50 },
      3,
      "actor-1",
      () => new Date("2026-08-01T00:00:00.000Z"),
    );

    expect(result.key).toBe("truth/ihl.research.query.v1/x.json");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/events");
    expect(init.method).toBe("POST");
    const envelope = JSON.parse(String(init.body));
    expect(envelope.type).toBe("ihl.research.query.v1");
    expect(envelope.dataschema).toBe("schemas/events/research-query.schema.json");
    expect(envelope.specversion).toBe("1.0");
    expect(envelope.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(envelope.data.manifest_generation).toBe(3);
    expect(envelope.data.actor_id).toBe("actor-1");
    expect(envelope.provenance).toEqual({ generator_kind: "human", actor_id: "actor-1" });
  });

  it("throws on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "INVALID_ENVELOPE" }), { status: 400 })),
    );
    await expect(saveResearchQueryToTruth({ conditions: [] }, 1, "actor-1")).rejects.toThrow(/research-query save failed/);
  });
});
