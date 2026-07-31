import type { Metadata, Viewport } from 'next';
import { Cinzel, Inter } from 'next/font/google';
import './globals.css';

const display = Cinzel({
  variable: '--font-display',
  subsets: ['latin'],
  weight: ['400', '600', '700', '900'],
  display: 'swap',
});

const body = Inter({
  variable: '--font-body',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Shadow Duel — Duelist Kingdom',
  description:
    'A two-player online duel between the original Duelist Kingdom duelists, with 25-card anime decks and overpowered custom effects.',
};

export const viewport: Viewport = {
  themeColor: '#0a0c11',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} h-full antialiased`}>
      <body className="min-h-full">
        <div className="arena-bg" aria-hidden />
        {children}
      </body>
    </html>
  );
}
