import type { MetadataRoute } from "next";

// WIK-17 — PWA share_target. When the OS "share to IHL" gesture fires, the
// browser POSTs the shared title/text/url to the research intake route, which
// lands it as a chat_log content event (research-content-routes.receiveShared).
// Real device-share is a browser gesture verified manually (design-k5 §6 gate);
// this manifest is the wiring the OS reads to offer IHL as a share target.
// ponytail: no icons block — installability icons are added when the PWA install
// flow is enabled; they are optional to declare the share_target contract.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "IT Hercules Laboratory",
    short_name: "IHL",
    start_url: "/",
    display: "standalone",
    share_target: {
      action: "/api/v1/research/shared",
      method: "POST",
      enctype: "application/x-www-form-urlencoded",
      params: { title: "title", text: "text", url: "url" },
    },
  };
}
