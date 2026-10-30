import { redirect } from "next/navigation";

/** Check is Make (2026-10-29): a drop is the check. A file already recorded opens its proof; a new one becomes one. */
export default function CheckPage() {
  redirect("/make");
}
