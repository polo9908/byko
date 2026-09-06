import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "byko — Business Context Checker",
  description:
    "Analysez vos tickets avant de les démarrer : traduction en langage clair, cohérence avec l'historique, composants Figma réutilisables.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={manrope.variable}>
      <body>{children}</body>
    </html>
  );
}
