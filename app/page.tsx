import { redirect } from "next/navigation";

// The proxy already guards routes; this just forwards "/" to the right place.
export default function Home() {
  redirect("/dashboard");
}
