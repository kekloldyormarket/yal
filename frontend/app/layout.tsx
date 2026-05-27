export const metadata = {
  title: "yal.fun",
  description: "Yet Another Launchpad. Memes → stacSOL.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0a0a0a", color: "#e7e7e7" }}>
        {children}
      </body>
    </html>
  );
}
