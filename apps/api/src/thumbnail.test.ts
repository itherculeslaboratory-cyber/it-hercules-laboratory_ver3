// generateThumbnail was previously untested (2026-07-31 tsc6 T2): the ensureWasm()
// Node-branch `new WebAssembly.Module(bytes)` call tripped a TS2511 ("abstract
// class") error because workers-types declares WebAssembly.Module abstract (a
// real Workers platform restriction that doesn't apply to this Node-only branch).
// This test exercises that exact code path end-to-end to confirm the
// Reflect.construct fix (thumbnail.ts) behaves identically to `new` at runtime.
import { describe, expect, it } from "vitest";
import { generateThumbnail, THUMBNAIL_FORMAT } from "./thumbnail";

// 1x1 red pixel PNG (well-known minimal valid-PNG fixture).
const PNG_1X1_RED_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

describe("generateThumbnail", () => {
  it("decodes a PNG via the Node wasm-init path and re-encodes it as a JPEG thumbnail", async () => {
    const bytes = base64ToBytes(PNG_1X1_RED_BASE64);
    const thumb = await generateThumbnail(bytes, "image/png");
    expect(thumb.format).toBe(THUMBNAIL_FORMAT);
    expect(thumb.width).toBe(1);
    expect(thumb.height).toBe(1);
    expect(thumb.bytes.length).toBeGreaterThan(0);
    // JPEG magic bytes.
    expect(thumb.bytes[0]).toBe(0xff);
    expect(thumb.bytes[1]).toBe(0xd8);
  });
});
