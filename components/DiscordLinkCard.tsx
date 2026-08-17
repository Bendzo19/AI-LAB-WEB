/**
 * components/DiscordLinkCard.tsx
 *
 * Drop this into /account. Shows link state, the Předplatné role state, and
 * handles the ?discord= result params the callback sets.
 *
 * Server component wrapper + small client island for the unlink button.
 */

import { getCurrentUserId } from '@/lib/auth';
import { getLinkByUserId, isSubscriptionActive } from '@/lib/db';
import { fetchGuildMember, DISCORD } from '@/lib/discord';
import { UnlinkButton } from './UnlinkButton';

const MESSAGES: Record<string, { tone: 'ok' | 'warn' | 'err'; text: string }> = {
  linked:    { tone: 'ok',   text: 'Discord účet bol úspešne prepojený.' },
  cancelled: { tone: 'warn', text: 'Prepojenie si zrušil.' },
  error:     { tone: 'err',  text: 'Prepojenie sa nepodarilo. Skús to znova.' },
};

const REASONS: Record<string, string> = {
  already_linked:   'Tento Discord účet je už prepojený s iným kontom.',
  session_mismatch: 'Tvoje prihlásenie medzitým vypršalo. Prihlás sa a skús znova.',
  expired_state:    'Odkaz vypršal. Klikni na Prepojiť Discord ešte raz.',
  bad_state:        'Neplatná požiadavka. Klikni na Prepojiť Discord ešte raz.',
  missing_scope:    'Musíš povoliť prístup k základným údajom Discord profilu.',
  server_error:     'Chyba na serveri. Ozvi sa nám, ak to pretrvá.',
};

export async function DiscordLinkCard({
  searchParams,
}: {
  searchParams?: { discord?: string; reason?: string };
}) {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  const link = await getLinkByUserId(userId);
  const subscribed = await isSubscriptionActive(userId);

  let hasRole = false;
  let inGuild = false;
  if (link) {
    const member = await fetchGuildMember(link.discord_id).catch(() => null);
    inGuild = member !== null;
    hasRole = member?.roles.includes(DISCORD.subscriberRoleId) ?? false;
  }

  const flash = searchParams?.discord ? MESSAGES[searchParams.discord] : undefined;
  const reason = searchParams?.reason ? REASONS[searchParams.reason] : undefined;

  const avatarUrl =
    link?.discord_avatar && link.discord_id
      ? `https://cdn.discordapp.com/avatars/${link.discord_id}/${link.discord_avatar}.png?size=64`
      : null;

  return (
    <section className="rounded-2xl border border-white/10 bg-neutral-900/60 p-6">
      <header className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Discord</h2>
          <p className="text-sm text-neutral-400">
            Prepoj svoj Discord a získaj rolu <strong>Předplatné</strong> na serveri AI LAB.
          </p>
        </div>
      </header>

      {flash && (
        <div
          className={[
            'mb-4 rounded-lg px-4 py-3 text-sm',
            flash.tone === 'ok'   && 'bg-emerald-500/10 text-emerald-300',
            flash.tone === 'warn' && 'bg-amber-500/10 text-amber-300',
            flash.tone === 'err'  && 'bg-red-500/10 text-red-300',
          ].filter(Boolean).join(' ')}
        >
          {reason ?? flash.text}
        </div>
      )}

      {!link ? (
        <a
          href="/api/discord/link?returnTo=/account"
          className="inline-flex items-center gap-2 rounded-lg bg-[#5865F2] px-4 py-2.5
                     font-medium text-white transition hover:bg-[#4752c4]"
        >
          <DiscordGlyph />
          Prepojiť Discord
        </a>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" className="h-10 w-10 rounded-full" />
            ) : (
              <div className="h-10 w-10 rounded-full bg-neutral-700" />
            )}
            <div className="min-w-0">
              <p className="truncate font-medium text-white">
                {link.discord_username ?? link.discord_id}
              </p>
              <p className="text-xs text-neutral-500">
                Prepojené {new Date(link.linked_at).toLocaleDateString('sk-SK')}
              </p>
            </div>
          </div>

          <dl className="grid gap-2 text-sm">
            <Row label="Na serveri AI LAB" value={inGuild} />
            <Row label="Aktívne predplatné" value={subscribed} />
            <Row label="Rola Předplatné" value={hasRole} />
          </dl>

          {subscribed && !inGuild && (
            <p className="text-sm text-amber-300">
              Nie si na serveri — pripoj sa a rola sa priradí automaticky do hodiny,
              alebo klikni na Prepojiť Discord znova pre okamžité pridanie.
            </p>
          )}

          {!subscribed && (
            <a href="/pricing" className="inline-block text-sm text-[#8b93ff] hover:underline">
              Aktivuj predplatné a rolu dostaneš okamžite →
            </a>
          )}

          <UnlinkButton />
        </div>
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: boolean }) {
  return (
    <div className="flex items-center justify-between border-t border-white/5 pt-2">
      <dt className="text-neutral-400">{label}</dt>
      <dd className={value ? 'text-emerald-400' : 'text-neutral-500'}>
        {value ? 'áno' : 'nie'}
      </dd>
    </div>
  );
}

function DiscordGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M20.317 4.369A19.79 19.79 0 0 0 15.432 3a13.9 13.9 0 0 0-.617 1.267 18.4 18.4 0 0 0-5.62 0A13.4 13.4 0 0 0 8.57 3 19.74 19.74 0 0 0 3.68 4.372C.56 9.02-.284 13.58.14 18.075a19.9 19.9 0 0 0 6.026 3.043c.474-.64.9-1.32 1.264-2.033a12.9 12.9 0 0 1-1.99-.953c.167-.121.33-.247.487-.376a14.2 14.2 0 0 0 12.146 0c.16.135.323.26.487.376-.634.375-1.302.694-1.995.955.365.712.79 1.39 1.264 2.03a19.86 19.86 0 0 0 6.03-3.041c.5-5.177-.838-9.703-3.542-13.706ZM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.42 0-1.334.955-2.42 2.157-2.42 1.21 0 2.176 1.096 2.157 2.42 0 1.335-.955 2.42-2.157 2.42Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.42 0-1.334.955-2.42 2.157-2.42 1.21 0 2.176 1.096 2.157 2.42 0 1.335-.947 2.42-2.157 2.42Z" />
    </svg>
  );
}
