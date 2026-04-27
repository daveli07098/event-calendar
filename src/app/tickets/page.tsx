import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { TicketSection } from "@/components/tickets/TicketSection";

export const metadata = {
  title: "Ticket Section — Event Calendar",
  description: "Paste any ticket URL and auto-add it to your calendar",
};

export default async function TicketsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  return <TicketSection />;
}
