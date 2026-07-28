"use client";

import { useState, useRef, useEffect } from "react";

const sections = [
  { id: "sec-introduction", num: "1", title: "Introduction" },
  { id: "sec-the-problem", num: "2", title: "The Problem" },
  { id: "sec-concrete-example", num: "2.1", title: "A Concrete Example", indent: true },
  { id: "sec-provenance-example", num: "2.2", title: "Provenance Without Enforcement", indent: true },
  { id: "sec-ledger-example", num: "2.3", title: "Ledger Without Creation Constraint", indent: true },
  { id: "sec-definitions", num: "3", title: "Definitions and Terminology" },
  { id: "sec-invariants", num: "4", title: "System Invariants" },
  { id: "sec-tota", num: "5", title: "Trusted Origin Token Architecture" },
  { id: "sec-functional-properties", num: "5.1", title: "Functional Properties", indent: true },
  { id: "sec-limits-token", num: "5.2", title: "Limits of Token-Based Enforcement", indent: true },
  { id: "sec-bitgraph", num: "6", title: "BitGraph" },
  { id: "sec-atomic-causality", num: "6.1", title: "Atomic Causality", indent: true },
  { id: "sec-not-attestation", num: "6.2", title: "Why This Is Not Attested Execution", indent: true },
  { id: "sec-token-equivalence", num: "6.3", title: "Token-Equivalence", indent: true },
  { id: "sec-formal", num: "7", title: "Formal Model" },
  { id: "sec-state-space", num: "7.1", title: "State Space and Transition System", indent: true },
  { id: "sec-core-invariants", num: "7.2", title: "Core Invariants", indent: true },
  { id: "sec-closure-algebra", num: "7.3", title: "Constructor Image", indent: true },
  { id: "sec-duality", num: "7.4", title: "Token\u2013Nonce Duality", indent: true },
  { id: "sec-security", num: "8", title: "Adversarial Model and Security Game" },
  { id: "sec-threat-model", num: "8.1", title: "Threat Model", indent: true },
  { id: "sec-forgery-game", num: "8.2", title: "Security Game: Origin Forgery", indent: true },
  { id: "sec-falsifiers", num: "8.3", title: "Falsifiable Distinctions", indent: true },
  { id: "sec-architecture", num: "9", title: "Architecture" },
  { id: "sec-state-transition", num: "9.1", title: "State Transition Model", indent: true },
  { id: "sec-finalization-protocol", num: "9.2", title: "Atomic Finalization Protocol", indent: true },
  { id: "sec-verification-model", num: "9.3", title: "Verification Model", indent: true },
  { id: "sec-enforcement-verification", num: "9.4", title: "Enforcement vs. Verification", indent: true },
  { id: "sec-verification-independence", num: "9.5", title: "Verification Independence", indent: true },
  { id: "sec-boundary-compromise", num: "9.6", title: "Boundary Compromise and Recovery", indent: true },
  { id: "sec-convergent-witnessing", num: "9.7", title: "Convergent Independent Witnessing", indent: true },
  { id: "sec-security-properties", num: "9.8", title: "Security Properties", indent: true },
  { id: "sec-related", num: "10", title: "Related Work" },
  { id: "sec-structural-distinctions", num: "10.8", title: "Structural Distinctions", indent: true },
  { id: "sec-examples", num: "11", title: "Worked Examples" },
  { id: "sec-instantiations", num: "12", title: "Instantiations of the Atomic Boundary" },
  { id: "sec-enforcement-tiers", num: "12.1", title: "Enforcement Tier Semantics", indent: true },
  { id: "sec-admission", num: "13", title: "Admission of Pre-Existing Data" },
  { id: "sec-provenance-chains", num: "13.1", title: "Enforced Provenance Chains", indent: true },
  { id: "sec-implementation", num: "14", title: "Implementation Considerations" },
  { id: "sec-deployment", num: "15", title: "Deployment Strategy" },
  { id: "sec-applications", num: "16", title: "Applications" },
  { id: "sec-birth-death", num: "17", title: "Birth\u2013Death Semantics" },
  { id: "sec-value-transfer", num: "18", title: "Single-Transfer Value" },
  { id: "sec-conclusion", num: "19", title: "Conclusion" },
  { id: "sec-references", num: "", title: "References" },
];

export default function TocDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function scrollTo(id: string) {
    setOpen(false);
    const el = document.getElementById(id);
    if (el) {
      const y = el.getBoundingClientRect().top + window.scrollY - 80;
      window.scrollTo({ top: y, behavior: "smooth" });
    }
  }

  return (
    <div ref={ref} className="relative mb-8">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 border border-[#e5e7eb] bg-[#f9fafb] text-sm text-[#1f2937] hover:text-[#111827] hover:border-text-tertiary transition-colors"
      >
        <span className="font-medium">Table of Contents</span>
        <svg
          className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-[70vh] overflow-y-auto border border-[#e5e7eb] bg-[#f9fafb]">
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => scrollTo(s.id)}
              className={`w-full text-left px-4 py-2 text-sm hover:bg-white/5 transition-colors flex gap-2 ${
                s.indent ? "pl-8 text-[#636a78]" : "text-[#1f2937] font-medium"
              }`}
            >
              {s.num && (
                <span className="text-[#636a78] w-8 shrink-0 font-mono text-xs leading-5">
                  {s.num}
                </span>
              )}
              <span className="hover:text-text">{s.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
