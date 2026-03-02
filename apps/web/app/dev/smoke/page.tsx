import { notFound } from "next/navigation";
import SmokeTestClient from "./SmokeTestClient";

export const dynamic = "force-dynamic";

export default function SmokeTestPage() {
  if (process.env.NODE_ENV !== "development" && process.env.DSTREAM_DEVTOOLS !== "1") notFound();
  return <SmokeTestClient />;
}
