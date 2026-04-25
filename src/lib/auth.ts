import NextAuth, { type DefaultSession } from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { compare } from "bcryptjs";
import { prisma } from "@/lib/prisma";

declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // If a credentials user with the same email already exists, link Google to
      // that account rather than creating a second user record.
      allowDangerousEmailAccountLinking: true,
      authorization: {
        params: {
          scope:
            "openid email profile https://www.googleapis.com/auth/calendar.readonly",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;

        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user?.password) return null;

        const valid = await compare(password, user.password);
        if (!valid) return null;

        return { id: user.id, name: user.name, email: user.email, image: user.image };
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      // Google deduplication: if this Google sign-in resolves to a user that has
      // NO password (OAuth-only), but another user with the same email DOES have a
      // password (credentials user), the credentials user should be the canonical
      // account. Transfer the Google Account row there so both auth methods work
      // on a single identity.
      if (account?.provider === "google" && user.id && user.email) {
        const credUser = await prisma.user.findFirst({
          where: {
            email: user.email,
            password: { not: null },
            id: { not: user.id },
          },
        });
        if (credUser) {
          // Move the Google Account to the credentials user (upsert by unique key)
          await prisma.account.updateMany({
            where: { userId: user.id, provider: "google" },
            data: { userId: credUser.id },
          });
          // Override resolved user so the JWT gets the credentials user's ID
          user.id = credUser.id;
        }
      }
      return true;
    },
    async jwt({ token, user, account, isNewUser }) {
      if (user) token.id = user.id;
      // Flag brand-new Google sign-ups so we can redirect to the sync picker
      if (account?.provider === "google" && isNewUser) {
        token.newGoogleUser = true;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string;
      }
      if (token.newGoogleUser) {
        (session as Record<string, unknown>).newGoogleUser = true;
      }
      return session;
    },
    async redirect({ url, baseUrl }) {
      // After Google sign-in NextAuth passes ?callbackUrl — honour it
      if (url.startsWith(baseUrl)) return url;
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      return baseUrl;
    },
  },
  events: {
    async createUser({ user }) {
      // Create a default calendar for new users
      await prisma.calendar.create({
        data: {
          userId: user.id!,
          name: "My Calendar",
          color: "#4285f4",
          isDefault: true,
        },
      });
    },
  },
});
