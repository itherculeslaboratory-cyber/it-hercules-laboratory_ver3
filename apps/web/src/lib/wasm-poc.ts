// V3-FND-19 — 重い計算をユーザー端末(WASM)へオフロードする最小PoC。
// x_ihl_req: V3-FND-19
// 制約(発注書 ORDER-2026-08-01-w-web1): package.json 不可侵のため wasm-pack/AssemblyScript 等の
// ビルドツールチェーンを新規導入できない。よって「あらかじめ手組みしたWASMバイナリを標準
// WebAssembly API(WebAssembly.instantiate)だけでロード・実行する」最小PoCに限定する。
// このバイトコードは (func (param i32 i32) (result i32) local.get 0 local.get 1 i32.add) を
// エクスポート名 "add" で公開する、広く知られる最小WASMモジュール(手組み・追加ビルド不要)。

const WASM_ADD_POC_BYTES = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // \0asm, version 1
  0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f, // type section: (i32,i32)->i32
  0x03, 0x02, 0x01, 0x00, // function section: func0 uses type0
  0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00, // export section: "add" -> func0
  0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b, // code: local.get0 local.get1 i32.add end
]);

export interface WasmAddPocResult {
  sum: number;
  ranOnStandardWebAssemblyApi: true;
}

/**
 * WebAssembly 標準API(compile/instantiate)だけで手組みWASMモジュールをロードし、
 * export された "add" 関数を実行する。オフロード可能であることの実行時PoC(V3-FND-19)。
 * 「AI鑑定/ONNX推論を実装した」という主張はしない — これは実行環境の疎通確認のみ。
 */
export async function runWasmAddPoc(a: number, b: number): Promise<WasmAddPocResult> {
  const module = await WebAssembly.compile(WASM_ADD_POC_BYTES);
  const instance = await WebAssembly.instantiate(module);
  const addFn = instance.exports.add as (x: number, y: number) => number;
  return { sum: addFn(a, b), ranOnStandardWebAssemblyApi: true };
}
