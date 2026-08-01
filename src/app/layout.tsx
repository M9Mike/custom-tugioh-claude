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
  applicationName: 'Shadow Duel',
  appleWebApp: {
    capable: true,
    title: 'Shadow Duel',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: [{ url: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  formatDetection: { telephone: false, date: false, address: false, email: false },
};

export const viewport: Viewport = {
  themeColor: '#0a0c11',
  width: 'device-width',
  initialScale: 1,
  // Both players are on iPhones: draw under the notch and home indicator, and
  // let the layout inset itself with env(safe-area-inset-*).
  viewportFit: 'cover',
  // The board is a fixed, non-scrolling surface; pinch-zoom only breaks it.
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} h-full antialiased`}>
      <head>
        {/* Next emits only the standardised `mobile-web-app-capable`. iOS below
            16.4 still wants the vendor-prefixed one to launch full screen from
            the home screen, and one of the two phones this is built for is old
            enough to care. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </head>
      <body className="min-h-full">
        <div className="arena-bg" aria-hidden />
        {children}
      </body>
    </html>
  );
}
