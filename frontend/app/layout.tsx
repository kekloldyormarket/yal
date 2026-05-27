import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { Chrome } from "./chrome";

export const metadata: Metadata = {
  title: "YAL.fun — permissionless meme → stake-bag",
  description:
    "every graduated meme on YAL routes bonded SOL into stacSOL. burn your meme to claim your share.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Providers>
          <Chrome>{children}</Chrome>
        </Providers>
      </body>
    </html>
  );
}
