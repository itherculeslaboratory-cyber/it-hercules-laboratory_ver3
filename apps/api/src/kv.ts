// Minimal Workers KV surface shared by denylist.ts(V3-AUT-03)+ auth-routes.ts
// verify-code 状態(V3-AUT-46)。round-16 Q-REQ-03「Workers KV(なければ既存のKV
// Binding作法を踏襲・ローカルはメモリ実装)」— この repo に既存の KV Binding 作法が
// 無いため、本ファイルが正本の作法になる。get/put のみ(TTL は options.expirationTtl)。
export interface KVNamespaceLite {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

// ponytail: TTL はメモリ実装では無視(プロセス終了で自然に消える。テスト/ローカル限定
// フォールバックのため実 TTL 追跡は不要 — 本番は Workers KV が expirationTtl を強制する)。
export function memoryKV(): KVNamespaceLite {
  const store = new Map<string, string>();
  return {
    async get(key) {
      return store.has(key) ? store.get(key)! : null;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}
