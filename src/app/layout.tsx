import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KidSync — Co-Parent Calendar",
  description:
    "Shared calendar for co-parents to coordinate kids' schedules, travel, and activities.",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
