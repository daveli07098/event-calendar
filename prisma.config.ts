import path from "node:path";
import { defineConfig } from "prisma/config";
import { config } from "dotenv";

// Load .env.local first (Supabase / production URLs), then fall back to .env (local Docker)
config({ path: path.join(__dirname, ".env.local") });
config({ path: path.join(__dirname, ".env") }); // only fills vars not already set

export default defineConfig({
  schema: path.join(__dirname, "prisma", "schema.prisma"),
});
