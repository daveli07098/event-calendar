import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { SettingsClient } from "./SettingsClient";

export const metadata = {
  title: "Settings",
  description: "Manage your account, Google sync, and calendar preferences",
};

export default async function SettingsPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  return <SettingsClient user={session.user} />;
}
