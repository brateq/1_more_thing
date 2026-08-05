import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "And 1 more thing",
  description:
    "Wyrzuć z głowy męczące myśli i wróć do nich wtedy, kiedy masz na to przestrzeń.",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
