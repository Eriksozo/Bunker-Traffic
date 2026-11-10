import type { Metadata } from "next";
import "./globals.css";
// Notch design system: tokens, legacy bridge and .ds-* components (docs/web-design-system.md).
import "./notch-ds.css";

export const metadata: Metadata = {
  title: "Bunker · Central de tráfego",
  description: "Contexto antes da decisão. Central privada de otimização de campanhas.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
