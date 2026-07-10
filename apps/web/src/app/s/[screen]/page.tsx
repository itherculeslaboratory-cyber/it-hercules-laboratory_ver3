import { notFound } from "next/navigation";
import { Renderer } from "@/renderer/renderer";
import { allScreenDefIds, loadScreenDef } from "@/lib/screendefs";

export function generateStaticParams() {
  return allScreenDefIds().map((screen) => ({ screen }));
}

export default async function ScreenPage({
  params,
}: {
  params: Promise<{ screen: string }>;
}) {
  const { screen } = await params;
  if (!allScreenDefIds().includes(screen)) notFound();
  return <Renderer def={loadScreenDef(screen)} />;
}
