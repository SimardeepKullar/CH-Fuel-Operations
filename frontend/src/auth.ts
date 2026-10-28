import NextAuth from "next-auth";
import { credentialsProvider } from "./auth/credentialsProvider";
import { applySessionUser, applyUserToToken } from "./auth/sessionCallbacks";

declare module "next-auth" {
  interface User {
    role?: string;
  }
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: string;
    };
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    role?: string;
  }
}

export { credentialsProvider };

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/signin" },
  providers: [credentialsProvider],
  callbacks: {
    jwt({ token, user }) {
      return applyUserToToken(token, user);
    },
    session({ session, token }) {
      return applySessionUser(session, token);
    },
  },
});
