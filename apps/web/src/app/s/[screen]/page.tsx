import { notFound } from "next/navigation";
import { Renderer } from "@/renderer/renderer";
import { allScreenDefIds, loadScreenDef } from "@/lib/screendefs";
import { loadCatalogs } from "@/lib/i18n";
import { fetchViewerLocale } from "@/lib/viewer-locale";

export function generateStaticParams() {
  return allScreenDefIds().map((screen) => ({ screen }));
}

export default async function ScreenPage({
  params,
  searchParams,
}: {
  params: Promise<{ screen: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { screen } = await params;
  if (!allScreenDefIds().includes(screen)) notFound();
  const sp = await searchParams;
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") query[k] = v;
    else if (Array.isArray(v) && typeof v[0] === "string") query[k] = v[0];
  }
  const viewerLocale = await fetchViewerLocale();
  return (
    <Renderer def={loadScreenDef(screen)} params={query} catalogs={loadCatalogs()} viewerLocale={viewerLocale} />
  );
}
