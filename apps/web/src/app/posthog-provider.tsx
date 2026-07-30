"use client";

// PostHog 初期化(V3-FND-23 修正承認・計画書§5「既製OSSで。作らない」)。
// NEXT_PUBLIC_POSTHOG_KEY が未設定なら posthog.init を呼ばない — 完全に無効化され、
// ビルド/実行が壊れない(鍵の実値はここで読まない・出力しない・コミットしない)。
import { useEffect } from "react";
import posthog from "posthog-js";

let initialized = false;

export function PosthogProvider() {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key || initialized) return;
    posthog.init(key, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
      person_profiles: "identified_only",
    });
    initialized = true;
  }, []);

  return null;
}
