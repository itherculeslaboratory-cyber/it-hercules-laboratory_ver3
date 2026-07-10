// Deterministic tiny PNG generator for the E2E photo-upload step (design-c2 §7:
// "テスト画像はスクリプト生成PNG"). No image library — a valid solid-color PNG
// built from raw chunks (signature + IHDR + IDAT[zlib] + IEND) with real CRC32.
import { deflateSync } from "node:zlib";

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** Build a valid size×size solid-RGB PNG (default 8×8 red). Returns raw bytes. */
export function makePng(size = 8, rgb: [number, number, number] = [220, 40, 40]): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); // width
  ihdr.writeUInt32BE(size, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type 2 = truecolor RGB
  // 10,11,12 = compression/filter/interlace = 0
  // raw image: each row is a filter byte (0) + size*3 color bytes
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3).map((_, i) => rgb[i % 3])]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Self-check: valid PNG signature + non-trivial length.
if (import.meta.url === `file://${process.argv[1]}`) {
  const png = makePng();
  const okSig = png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (!okSig || png.length < 60) throw new Error("makePng produced an invalid PNG");
  console.log(`makePng OK — ${png.length} bytes`);
}
