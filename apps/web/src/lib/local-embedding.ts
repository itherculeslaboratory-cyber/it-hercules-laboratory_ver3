// V3-WIK-23 — 検索・embedding計算をユーザー端末上でローカル実行する。
// x_ihl_req: V3-WIK-23
// ★スコープ外の明記(発注書 ORDER-2026-08-01-w-web1・design35 §3 A-1): 要件原文が求める
// 本物のembedding(テキスト=MiniLM/e5-small相当、画像=Mobile CLIP相当、ONNX Runtime Web実行)は
// onnxruntime-web という新規npm依存を要し、apps/web/package.json は本ラウンド不可侵のため
// **今回は実装しない**。ここにあるのは「新規npm依存ゼロ・決定論的・端末内完結」という要件の
// 形だけを満たす**プレースホルダ**(文字n-gramハッシュ特徴量)であり、MiniLM/e5-small相当の
// 意味的embeddingではない。ONNX Runtime Web統合まで progress.json は in_progress のまま維持する。

/**
 * 決定論的な文字n-gramハッシュベクトル(正規化済み)。真の意味的embeddingではなく、
 * 「端末内だけで完結する特徴量パイプライン」の配線確認用プレースホルダ。
 * 同一入力は常に同一ベクトルを返す(端末非依存・ネットワーク不要)。
 */
export function localHashEmbedding(text: string, dim = 64, ngram = 3): Float32Array {
  const vec = new Float32Array(dim);
  const normalized = text.normalize("NFKC").toLowerCase();
  if (normalized.length === 0) return vec;

  const n = Math.max(1, ngram);
  for (let i = 0; i <= normalized.length - n; i++) {
    const gram = normalized.slice(i, i + n);
    const bucket = hashString(gram) % dim;
    vec[bucket] += 1;
  }
  // 単一文字未満(短文)のフォールバック: 文字単位でハッシュする。
  if (normalized.length < n) {
    for (const ch of normalized) {
      vec[hashString(ch) % dim] += 1;
    }
  }

  let norm = 0;
  for (let i = 0; i < dim; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dim; i++) vec[i] /= norm;
  }
  return vec;
}

/** FNV-1a 32bit ハッシュ(標準API・依存ゼロで書ける決定論ハッシュ)。 */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** コサイン類似度(0ベクトル同士は0を返す・NaNにしない)。 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new Error("dimension mismatch");
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
