import { notFound } from "next/navigation";
import E2EClient from "./E2EClient";

export const dynamic = "force-dynamic";

export default function DevE2EPage() {
  if (process.env.NODE_ENV !== "development" && process.env.DSTREAM_DEVTOOLS !== "1") notFound();
  return <E2EClient />;
}
