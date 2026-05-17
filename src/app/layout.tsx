import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Hitster — Music Trivia Game',
  description:
    'A real-time multiplayer music trivia game. Build your timeline, guess the year, and steal from your friends!',
  keywords: ['music', 'trivia', 'game', 'multiplayer', 'spotify', 'hitster'],
  openGraph: {
    title: 'Hitster — Music Trivia Game',
    description: 'Real-time multiplayer music trivia. Can you build the perfect timeline?',
    type: 'website',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0F0F1A',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <meta name="darkreader-lock" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-dvh antialiased" suppressHydrationWarning>
        <div className="ambient-bg" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
