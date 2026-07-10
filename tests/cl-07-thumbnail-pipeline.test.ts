// CL-07 契約級比較 TC — 第10回裁定③（バイト級ではなく「契約級互換」）。実際の
// upload 経路に、スクリプト生成した EXIF Orientation=6 の JPEG を流し、派生 thumbnail が
//   (a) JPEG マジックバイト  (b) 長辺 512px  (c) EXIF orientation 適用済み寸法
//   (d) manifest が frozen thumbnail.schema.json を validate green
// を満たすことを検証する。PNG 入力も両対応であることを併せて確認。
import { describe, expect, it, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import app from "../apps/api/src/index";
import { TruthStore, validateFrozen } from "@ihl/truth";
import { DEV_TOKEN, FakeR2Bucket, makeEnv } from "./helpers";
import encodeJpeg, { init as initJpegEnc } from "@jsquash/jpeg/encode.js";
import decodeJpeg, { init as initJpegDec } from "@jsquash/jpeg/decode.js";
import encodePng, { init as initPngEnc } from "@jsquash/png/encode.js";

const AUTH = { Authorization: `Bearer ${DEV_TOKEN}` };
const JSON_HEADERS = { ...AUTH, "content-type": "application/json" };
const require = createRequire(import.meta.url);
const wasmMod = async (spec: string) =>
  new WebAssembly.Module(await readFile(require.resolve(spec)));

// The test drives jSquash itself (build the EXIF input, decode the output). Init
// its codecs from disk — same Node pattern the app uses internally.
beforeAll(async () => {
  await initJpegEnc(await wasmMod("@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm"));
  await initJpegDec(await wasmMod("@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm"));
  await initPngEnc(await wasmMod("@jsquash/png/codec/pkg/squoosh_png_bg.wasm"));
});

function rawImage(w: number, h: number) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = (i % w) & 0xff;
    data[i * 4 + 1] = Math.floor(i / w) & 0xff;
    data[i * 4 + 2] = 128;
    data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h };
}

// Splice an EXIF APP1 (little-endian TIFF, one IFD0 entry = Orientation) into a
// JPEG immediately after the SOI marker.
function injectExifOrientation(jpeg: Uint8Array, orientation: number): Uint8Array {
  const t: number[] = [];
  const p16 = (v: number) => t.push(v & 0xff, (v >> 8) & 0xff);
  const p32 = (v: number) => t.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
  t.push(0x49, 0x49); // "II" little-endian
  p16(0x2a); // 42
  p32(8); // IFD0 offset
  p16(1); // 1 entry
  p16(0x0112); // Orientation tag
  p16(3); // type SHORT
  p32(1); // count
  p16(orientation);
  p16(0); // value (2 bytes) + pad
  p32(0); // next IFD = 0
  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...t]; // "Exif\0\0" + TIFF
  const len = payload.length + 2;
  const app1 = [0xff, 0xe1, (len >> 8) & 0xff, len & 0xff, ...payload];
  const out = new Uint8Array(jpeg.length + app1.length);
  out.set(jpeg.subarray(0, 2), 0);
  out.set(app1, 2);
  out.set(jpeg.subarray(2), 2 + app1.length);
  return out;
}

async function makeCapture(env: object, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await app.request(
    "/api/v1/observation/captures",
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ domain: "biology", ...extra }) },
    env,
  );
  return ((await res.json()) as { capture_id: string }).capture_id;
}

async function upload(env: object, captureId: string, bytes: Uint8Array, type: string) {
  const fd = new FormData();
  fd.append("capture_id", captureId);
  fd.append("file", new Blob([bytes], { type }), "photo");
  return app.request("/api/v1/observation/upload", { method: "POST", headers: AUTH, body: fd }, env);
}

describe("CL-07 thumbnail pipeline (契約級互換)", () => {
  it("JPEG w/ EXIF Orientation=6 → 512px JPEG thumbnail, transpose applied, manifest green", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const captureId = await makeCapture(env, { subject_ref: "individual/ind-x" });

    // 640×320 landscape stored pixels; Orientation=6 means "display rotated 90°"
    // → the transposed image is 320×640 portrait.
    const plain = new Uint8Array(await encodeJpeg(rawImage(640, 320), { quality: 85 }));
    const input = injectExifOrientation(plain, 6);

    const up = await upload(env, captureId, input, "image/jpeg");
    expect(up.status).toBe(202);
    const { photo_id } = (await up.json()) as { photo_id: string };

    // (a) thumbnail blob exists and is JPEG.
    const thumbObj = await bucket.get(`media/thumbnail/${photo_id}`);
    expect(thumbObj).not.toBeNull();
    const thumbBytes = new Uint8Array(await thumbObj!.arrayBuffer());
    expect([thumbBytes[0], thumbBytes[1], thumbBytes[2]]).toEqual([0xff, 0xd8, 0xff]);
    expect(thumbObj!.httpMetadata?.contentType).toBe("image/jpeg");

    // (b)+(c) decode: long edge is 512 and orientation was applied (portrait →
    // height is the long edge, not width as in the raw landscape input).
    const dec = await decodeJpeg(thumbBytes, { preserveOrientation: true });
    expect(Math.max(dec.width, dec.height)).toBe(512);
    expect(dec.height).toBe(512);
    expect(dec.width).toBeLessThan(dec.height);

    // (d) manifest validates green against the frozen contract.
    const store = new TruthStore(bucket);
    const manifests = await store.listEvents(`truth/ihl.obs.thumbnail.v1/${captureId}-`);
    expect(manifests).toHaveLength(1);
    const data = (manifests[0].data ?? {}) as Record<string, unknown>;
    expect(validateFrozen("thumbnail", data).valid).toBe(true);
    expect(data.format).toBe("jpeg");
    expect(data.thumbnail_path).toBe(`media/thumbnail/${photo_id}`);
    expect(data.image_id).toBe(photo_id);
    expect(data.individual_id).toBe("ind-x");
    expect(Math.max(data.width_px as number, data.height_px as number)).toBe(512);
  });

  it("PNG input is accepted (両対応) and still yields a JPEG thumbnail", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const captureId = await makeCapture(env);

    const png = new Uint8Array(await encodePng(rawImage(600, 400)));
    const up = await upload(env, captureId, png, "image/png");
    expect(up.status).toBe(202);
    const { photo_id } = (await up.json()) as { photo_id: string };

    const thumbObj = await bucket.get(`media/thumbnail/${photo_id}`);
    expect(thumbObj).not.toBeNull();
    const tb = new Uint8Array(await thumbObj!.arrayBuffer());
    expect([tb[0], tb[1], tb[2]]).toEqual([0xff, 0xd8, 0xff]); // JPEG out, PNG in
    const dec = await decodeJpeg(tb);
    expect(Math.max(dec.width, dec.height)).toBe(512);
  });

  it("non-image bytes → upload still 202, no thumbnail written (best-effort)", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const captureId = await makeCapture(env);

    const up = await upload(env, captureId, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), "image/png");
    expect(up.status).toBe(202);
    const { photo_id } = (await up.json()) as { photo_id: string };
    expect(await bucket.get(`media/thumbnail/${photo_id}`)).toBeNull();
    const store = new TruthStore(bucket);
    expect(await store.listEvents(`truth/ihl.obs.thumbnail.v1/${captureId}-`)).toHaveLength(0);
  });
});
