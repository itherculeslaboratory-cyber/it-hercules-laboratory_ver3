// (あ) 既存画面の fork 支援エンドポイント(Next Route Handler・同一オリジン)。
// screen-defs/*.json は repo ルートのファイル正本で、fs 読みは Next サーバ(node runtime)
// でしか動かないため、ここで list と 1 画面取得を提供する。apps/api(worker)ではなく
// web 側に置くのは、これがビルダー支援(ファイル読み)であって Truth API ではないから。
//   GET /fork/screens        → { screens: [{ id, title }] }(fork できる既存画面の一覧)
//   GET /fork/screens?id=xxx  → その ScreenDef(fork の初期データ)
import { NextResponse } from "next/server";
import { allScreenDefIds, loadScreenDef } from "@/lib/screendefs";

export const runtime = "nodejs";

export function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    if (!allScreenDefIds().includes(id)) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json(loadScreenDef(id));
  }
  const screens = allScreenDefIds()
    .map((sid) => ({ id: sid, title: loadScreenDef(sid).title }))
    .sort((a, b) => a.title.localeCompare(b.title, "ja"));
  return NextResponse.json({ screens });
}
