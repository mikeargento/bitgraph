import { redirect } from "next/navigation";

/** A drop is the check: a file already recorded opens its proof, a new one gets its BitGraph. That page is /demos. */
export default function CheckPage() {
  redirect("/demos");
}
