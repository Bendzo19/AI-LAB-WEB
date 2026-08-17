/**
 * lib/site.ts
 *
 * Jedno miesto pre všetky údaje, ktoré sa opakujú po celom webe.
 * Keď zmeníš doménu alebo firemné údaje, meníš to LEN tu.
 *
 * TODO pred spustením: doplň LEGAL — bez toho nie sú Podmienky
 * ani Zásady platné (GDPR vyžaduje identifikovateľného správcu).
 */

export const SITE = {
  name: 'AI LAB',
  domain: 'ailab-web.com',
  url: process.env.APP_URL ?? 'https://ailab-web.com',
  logo: '/logo-512.png',
  tagline: 'Tvorba AI creatorov, od workflow po prvý príjem.',
  description:
    'AI LAB je komunita a knowledge base pre tvorbu AI creatorov — ComfyUI workflows, ' +
    'identity consistency, image-to-video, a marketing, ktorý to celé zarobí.',

  discordInvite: 'https://discord.gg/', // TODO: vlož svoj trvalý invite link
  instagram: '', // TODO
  tiktok: '', // TODO
} as const;

/**
 * Identifikačné údaje podnikateľa.
 *
 * Zdroj: Register právnických osôb, podnikateľov a orgánov verejnej moci
 * (Štatistický úrad SR), api.statistics.sk/rpo — overené 17. 8. 2026.
 *
 * Podľa GDPR čl. 13 musí byť správca osobných údajov jednoznačne
 * identifikovateľný, inak sú Zásady ochrany osobných údajov neúčinné.
 * Zároveň to vyžaduje zákon o elektronickom obchode pri predaji na diaľku.
 */
export const LEGAL = {
  entity: 'Benjamín Cima-CIMIC',
  address: 'Komenského 2652/2, 069 01 Snina, Slovenská republika',
  ico: '57 245 886',

  /**
   * DIČ zatiaľ nemáme, takže sa v footeri ani na faktúrach nezobrazuje.
   * Keď ho z daňového úradu dostaneš, staci ho vložiť sem — footer aj
   * právne stránky si ho vypíšu samé, nič iné nemeníš.
   *
   * `vatPayer` nechaj false, kým nebudeš registrovaný platiteľ DPH.
   * Keď ním budeš, prepni na true a doplň `icDph`.
   */
  dic: '',
  icDph: '',
  vatPayer: false,

  register:
    'zapísaný v Živnostenskom registri Okresného úradu Humenné, ' +
    'číslo živnostenského registra 720-31772',

  /**
   * TODO — zváž firemný e-mail namiesto osobného gmailu. Doménu máš na
   * Cloudflare, takže Email Routing ti zadarmo presmeruje
   * info@ailab-web.com na tvoj gmail (Cloudflare -> Email -> Email Routing).
   * Na stránke s platbami pôsobí firemná adresa oveľa dôveryhodnejšie.
   */
  email: 'cimicdzobo@gmail.com',

  /** Dátum poslednej revízie právnych dokumentov. */
  lastUpdated: '17. augusta 2026',
} as const;

/** Poskytovatelia, ktorým sa dostávajú osobné údaje. Drž to synchronizované
 *  s realitou — zoznam sprostredkovateľov je povinná časť Zásad. */
export const PROCESSORS = [
  {
    name: 'Discord Inc.',
    purpose: 'prepojenie účtu, správa rolí na serveri',
    country: 'USA',
    dpa: 'https://discord.com/privacy',
  },
  {
    name: 'Stripe Payments Europe, Ltd.',
    purpose: 'spracovanie platieb a predplatného',
    country: 'Írsko / EÚ',
    dpa: 'https://stripe.com/privacy',
  },
  {
    name: 'Netlify, Inc.',
    purpose: 'hosting webu a serverových funkcií',
    country: 'USA',
    dpa: 'https://www.netlify.com/privacy/',
  },
  {
    name: 'Neon Inc.',
    purpose: 'databáza (e-mail, Discord ID, stav predplatného)',
    country: 'EÚ (Frankfurt)',
    dpa: 'https://neon.com/privacy-policy',
  },
] as const;
