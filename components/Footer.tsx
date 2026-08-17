/**
 * components/Footer.tsx
 *
 * Footer je zámerne miesto, kde sedia veci vyžadované Discordom pre
 * verifikáciu aplikácie:
 *
 *   - odkaz na Podmienky používania      -> /terms
 *   - odkaz na Zásady ochrany os. údajov -> /privacy
 *
 * Tie isté dve URL sú zapísané v Discord Developer Portal
 * (General Information -> URL podmínek / URL zásad). Ak zmeníš cestu tu,
 * MUSÍŠ ju zmeniť aj tam, inak verifikácia spadne.
 *
 * Ďalej tu je inštalačný odkaz bota (tretia vec, ktorú Discord kontroluje)
 * a odkaz na server.
 */

import Link from 'next/link';
import Image from 'next/image';
import { SITE, LEGAL } from '@/lib/site';

const BOT_INVITE =
  'https://discord.com/oauth2/authorize' +
  '?client_id=1538961232252641340' +
  '&permissions=2147601472' +
  '&integration_type=0' +
  '&scope=bot+applications.commands';

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-24 border-t border-white/8 bg-ink-900">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {/* brand */}
          <div className="lg:col-span-2">
            <Link href="/" className="inline-flex items-center gap-2.5">
              <Logo />
              <span className="text-lg font-semibold tracking-tight text-white">
                {SITE.name}
              </span>
            </Link>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-white/45">
              {SITE.tagline}
            </p>

            <div className="mt-5 flex items-center gap-3">
              <a
                href={SITE.discordInvite}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-discord px-3.5 py-2
                           text-sm font-medium text-white transition hover:brightness-110"
              >
                <DiscordGlyph />
                Discord server
              </a>
            </div>
          </div>

          {/* produkt */}
          <nav aria-label="Produkt">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-white/35">
              Produkt
            </h2>
            <ul className="mt-4 space-y-2.5 text-sm">
              <FooterLink href="/pricing">Predplatné</FooterLink>
              <FooterLink href="/account">Môj účet</FooterLink>
              <FooterLink href="/account">Prepojiť Discord</FooterLink>
            </ul>
          </nav>

          {/* ---------- Discord + právne ---------- */}
          <nav aria-label="Právne informácie a Discord">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-white/35">
              Právne &amp; Discord
            </h2>
            <ul className="mt-4 space-y-2.5 text-sm">
              {/* Discord verification: Terms of Service link */}
              <FooterLink href="/terms">Podmienky používania</FooterLink>
              {/* Discord verification: Privacy Policy link */}
              <FooterLink href="/privacy">Zásady ochrany osobných údajov</FooterLink>
              <FooterLink href="/privacy#cookies">Cookies</FooterLink>
              {/* Discord verification: install link */}
              <li>
                <a
                  href={BOT_INVITE}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-white/55 transition hover:text-white"
                >
                  Pridať bota na server
                </a>
              </li>
            </ul>
          </nav>
        </div>

        {/* identifikácia správcu — povinná podľa GDPR čl. 13 */}
        <div className="mt-12 flex flex-col gap-4 border-t border-white/8 pt-7
                        text-xs leading-relaxed text-white/35 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p>
              © {year} {SITE.name}. Všetky práva vyhradené.
            </p>
            <p className="mt-1.5">
              {LEGAL.entity} · {LEGAL.address}
            </p>
            <p className="mt-1">
              IČO {LEGAL.ico}
              {LEGAL.dic && ` · DIČ ${LEGAL.dic}`}
              {LEGAL.vatPayer && LEGAL.icDph && ` · IČ DPH ${LEGAL.icDph}`}
              {!LEGAL.vatPayer && ' · Nie som platiteľ DPH'}
            </p>
            <p className="mt-1">
              Kontakt:{' '}
              <a
                href={`mailto:${LEGAL.email}`}
                className="text-white/55 underline underline-offset-2 hover:text-white"
              >
                {LEGAL.email}
              </a>
            </p>
          </div>
          <p className="max-w-sm sm:text-right">
            AI LAB nie je pridružený k Discord Inc. Discord je registrovaná
            obchodná známka Discord Inc.
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="text-white/55 transition hover:text-white">
        {children}
      </Link>
    </li>
  );
}

function Logo() {
  return (
    <Image
      src="/logo-128.png"
      alt=""
      width={34}
      height={34}
      className="h-[34px] w-[34px]"
    />
  );
}

function DiscordGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M20.317 4.369A19.79 19.79 0 0 0 15.432 3a13.9 13.9 0 0 0-.617 1.267 18.4 18.4 0 0 0-5.62 0A13.4 13.4 0 0 0 8.57 3 19.74 19.74 0 0 0 3.68 4.372C.56 9.02-.284 13.58.14 18.075a19.9 19.9 0 0 0 6.026 3.043c.474-.64.9-1.32 1.264-2.033a12.9 12.9 0 0 1-1.99-.953c.167-.121.33-.247.487-.376a14.2 14.2 0 0 0 12.146 0c.16.135.323.26.487.376-.634.375-1.302.694-1.995.955.365.712.79 1.39 1.264 2.03a19.86 19.86 0 0 0 6.03-3.041c.5-5.177-.838-9.703-3.542-13.706ZM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.42 0-1.334.955-2.42 2.157-2.42 1.21 0 2.176 1.096 2.157 2.42 0 1.335-.955 2.42-2.157 2.42Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.42 0-1.334.955-2.42 2.157-2.42 1.21 0 2.176 1.096 2.157 2.42 0 1.335-.947 2.42-2.157 2.42Z" />
    </svg>
  );
}
