import { Wait } from "@/components/wait";

/* What shows while the calendar is read on the server: the site's one wait look (components/wait.tsx). */
export default function CalendarLoading() {
  return <Wait label="Reading the calendar…" />;
}
