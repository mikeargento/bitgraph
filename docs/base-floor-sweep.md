# Base floor (enclave v10): copy sweep work list

Inventory taken 2026-10-06 on branch base-floor (= main bd90a5bb). About 230 pieces of
user-facing copy in 50 files describe the Ethereum floor, the anchor stream, or the
ceiling in position. Full table: the session transcript of 2026-10-06; summary by area:

- Proof page + proof view: floor row, anchor sentences/pills, ceiling-in-position row,
  "Confirmed with Ethereum and Base", anchor proof pages (isEth / isAnchor branches).
- Download package: README (package-layout.ts), ethereum-anchors/ folder (anchor-export.ts,
  anchor-package.ts, carrier-site.ts fetchAnchorPair, bitgraph-camera.tsx export zip,
  folder-check.ts reader).
- Floors page (/ledger, /ledger/archive, explorer.tsx, anchor-recovery.tsx) -> one Base page
  (floor and ceiling per BitGraph), menu item "Floors"/"Ceilings" merge (docs-sections.ts,
  menu-icons.tsx).
- Docs: overview, what-is-bitgraph, trust-model, proof-format, verification, integration,
  carrier, player, sdk, mcp, faq, audit, self-host-tee, what-bitgraph-is-not, try, folder.
- Figures: anchor-figure.tsx, epoch-figure.tsx.
- Other pages: tree-export-list, jev-asker, art-maker, subjects, exam, terms (counsel),
  privacy (counsel).
- API reference + API/MCP strings (anchors/window/witness routes, fuse/commit errors,
  mcp/route.ts instructions, lib/mcp/format.ts).
- Metadata: layout keywords, home description, docs descriptions.
- READMEs: root, website, packages/{mcp,sdk,verify,player,audit,titles}.

Cannot be edited (need a new version, Mike's call):
- spec/SPEC.md and website/public/spec/SPEC.md (frozen v1, hash pinned in spec/FROZEN.json):
  needs SPEC v2 beside it.
- website/public/example/bitgraph-demonstration*.txt: recorded files, re-record instead.
- Package source strings (verify check names, mcp server instructions) change with the
  package publishes.
