import type { Metadata } from "next";
import "./globals.css";
import { AppProvider } from "@/components/AppProvider";

export const metadata: Metadata = {
  title: "CLIPX AI — Automatic AI Gaming Clip Generator",
  description:
    "Monitor authorized live gaming streams, maintain a 20-second rolling buffer, detect hype moments automatically, score clips 0–100 with AI, edit in 9:16/16:9/1:1, and export MP4s.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-zinc-950 antialiased">
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  );
}
