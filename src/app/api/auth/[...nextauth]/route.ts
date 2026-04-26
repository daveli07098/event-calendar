import { handlers } from "@/lib/auth";

// Force Node.js runtime — Edge runtime cannot access process.env or Prisma
export const runtime = "nodejs";

export const { GET, POST } = handlers;
