# AI LAB — hlavný web (ailab-web.com) + Discord integrácia

## Rýchly štart — databázu riešiť NEMUSÍŠ

V `.env` doplň **len dve veci**: `DISCORD_BOT_TOKEN` a
`DISCORD_CLIENT_SECRET`. Potom:

```bash
npm install
npm run check      # povie ti presne, čo ešte chýba
npm run dev        # http://localhost:3000
```

Otvor `http://localhost:3000/api/dev/login?sub=1` → `/account` →
**Prepojiť Discord**. Rolu Předplatné musíš mať na serveri do pár sekúnd.

### Prečo netreba databázu

Keď v `.env` nie je `DATABASE_URL`, aplikácia si sama spustí **PGlite** —
skutočný PostgreSQL skompilovaný do WebAssembly, ktorý beží priamo v procese
Node.js a ukládá do priečinka `.dev-db/`. Nič neinštaluješ, nikde sa
neregistruješ, schéma sa aplikuje automaticky. To isté SQL potom pobeží aj na
Neone — nič sa neprepisuje.

Keď neskôr doplníš `DATABASE_URL`, kód automaticky prepne na skutočný
Postgres. V produkcii je `DATABASE_URL` **povinné** — bez neho app naschvál
spadne, aby dáta neskončili v efemérnom priečinku na serveri.

`npm run check` je tvoj prvý krok pri každom probléme. Prejde `.env`,
databázu, token, oprávnenia bota aj hierarchiu rolí a vypíše konkrétnu
príčinu namiesto toho, aby si lovil 403 v logu.


Kompletná Next.js aplikácia pre `ailab-web.com`: landing page, predplatné,
účet s prepojením Discordu, a právne stránky, ktoré vyžaduje Discord na
verifikáciu aplikácie.

Užívateľ klikne na webe na **Prepojiť Discord**, autorizuje sa, a ak má aktívne
predplatné, bot mu na serveri **AI LAB** okamžite priradí rolu **Předplatné**.
Keď predplatné skončí, rolu automaticky stratí.

## Stav

`npm run build` prechádza, `tsc --strict` bez chyby, všetkých 11 routes sa
kompiluje. Stránky boli vizuálne skontrolované v Chromium.

```
○ /            static    landing page
○ /pricing     static    predplatné + FAQ
○ /terms       static    Podmienky používania      ← Discord verifikácia
○ /privacy     static    Zásady ochrany os. údajov ← Discord verifikácia
ƒ /account     dynamic   prepojenie Discordu
ƒ /api/discord/link · callback · unlink
ƒ /api/stripe/webhook
ƒ /api/cron/sync-roles
```

## Čo je už nastavené na Discorde

Toto som spravil za teba, netreba to riešiť:

| Vec | Hodnota / stav |
|---|---|
| Aplikácia | AI LAB WEB — `1538961232252641340` |
| Bot | AILAB WEB BOT#6595, pridaný na server AI LAB |
| Server (guild) ID | `1536436622449451031` |
| Rola Předplatné ID | `1538966404320206898` |
| Rola bota | má `Bots` (pozícia 4 zhora) + vlastnú `AI LAB WEB` |
| Manage Roles | ✅ zapnuté na role `AI LAB WEB` |
| Create Instant Invite | ✅ zapnuté (potrebné pre `guilds.join`) |
| Hierarchia | ✅ `Bots` je nad `Předplatné` |
| Server Members Intent | ✅ zapnutý |
| Redirect URI | ✅ localhost + `ailab-web.com` + `ailabweb.net` (aj `www`) |
| Terms of Service URL | ✅ `https://ailab-web.com/terms` |
| Privacy Policy URL | ✅ `https://ailab-web.com/privacy` |
| Verifikácia aplikácie | 5 zo 6 kritérií splnených — chýba len „musí patřit týmu" |
| Bot permissions | View Channels, Send Messages, Embed Links, Attach Files, Read History, Add Reactions, Slash Commands, Manage Roles, Create Invite — **žiadny Administrator** |

## Čo musíš spraviť ty (3 veci, ~5 minút)

Toto sú tajné údaje — nemôžem ich kopírovať za teba.

**1. Bot token**
Developer Portal → **Bot** → `Resetovat token` → skopíruj → vlož do `.env` ako
`DISCORD_BOT_TOKEN`. Zobrazí sa iba raz.

**2. Client secret**
Developer Portal → **OAuth2** → `Resetovat tajný klíč` → skopíruj → `DISCORD_CLIENT_SECRET`.

**3. Produkčný Redirect URI**
Developer Portal → **OAuth2** → **Přesměrování** → `Přidat další` → zadaj
`https://TVOJADOMENA/api/discord/callback` → `Uložit změny`.
Potom v produkčnom `.env` nastav `DISCORD_REDIRECT_URI` na presne ten istý string.
Musí sedieť **znak po znaku**, inak Discord vráti `invalid_redirect_uri`.

Ešte dva vygenerované secrety:

```bash
openssl rand -hex 32   # -> DISCORD_STATE_SECRET
openssl rand -hex 32   # -> CRON_SECRET
```

**4. Firemné údaje do `lib/site.ts`**
V objekte `LEGAL` sú `[DOPLŇ: ...]` placeholdery — obchodné meno, adresa, IČO,
kontaktný e-mail. Toto nie je kozmetika: podľa GDPR čl. 13 musí byť správca
osobných údajov jednoznačne identifikovateľný, inak sú Zásady neúčinné. Bez
toho ti Discord verifikáciu tiež zamietne, lebo odkazy vedú na nevyplnený
dokument.

Doplň aj `SITE.discordInvite` — trvalý invite link na server.

## Právne stránky — prečítaj si to

`/terms` a `/privacy` sú **pripravené návrhy, nie právne poradenstvo.** Nie som
právnik. Predávaš digitálne predplatné spotrebiteľom v EÚ, čo znamená GDPR aj
zákon o ochrane spotrebiteľa pri predaji na diaľku — konkrétne 14-dňové právo
na odstúpenie a povinnosť vyžiadať si výslovný súhlas so začatím plnenia pred
uplynutím tejto lehoty (článok 5 v Podmienkach). To sa musí odzrkadliť aj
v samotnom checkoute, nie len v texte.

Nechaj to prejsť právnikovi. Do vtedy je na oboch stránkach viditeľné
upozornenie (`components/LegalNotice.tsx`) — zmaž ho až po kontrole.

## Inštalácia

```bash
npm i pg stripe
npm i -D @types/pg tsx

cp .env.example .env       # a doplň hodnoty z krokov vyššie
psql "$DATABASE_URL" -f db/schema.sql
```

Skopíruj `lib/`, `app/api/`, `components/`, `db/`, `scripts/` do root svojho
Next.js projektu (App Router). Importy používajú alias `@/` — v `tsconfig.json`
musíš mať `"paths": { "@/*": ["./*"] }` (`create-next-app` to nastavuje sám).

Celý kód prešiel `tsc --strict` bez chyby.

Over, že Discord strana funguje, **predtým** než začneš debugovať appku:

```bash
npx tsx --env-file=.env scripts/verify-setup.ts
```

Skript ti povie presne čo chýba (token, permissions, hierarchia, intent).
S tvojím Discord ID spraví aj živý test priradenia a hneď rolu vráti do
pôvodného stavu:

```bash
npx tsx --env-file=.env scripts/verify-setup.ts 123456789012345678
```

## Štruktúra

```
lib/discord.ts     Discord REST klient (OAuth2 + role). Server-only.
lib/state.ts       HMAC-podpísaný OAuth state — CSRF ochrana.
lib/db.ts          Postgres + syncDiscordRole() — jediná funkcia čo rozhoduje o role.
lib/auth.ts        ADAPTÉR — sem vlož svoj session lookup.
lib/site.ts        názov, doména, LEGAL údaje, zoznam sprostredkovateľov.

app/layout.tsx     root layout, Nav + Footer, metadata
app/page.tsx       landing page
app/pricing/       predplatné + FAQ
app/account/       prepojenie Discordu
app/terms/         Podmienky používania       ← Discord verifikácia
app/privacy/       Zásady ochrany os. údajov  ← Discord verifikácia

app/api/discord/link/route.ts       krok 1: redirect na Discord
app/api/discord/callback/route.ts   krok 2: uloženie linku + priradenie roly
app/api/discord/unlink/route.ts     odpojenie + odobranie roly
app/api/stripe/webhook/route.ts     okamžitý grant/revoke pri platbe
app/api/cron/sync-roles/route.ts    hodinová reconciliácia

components/Nav.tsx                  horná navigácia
components/Footer.tsx               footer — TU sú Discord odkazy
components/DiscordLinkCard.tsx      UI do /account
components/UnlinkButton.tsx
components/LegalNotice.tsx          upozornenie „návrh" — zmaž po právnej kontrole
scripts/verify-setup.ts             diagnostika Discord nastavení
db/schema.sql                       tabuľky
```

## Footer — čo tam je a prečo

Discord pri verifikácii aplikácie kontroluje, že web má verejne dostupné
Podmienky používania a Zásady ochrany osobných údajov. Preto sú v
`components/Footer.tsx` v sekcii **Právne & Discord**:

- `/terms` — Podmienky používania
- `/privacy` — Zásady ochrany osobných údajov
- `/privacy#cookies` — Cookies
- inštalačný odkaz bota (tretia vec, ktorú Discord kontroluje)
- odkaz na Discord server

Tie isté dve URL sú už zapísané v Developer Portal → General Information.
**Ak zmeníš cestu v kóde, musíš ju zmeniť aj tam**, inak verifikácia spadne.

V footeri je aj identifikácia správcu údajov (obchodné meno, adresa, IČO,
kontakt) — to je povinné podľa GDPR, nie ozdoba.

## Ostávajúce TODO v kóde

Sú označené komentárom `TODO`, takže ich nájdeš cez `grep -rn TODO`:

| Kde | Čo |
|---|---|
| `lib/site.ts` | `LEGAL` — firemné údaje, `SITE.discordInvite` |
| `app/pricing/page.tsx` | reálna cena + naviazanie na Stripe Checkout |
| `lib/auth.ts` | `getCurrentUserId()` — tvoj session lookup |

## Zapojenie do appky

`lib/auth.ts` — nahraď telo `getCurrentUserId()`. Sú tam pripravené príklady pre
NextAuth, Supabase a Clerk. **Toto je jediná povinná úprava kódu.** Ak táto
funkcia vráti nesprávneho užívateľa, prepojí sa nesprávny Discord účet.

`app/account/page.tsx`:

```tsx
import { DiscordLinkCard } from '@/components/DiscordLinkCard';

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ discord?: string; reason?: string }>;
}) {
  return <DiscordLinkCard searchParams={await searchParams} />;
}
```

Stripe Checkout — pridaj website user id do metadata, inak webhook nevie komu
rolu priradiť:

```ts
await stripe.checkout.sessions.create({
  // ...
  metadata: { user_id: String(user.id) },
  subscription_data: { metadata: { user_id: String(user.id) } },
});
```

Cron (`vercel.json`):

```json
{ "crons": [{ "path": "/api/cron/sync-roles", "schedule": "0 * * * *" }] }
```

## Ako to funguje

```
Užívateľ na webe (prihlásený)
  │  klik "Prepojiť Discord"
  ▼
GET /api/discord/link
  │  vytvorí HMAC state, uloží do httpOnly cookie
  ▼
discord.com/oauth2/authorize   scope: identify + guilds.join
  │  užívateľ potvrdí
  ▼
GET /api/discord/callback
  ├─ overí state proti cookie (CSRF)
  ├─ overí že session patrí tomu istému užívateľovi
  ├─ code → access_token
  ├─ GET /users/@me → discord_id
  ├─ uloží do discord_links (UNIQUE na discord_id)
  └─ syncDiscordRole()
       ├─ nie je na serveri? → PUT /guilds/../members/..  (guilds.join)
       ├─ platí?   → PUT    role Předplatné
       └─ neplatí? → DELETE role Předplatné

Neskôr:
  Stripe webhook  → syncDiscordRole()   (okamžite)
  Hodinový cron   → syncDiscordRole()   (dohnať zmeškané / expirované)
```

`syncDiscordRole()` je idempotentná — môže bežať z callbacku, webhooku aj cronu
súčasne bez konfliktu.

## Prečo tieto rozhodnutia

**`guilds.join` scope.** Bez neho by užívateľ musel najprv sám vstúpiť na server
a až potom by dostal rolu — to je zbytočný krok, na ktorom ľudia odpadávajú.
S ním ho pridáme rovno pri prepojení.

**UNIQUE na `discord_id`.** Bez toho by dvaja platiaci mohli zdieľať jeden
Discord účet, alebo by si niekto prepojil cudzí. Callback vracia
`already_linked` namiesto tichého prepísania.

**HMAC state + kontrola session v callbacku.** Bez `state` sa dá útokom prinútiť
prihláseného užívateľa prepojiť útočníkov Discord účet. Kontrolujeme aj to, že
session stále patrí tomu, kto flow začal.

**Cron aj keď máme webhooky.** Predplatné vyprší tichým uplynutím
`current_period_end` — o tom neprichádza žiadny event včas. Bez cronu by
neplatiaci držali rolu ďalej.

**Rola sa berie z `Bots`, nie z bot roly.** Bot má dve roly. Discord kontroluje
hierarchiu podľa **najvyššej** roly člena (`Bots`, pozícia 4) a permissions
sčítava zo **všetkých**. Preto stačilo dať Manage Roles na spodnú `AI LAB WEB`
rolu a nemusel som hýbať hierarchiou — menej invazívne.

## Bezpečnosť

- `DISCORD_BOT_TOKEN` a `DISCORD_CLIENT_SECRET` nikdy nesmú ísť do prehliadača.
  Preto je všetko v `/api` route handleroch a `lib/discord.ts` je server-only.
- `.env` pridaj do `.gitignore`. Ak token niekedy unikol, resetuj ho.
- Bot má vedome **minimum permissions** — žiadny Administrator, žiadny Kick/Ban.
  Iba View Channels, Send Messages, Embed Links, Attach Files, Read History,
  Add Reactions, Slash Commands + Manage Roles.
- `/api/cron/sync-roles` je za `CRON_SECRET`. Bez neho by ktokoľvek mohol
  spustiť masový sync.
- OAuth access tokeny v DB — ak chceš, zašifruj `access_token`/`refresh_token`
  at rest. Používame ich len na `guilds.join`.

## Riešenie problémov

| Symptóm | Príčina |
|---|---|
| `invalid_redirect_uri` | `DISCORD_REDIRECT_URI` nesedí presne s Developer Portal. Pozor na `http` vs `https`, port, lomítko na konci. |
| `403 Missing Permissions` pri role | Bot nemá Manage Roles, alebo je jeho najvyššia rola pod `Předplatné`. Spusti `verify-setup.ts`. |
| `50013` pri `addGuildMember` | Botovi chýba *Create Instant Invite* (už je zapnuté, ale ak by niekto rolu upravil). |
| Rola sa priradí, ale zmizne | Beží aj iný bot (Dyno / Security) čo spravuje roly, alebo cron vidí predplatné ako neaktívne. Skontroluj `discord_role_events` a `v_active_subscribers`. |
| Callback → `session_mismatch` | `getCurrentUserId()` v `lib/auth.ts` nie je zapojený na reálnu session. |
| Nič sa nedeje po platbe | Stripe Checkout nemá `metadata.user_id`, alebo webhook secret nesedí. |

Debug jedného užívateľa:

```sql
SELECT * FROM discord_role_events
WHERE discord_id = '123456789012345678'
ORDER BY created_at DESC LIMIT 20;
```
