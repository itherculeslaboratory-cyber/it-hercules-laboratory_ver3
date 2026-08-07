import { Renderer } from "@/renderer/renderer";
import { loadScreenDef } from "@/lib/screendefs";

// Physical individual QR label target: /individuals/<id> (IND-15 bio-card
// qr_url / qr-batch). Renders the qr-individual-hub ScreenDef, which decides
// the landing behavior (QRLINK-1 2026-08-08): everyone lands on the
// individual-detail screen except the individual's own observer, who gets a
// one-time "add an observation or view detail?" choice (or skips straight
// through once they've set a preference).
export default async function IndividualQrPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <Renderer def={loadScreenDef("qr-individual-hub")} params={{ id }} />;
}
