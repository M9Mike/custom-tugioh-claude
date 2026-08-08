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
  title: 'Shadow Duel',
  description:
    'A two-player online duel between the original anime duelists, with 25-card decks and overpowered custom effects.',
  applicationName: 'Shadow Duel',
  appleWebApp: {
    capable: true,
    title: 'Shadow Duel',
    /* NOT `black-translucent`. That one draws the page under the status bar and
       then — in a home-screen app, on every iOS to date — reports
       `env(safe-area-inset-top)` as 0, so there is nothing to inset by and the
       board runs under the clock. `black` has iOS reserve the status bar and lay
       the web view out beneath it, which is correct on a notch, a Dynamic Island
       and a home-button phone alike, with no pixel guessing on our side. The bar
       is black against a #0a0c11 app, so nothing looks cut off. */
    statusBarStyle: 'black',
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
        {/* `@media (display-mode: standalone)` is not dependable in an iOS
            home-screen app — `navigator.standalone` is, and always has been.
            This runs before the first paint so the layout is never briefly
            wrong, and it is inline because a module would be too late. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(navigator.standalone===true||matchMedia('(display-mode: standalone)').matches)" +
              "document.documentElement.dataset.standalone='1'}catch(e){}",
          }}
        />
      </head>
      <body className="min-h-full">
        <div className="arena-bg" aria-hidden />
        {children}
      </body>
    </html>
  );
}
