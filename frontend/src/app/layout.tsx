import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SessionProvider } from "next-auth/react";
import { auth } from "../auth";
import "../index.css";

export const metadata: Metadata = {
  title: "CH Fleet · Route Fuel",
  icons: {
    icon: "/ch-logo-favi.png",
  },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await auth();

  return (
    <html lang="en">
      <body>
        <SessionProvider session={session}>{children}</SessionProvider>
      </body>
    </html>
  );
}
