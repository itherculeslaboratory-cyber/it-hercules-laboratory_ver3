import { Renderer } from "@/renderer/renderer";
import { loadScreenDef } from "@/lib/screendefs";
import { loadCatalogs } from "@/lib/i18n";
import { fetchViewerLocale } from "@/lib/viewer-locale";

// Home. ponytail: one dynamic route (/s/[screen]) renders every other
// screen-def; the root path renders `home` directly.
export default async function HomePage() {
  const viewerLocale = await fetchViewerLocale();
  return <Renderer def={loadScreenDef("home")} catalogs={loadCatalogs()} viewerLocale={viewerLocale} />;
}
