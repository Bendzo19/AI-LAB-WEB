import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE, LEGAL, PROCESSORS } from '@/lib/site';
import { LegalNotice } from '@/components/LegalNotice';

export const metadata: Metadata = {
  title: 'Zásady ochrany osobných údajov',
  description: `Ako ${SITE.name} spracúva osobné údaje, vrátane údajov z prepojenia Discordu.`,
};

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
        Zásady ochrany osobných údajov
      </h1>
      <p className="mt-3 text-sm text-white/40">
        Účinné od {LEGAL.lastUpdated}
      </p>

      <div className="mt-10">
        <LegalNotice />
      </div>

      <div className="prose-legal">
        <h2>1. Kto je správca</h2>
        <p>
          Správcom osobných údajov je {LEGAL.entity}, {LEGAL.address},
          IČO {LEGAL.ico}.
        </p>
        <p>
          Vo veciach ochrany údajov nás kontaktuj na{' '}
          <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>.
        </p>

        <h2>2. Aké údaje spracúvame</h2>

        <h3>2.1 Údaje pri registrácii</h3>
        <ul>
          <li>e-mailová adresa</li>
          <li>heslo v podobe kryptografického odtlačku (nikdy v čitateľnej forme)</li>
          <li>dátum vytvorenia účtu</li>
        </ul>

        <h3>2.2 Údaje z prepojenia Discordu</h3>
        <p>
          Keď použiješ funkciu prepojenia Discordu, vyžiadame si od Discordu
          rozsahy <code>identify</code> a <code>guilds.join</code>. Od Discordu
          získame a uchovávame:
        </p>
        <ul>
          <li><strong>Discord ID</strong> — číselný identifikátor tvojho účtu</li>
          <li><strong>používateľské meno a zobrazované meno</strong></li>
          <li><strong>identifikátor profilového obrázka</strong></li>
          <li>
            <strong>prístupový a obnovovací token</strong> — potrebné na to, aby sme
            ťa mohli pridať na náš server
          </li>
        </ul>
        <p>
          <strong>Nezískavame</strong> tvoj e-mail z Discordu, obsah tvojich správ,
          zoznam serverov, na ktorých si, ani zoznam tvojich priateľov.
        </p>
        <p>
          Rozsah <code>guilds.join</code> nám umožňuje pridať ťa na server
          AI LAB. Nedáva nám možnosť pridať ťa kamkoľvek inam ani robiť
          čokoľvek s inými servermi.
        </p>

        <h3>2.3 Údaje o predplatnom</h3>
        <ul>
          <li>stav predplatného, dátum konca obdobia, identifikátory od Stripe</li>
          <li>
            <strong>údaje o platobnej karte nespracúvame ani nevidíme</strong> —
            spracúva ich výhradne Stripe
          </li>
        </ul>

        <h3>2.4 Technické záznamy</h3>
        <ul>
          <li>záznamy o priradení a odobraní roly (kedy, komu, s akým výsledkom)</li>
          <li>bezpečnostné a chybové logy servera</li>
        </ul>

        <h2>3. Na aký účel a na akom právnom základe</h2>
        <table className="my-5 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-white/12">
              <th className="py-2 pr-4 text-left font-semibold text-white/70">Účel</th>
              <th className="py-2 pr-4 text-left font-semibold text-white/70">Údaje</th>
              <th className="py-2 text-left font-semibold text-white/70">Právny základ</th>
            </tr>
          </thead>
          <tbody className="text-white/55">
            <Row
              purpose="Vedenie účtu a prihlásenie"
              data="e-mail, odtlačok hesla"
              basis="plnenie zmluvy (čl. 6/1/b GDPR)"
            />
            <Row
              purpose="Prepojenie Discordu a priradenie roly Předplatné"
              data="Discord ID, meno, avatar, OAuth tokeny"
              basis="plnenie zmluvy (čl. 6/1/b)"
            />
            <Row
              purpose="Spracovanie platieb a fakturácia"
              data="identifikátory Stripe, stav predplatného"
              basis="plnenie zmluvy + zákonná povinnosť (čl. 6/1/b, c)"
            />
            <Row
              purpose="Uchovanie účtovných dokladov"
              data="fakturačné údaje"
              basis="zákonná povinnosť (čl. 6/1/c)"
            />
            <Row
              purpose="Bezpečnosť, prevencia zneužitia a zdieľania účtov"
              data="logy, záznamy o roliach"
              basis="oprávnený záujem (čl. 6/1/f)"
            />
          </tbody>
        </table>

        <h2>4. Komu údaje poskytujeme</h2>
        <p>
          Údaje nepredávame. Poskytujeme ich len nasledujúcim sprostredkovateľom
          v rozsahu potrebnom na chod Služby:
        </p>
        <table className="my-5 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-white/12">
              <th className="py-2 pr-4 text-left font-semibold text-white/70">Poskytovateľ</th>
              <th className="py-2 pr-4 text-left font-semibold text-white/70">Účel</th>
              <th className="py-2 text-left font-semibold text-white/70">Umiestnenie</th>
            </tr>
          </thead>
          <tbody className="text-white/55">
            {PROCESSORS.map((p) => (
              <tr key={p.name} className="border-b border-white/6">
                <td className="py-2.5 pr-4">
                  <a href={p.dpa} target="_blank" rel="noopener noreferrer">
                    {p.name}
                  </a>
                </td>
                <td className="py-2.5 pr-4">{p.purpose}</td>
                <td className="py-2.5">{p.country}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          Pri poskytovateľoch so sídlom v USA sa prenos opiera o štandardné zmluvné
          klauzuly Európskej komisie, prípadne o rámec EU–US Data Privacy Framework,
          ak je daný poskytovateľ certifikovaný.
        </p>

        <h2>5. Ako dlho údaje uchovávame</h2>
        <ul>
          <li>
            <strong>údaje účtu</strong> — po dobu existencie účtu a 30 dní po jeho zrušení
          </li>
          <li>
            <strong>prepojenie Discordu</strong> — do odpojenia Discordu alebo zrušenia
            účtu; po odpojení tokeny bezodkladne zneplatníme
          </li>
          <li>
            <strong>účtovné doklady</strong> — 10 rokov, ako vyžaduje zákon o účtovníctve
          </li>
          <li>
            <strong>záznamy o roliach a bezpečnostné logy</strong> — 12 mesiacov
          </li>
        </ul>

        <h2>6. Tvoje práva</h2>
        <p>Podľa GDPR máš právo:</p>
        <ul>
          <li>na prístup k údajom a na kópiu (čl. 15)</li>
          <li>na opravu nesprávnych údajov (čl. 16)</li>
          <li>na výmaz (čl. 17)</li>
          <li>na obmedzenie spracúvania (čl. 18)</li>
          <li>na prenosnosť údajov (čl. 20)</li>
          <li>vzniesť námietku proti spracúvaniu na základe oprávneného záujmu (čl. 21)</li>
        </ul>
        <p>
          Žiadosť pošli na <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>.
          Odpovieme najneskôr do jedného mesiaca.
        </p>
        <p>
          Discord môžeš odpojiť aj sám, kedykoľvek, v sekcii{' '}
          <Link href="/account">Môj účet</Link>. Odpojením prepojenie a tokeny
          zmažeme — ber však na vedomie, že tým prídeš o rolu Předplatné, aj keď
          máš predplatné aktívne.
        </p>
        <p>
          Ak si myslíš, že spracúvame údaje v rozpore s právom, môžeš podať sťažnosť
          na <strong>Úrad na ochranu osobných údajov Slovenskej republiky</strong>,
          Hraničná 12, 820 07 Bratislava.
        </p>

        <h2 id="cookies">7. Cookies</h2>
        <p>
          Používame len technicky nevyhnutné cookies, na ktoré sa podľa zákona
          nevyžaduje súhlas:
        </p>
        <ul>
          <li>
            <strong>prihlasovacia session</strong> — aby si zostal prihlásený
          </li>
          <li>
            <strong><code>discord_oauth_state</code></strong> — krátkodobá cookie
            (10 minút) chrániaca prepojenie Discordu pred útokom typu CSRF
          </li>
        </ul>
        <p>
          Nepoužívame reklamné ani sledovacie cookies a nespúšťame analytiku
          tretích strán, ktorá by ťa profilovala napriek weboch.
        </p>

        <h2>8. Automatizované rozhodovanie</h2>
        <p>
          Priradenie a odobranie roly <strong>Předplatné</strong> na Discorde
          prebieha automaticky podľa toho, či máš aktívne predplatné. Ide o
          nevyhnutný technický krok plnenia zmluvy, nie o profilovanie ani o
          rozhodnutie s právnym dopadom podľa čl. 22 GDPR. Ak sa domnievaš, že
          rola bola priradená alebo odobraná nesprávne, ozvi sa nám a preveríme to
          manuálne.
        </p>

        <h2>9. Deti</h2>
        <p>
          Služba je určená výlučne osobám od 18 rokov. Údaje osôb mladších ako
          18 rokov zámerne nespracúvame. Ak zistíme, že účet patrí osobe mladšej
          ako 18 rokov, zrušíme ho a údaje zmažeme.
        </p>

        <h2>10. Zmeny týchto zásad</h2>
        <p>
          Zásady môžeme aktualizovať. O podstatnej zmene ťa upozorníme e-mailom
          alebo v Službe. Dátum poslednej revízie je uvedený v hlavičke.
        </p>
      </div>

      <nav className="mt-16 border-t border-white/8 pt-7 text-sm">
        <Link href="/terms" className="text-brand-400 hover:underline">
          ← Podmienky používania
        </Link>
      </nav>
    </article>
  );
}

function Row({
  purpose,
  data,
  basis,
}: {
  purpose: string;
  data: string;
  basis: string;
}) {
  return (
    <tr className="border-b border-white/6">
      <td className="py-2.5 pr-4">{purpose}</td>
      <td className="py-2.5 pr-4">{data}</td>
      <td className="py-2.5">{basis}</td>
    </tr>
  );
}
