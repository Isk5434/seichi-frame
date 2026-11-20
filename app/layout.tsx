import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "巡礼フレーム",
  description: "聖地の参考写真と自分の写真を比較し、構図を合わせる個人用アプリ。",
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
    <html lang="ja">
      <body className="antialiased">{children}</body>
    </html>
  );
}
