import { ProofSkeleton } from "./proof-skeleton";

// Painted by the App Router the instant a navigation to /proof/[digest]
// starts, while the route payload streams. Without this file a cold
// navigation is a multi-second dead click (the previous page just sits
// there); with it, the same skeleton the page itself shows appears
// immediately, so the transition and the data wait read as one moment.
export default function Loading() {
  return <ProofSkeleton />;
}
