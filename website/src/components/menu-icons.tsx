// Copyright (c) 2024-2026 Argento Computing Inc. All rights reserved.
/**
 * The Menu's icon blocks, in Google's style: Material Symbols Rounded on a
 * tint of one of Google's four colours, the colours taken in turn down each
 * group. The font is loaded in the root layout with only these icons.
 */
const ICON: Record<string, string> = {
  "/portrait": "face",
  "/jev": "quiz",
  "/exam": "assignment_turned_in",
  "/docs/try": "add_box",
  "/docs/overview": "schema",
  "/subjects": "work",
  "/docs/trust-model": "verified_user",
  "/docs/what-bitgraph-is-not": "block",
  "/docs/what-is-bitgraph": "description",
  "/docs/faq": "help",
  "/docs/integration": "integration_instructions",
  "/docs/sdk": "inventory_2",
  "/docs/mcp": "smart_toy",
  "/api-reference": "data_object",
  "/docs/self-host-tee": "dns",
  "https://github.com/mikeargento/bitgraph": "code",
  "/docs/verification": "verified",
  "/docs/audit": "fact_check",
  "/docs/proof-format": "receipt_long",
  "/docs/carrier": "approval",
  "/docs/player": "rule",
};
/** The icon names, sorted, for the font request (Google Fonts wants them in order). */
export const MENU_ICON_NAMES = [...new Set(Object.values(ICON))].sort().join(",");
const TINTS = ["blue", "red", "yellow", "green"] as const;

/** The Base page (floors and ceilings, one item since enclave v10): Base's mark, the Square, in the block's one colour. */
function BaseMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <rect x="5" y="5" width="14" height="14" rx="2.6" />
    </svg>
  );
}

export function MenuIcon({ href, index = 0 }: { href: string; index?: number }) {
  return (
    <span className={`menu-block g-${TINTS[index % TINTS.length]}`} aria-hidden="true">
      {href === "/ceilings" ? <BaseMark /> : <span className="material-symbols-rounded">{ICON[href] ?? "circle"}</span>}
    </span>
  );
}
