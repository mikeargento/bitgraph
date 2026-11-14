import { redirect } from "next/navigation";

/** Drop a file is /demos: this older address of the same page sends its visitors there. */
export default function MakePage() {
  redirect("/demos");
}
