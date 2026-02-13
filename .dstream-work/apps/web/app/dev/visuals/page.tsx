import { notFound } from "next/navigation";
import VisualsClient from "./VisualsClient";

export const dynamic = "force-dynamic";

export default function DevVisualsPage() {
  if (process.env.NODE_ENV !== "development" && process.env.DSTREAM_DEVTOOLS !== "1") notFound();
  return <VisualsClient />;
}
