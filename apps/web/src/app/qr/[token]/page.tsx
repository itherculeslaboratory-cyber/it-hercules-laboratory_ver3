import { Renderer } from "@/renderer/renderer";
import { loadScreenDef } from "@/lib/screendefs";

// Physical QR label target: /qr/<token>. Renders the qr-resume ScreenDef with
// the path token as scope so the card resolves token → individual (design-c2
// §4.5 "qr-resume (/qr/[token] → 個体文脈で obs-entry へ)").
export default async function QrResumePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <Renderer def={loadScreenDef("qr-resume")} params={{ token }} />;
}
