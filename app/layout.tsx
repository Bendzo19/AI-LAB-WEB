import type { Metadata } from 'next';
import './globals.css';
import { Nav } from '@/components/Nav';
import { Footer } from '@/components/Footer';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: `${SITE.name} — ${SITE.tagline}`,
    template: `%s · ${SITE.name}`,
  },
  description: SITE.description,
  openGraph: {
    title: SITE.name,
    description: SITE.description,
    url: SITE.url,
    siteName: SITE.name,
    locale: 'sk_SK',
    type: 'website',
    images: [{ url: SITE.logo, width: 930, height: 930, alt: SITE.name }],
  },
  twitter: {
    card: 'summary',
    title: SITE.name,
    description: SITE.description,
    images: [SITE.logo],
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sk">
      <body className="min-h-dvh antialiased">
        {/* skip link — prvá vec, na ktorú narazí klávesnica a čítačka */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4
                     focus:z-50 focus:rounded-lg focus:bg-brand-500 focus:px-4
                     focus:py-2 focus:text-sm focus:font-medium focus:text-white"
        >
          Preskočiť na obsah
        </a>
        <Nav />
        <main id="main">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
