import type { Metadata } from "next";
import { renderInline } from "@/lib/render-inline";

export const metadata: Metadata = {
  title: "What BitGraph is Not",
  description: "Precise distinctions between BitGraph and other systems.",
};

export default function WhatBitGraphIsNotPage() {
  return (
    <article className="prose-doc">
      <h1 className="mb-6">What BitGraph is Not</h1>
      <p className="text-[#1f2937] mb-10">
        Precise distinctions matter for a protocol that makes specific
        cryptographic claims. Here is what BitGraph does not claim and does not do.
      </p>

      <div className="space-y-6">
        {[
          {
            title: "BitGraph is not a blockchain",
            body: "BitGraph does not use distributed consensus, a global ledger, or tokens. It constrains a single execution boundary. There is no mining, no gas, no network of validators. Proof chaining (`prevB64`) creates a local hash chain within one boundary, not a distributed data structure.",
          },
          {
            title: "BitGraph is not a watermark",
            body: "BitGraph does not hide anything in content. A recording hashes the bytes and modifies nothing. A fused artifact is a new file built from the original under a registered placement, a trailer or a container around the unchanged file; the commitment it carries is documented, not concealed, and the original is never modified. The proof is a separate JSON object. Removing the proof does not change any bytes; it only removes the evidence of the commit event.",
          },
          {
            title: "BitGraph is not DRM",
            body: "BitGraph does not prevent copying, sharing, or redistribution of artifact bytes. It prevents the authoritative proof lineage from being duplicated within a policy domain. The artifact itself is freely copyable, but only the original proof will verify against it.",
          },
          {
            title: "BitGraph is not proof of truth",
            body: "BitGraph proves that specific bytes were committed through an authorized boundary. The content of those bytes may be factually wrong, misleading, or fabricated. An LLM committed through BitGraph is still an LLM. It can hallucinate. BitGraph proves the commit event, not the content semantics.",
          },
          {
            title: "BitGraph is not proof of authorship",
            body: "A proof attests which boundary committed an artifact, not who created the underlying content. A signed attribution is a note bound into the proof, not a verified identity; for a fused artifact it names the placement and the origin digest.",
          },
          {
            title: "BitGraph is not proof of first creation",
            body: "A recording does not prove that these bytes never existed before this commit. The same content could have been created elsewhere earlier. A fused artifact carries a commitment to a slot that existed first, so its bytes could not have been finalized before that slot was allocated; the bound is on the fused bytes, not on the content, and the origin it was built from can be any age. BitGraph proves where bytes sit in a boundary's counter sequence, and for fused bytes that they came after their slot. Nothing more.",
          },
          {
            title: "BitGraph is not attestation",
            body: "Attestation is evidence that BitGraph carries, not what BitGraph is. A TEE attestation report (e.g., AWS Nitro) proves that specific code is running inside a specific hardware boundary. BitGraph is the proof architecture that attestation fits into, the framework for atomic commit events where attestation provides environmental evidence.",
          },
          {
            title: "BitGraph is not notarization",
            body: "Traditional notarization involves a trusted third party witnessing a signing event. BitGraph is a self-contained proof system. The proof is verifiable offline using only the public key and the original bytes. No trusted third party is required for core verification.",
          },
        ].map((item) => (
          <div key={item.title} className="border-l-2 border-l-[#d0d5dd] pl-6">
            <h2 className="text-base font-semibold mb-3">{item.title}</h2>
            <p className="text-base text-[#1f2937] leading-relaxed">{renderInline(item.body)}</p>
          </div>
        ))}
      </div>
    </article>
  );
}
