import { Wait } from "@/components/wait";

// Painted by the App Router the instant a navigation to /proof/[digest] starts, while the route payload streams. The
// page shows the same wait while it fetches the proof, so the route change and the data wait read as one moment.
export default function Loading() {
  return <Wait label="Loading BitGraph…" />;
}
