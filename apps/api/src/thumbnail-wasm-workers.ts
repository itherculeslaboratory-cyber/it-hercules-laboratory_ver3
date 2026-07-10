// @ts-nocheck — Workers-only. Under wrangler/esbuild `import x from "*.wasm"`
// resolves to a WebAssembly.Module (no TS types). This file is NEVER imported by
// vitest/node — node can't import *.wasm — so thumbnail.ts loads it only on the
// non-node branch (@vite-ignore). Deploy path is human-gated (C6); unverified
// until then. Keep in lockstep with the Node init in thumbnail.ts.
import JPEG_DEC from "@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm";
import JPEG_ENC from "@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm";
import PNG_DEC from "@jsquash/png/codec/pkg/squoosh_png_bg.wasm";
import RESIZE from "@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm";
import { init as initJpegDec } from "@jsquash/jpeg/decode.js";
import { init as initJpegEnc } from "@jsquash/jpeg/encode.js";
import { init as initPngDec } from "@jsquash/png/decode.js";
import { initResize } from "@jsquash/resize";

export async function initThumbnailWasm(): Promise<void> {
  await initJpegDec(JPEG_DEC);
  await initJpegEnc(JPEG_ENC);
  await initPngDec(PNG_DEC);
  await initResize(RESIZE);
}
