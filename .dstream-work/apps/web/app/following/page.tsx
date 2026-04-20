import { redirect } from "next/navigation";

export default function FollowingPage() {
  redirect("/browse?tab=following");
}
