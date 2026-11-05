import { redirect } from "next/navigation";

// Overview is the landing screen (A8.1); with no query string its scope is
// All time. New Plan lives at /plans/new (T-107).
export default function Home() {
  redirect("/overview");
}
