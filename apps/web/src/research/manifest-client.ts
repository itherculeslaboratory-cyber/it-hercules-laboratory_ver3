// F2 — apps/api/src/research-manifest-routes.ts の薄いフェッチラッパー。
export interface ManifestLatestInfo {
  generation: number | null;
  generated_at: string | null;
}

export async function fetchManifestLatest(): Promise<ManifestLatestInfo> {
  const res = await fetch("/api/v1/research/manifest/latest");
  if (!res.ok) {
    throw new Error(`manifest/latest fetch failed: ${res.status}`);
  }
  return (await res.json()) as ManifestLatestInfo;
}

export async function fetchManifestParquet(generation: number): Promise<Uint8Array> {
  const res = await fetch(`/api/v1/research/manifest/generation/${generation}/data.parquet`);
  if (!res.ok) {
    throw new Error(`manifest parquet fetch failed (generation=${generation}): ${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}
