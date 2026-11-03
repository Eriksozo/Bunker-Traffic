import type { Metadata } from "next";
import "./globals.css";

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
