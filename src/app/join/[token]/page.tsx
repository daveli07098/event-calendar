import { prisma } from "@/lib/prisma";
import { JoinClient } from "./JoinClient";

interface Props {
  params: Promise<{ token: string }>;
}

export default async function JoinPage({ params }: Props) {
  const { token } = await params;

  const calendar = await prisma.calendar.findUnique({
    where: { shareToken: token },
    include: { user: { select: { name: true, image: true } } },
  });

  if (!calendar || !calendar.shareMode) {
    return <JoinClient token={token} preview={null} error="not_found" />;
  }

  return (
    <JoinClient
      token={token}
      preview={{
        id: calendar.id,
        name: calendar.name,
        color: calendar.color,
        shareMode: calendar.shareMode as "collaborative" | "broadcast",
        owner: calendar.user,
      }}
    />
  );
}
