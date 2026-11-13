import { Wait } from "@/components/wait";

/* What shows while the ledger is read on the server: the site's one wait look (components/wait.tsx). */
export default function LedgerLoading() {
  return <Wait label="Reading the ledger…" />;
}
