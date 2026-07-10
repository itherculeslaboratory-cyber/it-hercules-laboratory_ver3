// CL-07 thumbnail generation — 第10回ユーザー裁定 (2026-07-11):
//   形式=JPEG / 経路=jSquash on Workers / 長辺=512px / EXIF transpose=採用。
// Decodes a JPEG (EXIF 回転を適用) or PNG, downscales the long edge to 512px, and
// re-encodes JPEG. A derived, re-generatable artifact — the frozen contract is
// schemas/frozen/thumbnail.schema.json (裁定材料 docs/planning/c3/cl-07-thumbnail-options.md).
import decodeJpeg, { init as initJpegDec } from "@jsquash/jpeg/decode.js";
import encodeJpeg, { init as initJpegEnc } from "@jsquash/jpeg/encode.js";
import decodePng, { init as initPngDec } from "@jsquash/png/decode.js";
import resize, { initResize } from "@jsquash/resize";

export const THUMBNAIL_LONG_EDGE = 512;
export const THUMBNAIL_FORMAT = "jpeg" as const;

let wasmReady: Promise<void> | undefined;

// jSquash ships each codec's wasm as a separate module and instantiates it
// differently per runtime: Node (vitest) can't fetch(file://) the wasm, and
// Workers can't read the filesystem. Node → read the .wasm off disk into a
// WebAssembly.Module. Workers → static `import x from "*.wasm"` (bundler yields a
// WebAssembly.Module), isolated in thumbnail-wasm-workers.ts because raw *.wasm
// imports break vite/vitest. Init is one-shot and cached.
async function ensureWasm(): Promise<void> {
  if (wasmReady) return wasmReady;
  wasmReady = (async () => {
    const isNode = typeof process !== "undefined" && !!process.versions?.node;
    if (isNode) {
      const { readFile } = await import("node:fs/promises");
      const { createRequire } = await import("node:module");
      const req = createRequire(import.meta.url);
      const mod = async (spec: string) =>
        new WebAssembly.Module(await readFile(req.resolve(spec)));
      await initJpegDec(await mod("@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm"));
      await initJpegEnc(await mod("@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm"));
      await initPngDec(await mod("@jsquash/png/codec/pkg/squoosh_png_bg.wasm"));
      await initResize(await mod("@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm"));
    } else {
      // ponytail: Workers wasm path follows the jSquash static-import recipe but
      // is deploy-gated (C6) — it can't be exercised from vitest, so the Node
      // branch above is the tested one. Load via @vite-ignore so vitest never
      // resolves the raw *.wasm imports inside it.
      const w = await import(/* @vite-ignore */ "./thumbnail-wasm-workers");
      await w.initThumbnailWasm();
    }
  })();
  return wasmReady;
}

// PNG has a fixed 8-byte signature; anything else is treated as JPEG. contentType
// is only a weak tiebreaker (clients mislabel).
function isPng(bytes: Uint8Array, contentType: string): boolean {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  return contentType === "image/png" && !isJpeg;
}

function longEdgeTarget(w: number, h: number): { width: number; height: number } {
  const max = Math.max(w, h);
  if (max <= THUMBNAIL_LONG_EDGE) return { width: w, height: h }; // never upscale
  const scale = THUMBNAIL_LONG_EDGE / max;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

export interface Thumbnail {
  bytes: Uint8Array;
  width: number;
  height: number;
  format: typeof THUMBNAIL_FORMAT;
}

// Decode → EXIF transpose (JPEG only, preserveOrientation) → long-edge 512 → JPEG.
// Throws if the bytes aren't a decodable image; callers treat thumbnails as
// best-effort (the original blob + photo event are the append-only truth).
export async function generateThumbnail(
  bytes: Uint8Array,
  contentType: string,
): Promise<Thumbnail> {
  await ensureWasm();
  const image = isPng(bytes, contentType)
    ? await decodePng(bytes)
    : await decodeJpeg(bytes, { preserveOrientation: true });
  const target = longEdgeTarget(image.width, image.height);
  const resized =
    target.width === image.width && target.height === image.height
      ? image
      : await resize(image, { width: target.width, height: target.height, method: "lanczos3" });
  const out = new Uint8Array(await encodeJpeg(resized, { quality: 82 }));
  return { bytes: out, width: resized.width, height: resized.height, format: THUMBNAIL_FORMAT };
}
