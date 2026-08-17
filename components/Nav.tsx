import Link from 'next/link';
import Image from 'next/image';
import { SITE } from '@/lib/site';

export function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/8 bg-ink-950/80 backdrop-blur-lg">
      <nav
        aria-label="Hlavná navigácia"
        className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6"
      >
        <Link href="/" className="inline-flex items-center gap-2.5">
          <Image
            src="/logo-128.png"
            alt=""
            width={34}
            height={34}
            priority
            className="h-[34px] w-[34px]"
          />
          <span className="font-semibold tracking-tight text-white">{SITE.name}</span>
        </Link>

        <div className="flex items-center gap-1.5 sm:gap-4">
          <Link
            href="/pricing"
            className="hidden rounded-lg px-3 py-2 text-sm text-white/60 transition
                       hover:text-white sm:block"
          >
            Predplatné
          </Link>
          <Link
            href="/account"
            className="rounded-lg px-3 py-2 text-sm text-white/60 transition hover:text-white"
          >
            Účet
          </Link>
          <Link
            href="/api/discord/link?returnTo=/account"
            className="inline-flex items-center gap-2 rounded-lg bg-discord px-3.5 py-2
                       text-sm font-medium text-white transition hover:brightness-110"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M20.317 4.369A19.79 19.79 0 0 0 15.432 3a13.9 13.9 0 0 0-.617 1.267 18.4 18.4 0 0 0-5.62 0A13.4 13.4 0 0 0 8.57 3 19.74 19.74 0 0 0 3.68 4.372C.56 9.02-.284 13.58.14 18.075a19.9 19.9 0 0 0 6.026 3.043c.474-.64.9-1.32 1.264-2.033a12.9 12.9 0 0 1-1.99-.953c.167-.121.33-.247.487-.376a14.2 14.2 0 0 0 12.146 0c.16.135.323.26.487.376-.634.375-1.302.694-1.995.955.365.712.79 1.39 1.264 2.03a19.86 19.86 0 0 0 6.03-3.041c.5-5.177-.838-9.703-3.542-13.706ZM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.42 0-1.334.955-2.42 2.157-2.42 1.21 0 2.176 1.096 2.157 2.42 0 1.335-.955 2.42-2.157 2.42Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.42 0-1.334.955-2.42 2.157-2.42 1.21 0 2.176 1.096 2.157 2.42 0 1.335-.947 2.42-2.157 2.42Z" />
            </svg>
            <span className="hidden sm:inline">Prepojiť Discord</span>
            <span className="sm:hidden">Discord</span>
          </Link>
        </div>
      </nav>
    </header>
  );
}
