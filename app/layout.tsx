import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "And 1 more thing — spokojne miejsce na później",
  description:
    "Wyrzuć z głowy męczące myśli i wróć do nich wtedy, kiedy masz na to przestrzeń.",
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
