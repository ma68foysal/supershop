import type { Metadata, Viewport } from "next";
import { Anek_Bangla } from "next/font/google";
import { BusyProvider } from "@/components/busy";
import "./globals.css";

// One family for Bangla and Latin; the width axis gives the narrow sign-painter numerals.
const anek = Anek_Bangla({
  variable: "--font-anek",
  subsets: ["latin", "bengali"],
  axes: ["wdth"],
});

export const metadata: Metadata = {
  title: "Dokan",
  description: "Record daily shop sales and get a PDF report every day",
  appleWebApp: { capable: true, title: "Dokan", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#9E1B22",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={anek.variable}>
      <body>
        <BusyProvider>{children}</BusyProvider>
      </body>
    </html>
  );
}
