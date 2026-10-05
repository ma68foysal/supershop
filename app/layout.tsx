import type { Metadata, Viewport } from "next";
import { Anek_Bangla } from "next/font/google";
import { BusyProvider } from "@/components/busy";
import { I18nProvider } from "@/components/i18n";
import { getLang } from "@/lib/i18n-server";
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

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const lang = await getLang();
  return (
    <html lang={lang} className={anek.variable}>
      <body>
        <I18nProvider lang={lang}>
          <BusyProvider>{children}</BusyProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
