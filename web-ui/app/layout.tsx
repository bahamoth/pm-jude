import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Jude · 요청 인테이크',
  description: '요청을 몇 가지 확인 질문으로 정리해 requirements 문서로 만들어 드립니다.',
  // 파비콘은 축약형 — 콧수염·눈썹은 16px에서 뭉개진다 (docs/persona/jude.md)
  icons: { icon: [{ url: '/jude-mark.svg', type: 'image/svg+xml' }] },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">{children}</body>
    </html>
  );
}
