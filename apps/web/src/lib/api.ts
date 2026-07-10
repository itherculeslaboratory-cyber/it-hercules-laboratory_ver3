// API base — NEXT_PUBLIC_API_URL, dev default per design-c2 §4.3.
export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8787";

export function apiUrl(path: string): string {
  return API_BASE + path;
}
