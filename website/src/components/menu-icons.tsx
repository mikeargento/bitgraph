// Copyright (c) 2024-2026 Argento Computing Inc. All rights reserved.
/**
 * The Menu's icon blocks, in Google's style: Material Symbols Rounded on a
 * tint of one of Google's four colours, the colours taken in turn down each
 * group. The font is loaded in the root layout with only these icons.
 */
const ICON: Record<string, string> = {
  "https://live.bitgraph.ing": "sports_baseball",
  "/exam": "assignment_turned_in",
  "/docs/try": "add_box",
  "/ceilings": "deployed_code",
  "/docs/overview": "schema",
  "/subjects": "work",
  "/docs/trust-model": "verified_user",
  "/docs/what-bitgraph-is-not": "block",
  "/docs/what-is-bitgraph": "description",
  "/docs/integration": "integration_instructions",
  "/docs/sdk": "inventory_2",
  "/docs/mcp": "smart_toy",
  "/api-reference": "data_object",
  "/docs/self-host-tee": "dns",
  "/docs/verification": "verified",
  "/docs/audit": "fact_check",
  "/docs/proof-format": "receipt_long",
  "/docs/carrier": "approval",
  "/docs/player": "rule",
};
/** The icon names, sorted, for the font request (Google Fonts wants them in order). */
export const MENU_ICON_NAMES = [...new Set(Object.values(ICON))].sort().join(",");
const TINTS = ["blue", "red", "yellow", "green"] as const;

/** Floors are Ethereum blocks: the Ethereum logo's facets, in one colour at the logo's own shading steps. */
function EthMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 1.8 5.4 12.4 12 9.4z" opacity=".55" />
      <path d="M12 1.8 18.6 12.4 12 9.4z" opacity=".9" />
      <path d="M5.4 12.4 12 16.3V9.4z" opacity=".3" />
      <path d="M18.6 12.4 12 16.3V9.4z" opacity=".7" />
      <path d="M5.4 13.7 12 22.2v-4.6z" opacity=".55" />
      <path d="M18.6 13.7 12 22.2v-4.6z" opacity=".9" />
    </svg>
  );
}

export function MenuIcon({ href, index = 0 }: { href: string; index?: number }) {
  return (
    <span className={`menu-block g-${TINTS[index % TINTS.length]}`} aria-hidden="true">
      {href === "/ledger" ? <EthMark /> : <span className="material-symbols-rounded">{ICON[href] ?? "circle"}</span>}
    </span>
  );
}
