"use client";

import { useRouter } from "next/navigation";
import { FileDrop } from "@/components/file-drop";
import { setPendingDrop } from "@/lib/pending-drop";

// The camera, kept ready at the top of every proof page: dropping here hands
// the files to the home page (where results and the Roll live) via the
// pending-drop slot and navigates client-side, so the flow is drop -> proof ->
// drop again without ever hunting for a way back.
export function ProofDrop() {
  const router = useRouter();
  const onFiles = (files: File[]) => {
    if (!files.length) return;
    setPendingDrop(files);
    router.push("/");
  };
  return (
    <div style={{ height: 130, marginBottom: 28 }}>
      <FileDrop multiple compact onFiles={onFiles} />
    </div>
  );
}
