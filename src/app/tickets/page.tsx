import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { TicketSection } from "@/components/tickets/TicketSection";

export const metadata = {
  title: "Event Section",
  description: "Import events from ticket URLs, manage venues, and classify your calendar events",
};

export default async function TicketsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  return <TicketSection />;
}
