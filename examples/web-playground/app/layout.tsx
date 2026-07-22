import type { Metadata } from "next";
import { VMProvider } from "@/hooks/use-vm";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenNest Playground",
  description: "Web playground for the OpenNest VM — HomeDSL interpreter with real-time execution visualization",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body className="h-full">
        <VMProvider>{children}</VMProvider>
      </body>
    </html>
  );
}
