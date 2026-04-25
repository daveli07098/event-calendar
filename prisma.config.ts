import path from "node:path";
import { defineConfig } from "prisma/config";
import { config } from "dotenv";

// Prisma's config runner doesn't auto-load .env — do it explicitly
config({ path: path.join(__dirname, ".env") });

export default defineConfig({
  schema: path.join(__dirname, "prisma", "schema.prisma"),
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
