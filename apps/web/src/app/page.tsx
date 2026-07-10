import { Renderer } from "@/renderer/renderer";
import { loadScreenDef } from "@/lib/screendefs";

// Home. ponytail: one dynamic route (/s/[screen]) renders every other
// screen-def; the root path renders `home` directly.
export default function HomePage() {
  return <Renderer def={loadScreenDef("home")} />;
}
