"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";

const sections = [
  { href: "/docs/overview", label: "Overview" },
  { href: "/docs/what-is-bitgraph", label: "What is BitGraph" },
  { href: "/docs/whitepaper", label: "Whitepaper" },
  { href: "/docs/proof-format", label: "Proof Format (bitgraph/1)" },
  { href: "/docs/verification", label: "Verification" },
  { href: "/docs/audit", label: "Audit a Bundle" },
  { href: "/docs/trust-model", label: "Trust Model" },
  { href: "/docs/self-host-tee", label: "Self-Host TEE" },
  { href: "/docs/integration", label: "Integration Guide" },
  { href: "/docs/mcp", label: "MCP" },
  { href: "/docs/automation", label: "Zapier and Make" },
  { href: "/docs/folder", label: "BitGraph Folder" },
  { href: "/docs/what-bitgraph-is-not", label: "What BitGraph is Not" },
  { href: "/docs/faq", label: "FAQ" },
];

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const currentLabel = sections.find(s => s.href === pathname)?.label || "Docs";
  const menuRef = useRef<HTMLDivElement>(null);

  // Click outside to close
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  return (
    <div style={{ width: "90%", maxWidth: 800, margin: "0 auto", padding: "32px 0 80px" }}>
      {/* Section dropdown — used at every viewport now */}
      <div ref={menuRef} className="docs-section-nav" style={{
        position: "sticky", top: 56, zIndex: 40,
        background: "#f5f5f5", marginBottom: 24,
        paddingTop: 8, paddingBottom: 8,
      }}>
        <button
          onClick={() => setMenuOpen(o => !o)}
          aria-expanded={menuOpen}
          aria-label="Documentation sections"
          style={{
            width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "12px 16px", fontSize: 14, fontWeight: 600, color: "#111827",
            background: "#fff", border: "1px solid #d0d5dd", borderRadius: 0,
            cursor: "pointer",
          }}
        >
          <span>{currentLabel}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: menuOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {menuOpen && (
          <div style={{
            marginTop: 8, padding: 8,
            background: "#fff", border: "1px solid #d0d5dd", borderRadius: 0,
            boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
          }}>
            <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {sections.map((s) => (
                <Link
                  key={s.href}
                  href={s.href}
                  onClick={() => setMenuOpen(false)}
                  style={{
                    display: "block", padding: "8px 12px", fontSize: 14,
                    fontWeight: pathname === s.href ? 600 : 400,
                    color: pathname === s.href ? "#111827" : "#4b5563",
                    textDecoration: "none", borderRadius: 0,
                    background: pathname === s.href ? "#f3f4f6" : "transparent",
                  }}
                >
                  {s.label}
                </Link>
              ))}
              {/* External repo link — lives at the end of the section list,
                  not in the top nav. */}
              <a
                href="https://github.com/mikeargento/bitgraph"
                target="_blank"
                rel="noopener"
                onClick={() => setMenuOpen(false)}
                style={{
                  display: "block", padding: "8px 12px", fontSize: 14,
                  fontWeight: 400, color: "#4b5563",
                  textDecoration: "none", borderRadius: 0,
                }}
              >
                GitHub
              </a>
            </nav>
          </div>
        )}
      </div>

      {/* Content */}
      <div>{children}</div>
    </div>
  );
}
