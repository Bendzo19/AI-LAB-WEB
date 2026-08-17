import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE, LEGAL } from '@/lib/site';
import { LegalNotice } from '@/components/LegalNotice';

export const metadata: Metadata = {
  title: 'Podmienky používania',
  description: `Podmienky používania služby ${SITE.name}.`,
};

export default function TermsPage() {
  return (
    <article className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
        Podmienky používania
      </h1>
      <p className="mt-3 text-sm text-white/40">
        Účinné od {LEGAL.lastUpdated}
      </p>

      <div className="mt-10">
        <LegalNotice />
      </div>

      <div className="prose-legal">
        <h2>1. Kto službu poskytuje</h2>
        <p>
          Službu {SITE.name} dostupnú na adrese {SITE.domain} (ďalej „<strong>Služba</strong>“)
          poskytuje {LEGAL.entity}, so sídlom {LEGAL.address}, IČO {LEGAL.ico},
          {' '}{LEGAL.register} (ďalej „<strong>Poskytovateľ</strong>“, „my“).
        </p>
        <p>
          Kontakt: <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>
        </p>

        <h2>2. Čo Služba je</h2>
        <p>
          Služba je platené členstvo poskytujúce prístup k digitálnemu vzdelávaciemu
          obsahu v oblasti generatívnej AI — postupy, ComfyUI workflow súbory,
          prompt knižnice a súvisiace materiály — a prístup do súkromných kanálov
          na komunitnom serveri na platforme Discord.
        </p>
        <p>
          Služba je <strong>informačný a vzdelávací produkt</strong>. Nezaručujeme
          žiadny konkrétny výsledok, príjem ani dosah na sociálnych sieťach.
          Akékoľvek príklady výsledkov iných členov sú ilustratívne a nie sú
          prísľubom, že rovnaký výsledok dosiahneš aj ty.
        </p>

        <h2>3. Kto môže Službu používať</h2>
        <ul>
          <li>
            Používaním Služby potvrdzuješ, že máš <strong>najmenej 18 rokov</strong> a
            plnú spôsobilosť na právne úkony. Služba nie je určená osobám mladším ako 18 rokov.
          </li>
          <li>
            Za aktivitu na svojom účte zodpovedáš ty. Prihlasovacie údaje neposkytuj
            tretím osobám.
          </li>
          <li>
            Jeden účet je určený pre jednu osobu. Zdieľanie účtu je porušením
            týchto podmienok.
          </li>
        </ul>

        <h2>4. Predplatné, platby a obnovovanie</h2>
        <ul>
          <li>
            Predplatné je opakované. Platba sa automaticky obnovuje na konci každého
            zúčtovacieho obdobia, kým ho nezrušíš.
          </li>
          <li>
            Platby spracúva <strong>Stripe Payments Europe, Ltd.</strong> Údaje o platobnej
            karte nezískavame ani neuchovávame.
          </li>
          <li>
            Predplatné môžeš zrušiť kedykoľvek. Zrušenie je účinné ku koncu už
            zaplateného obdobia — do vtedy ti prístup zostáva. Zaplatené obdobie sa
            pri zrušení nevracia pomerne, ak zákon neurčuje inak.
          </li>
          <li>
            Ceny môžeme zmeniť. Zmenu ti oznámime najmenej 30 dní vopred na e-mail.
            Ak so novou cenou nesúhlasíš, môžeš predplatné zrušiť pred jej účinnosťou.
          </li>
          <li>
            Ak platba neprejde, prístup a rola na Discorde môžu byť pozastavené až
            do úspešnej úhrady.
          </li>
        </ul>

        <h2>5. Právo na odstúpenie od zmluvy</h2>
        <p>
          Ako spotrebiteľ máš zo zákona právo odstúpiť od zmluvy uzavretej na diaľku
          do <strong>14 dní</strong> bez uvedenia dôvodu.
        </p>
        <p>
          Keďže ide o digitálny obsah dodávaný okamžite, pri objednávke sa od teba
          vyžaduje <strong>výslovný súhlas so začatím poskytovania pred uplynutím
          lehoty na odstúpenie</strong> a potvrdenie, že si vedomý, že tým právo na
          odstúpenie <strong>stráca</strong>. Bez tohto súhlasu ti 14-dňové právo na
          odstúpenie zostáva v plnom rozsahu.
        </p>
        <p>
          Odstúpenie posielaj na <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>.
        </p>

        <h2>6. Licencia na obsah a čo s ním nesmieš</h2>
        <p>
          Po dobu trvania predplatného ti udeľujeme nevýhradnú, neprenosnú licenciu
          používať poskytnutý obsah <strong>na vlastné účely, vrátane komerčných</strong> —
          teda výstupy, ktoré s pomocou workflow vytvoríš, sú tvoje.
        </p>
        <p>Naopak nesmieš:</p>
        <ul>
          <li>
            ďalej šíriť, predávať, zdieľať ani zverejňovať samotné materiály,
            workflow súbory, prompty a texty, ktoré sú súčasťou Služby;
          </li>
          <li>
            vytvárať z obsahu Služby konkurenčný kurz, členstvo alebo knowledge base;
          </li>
          <li>
            sprístupniť obsah osobám bez aktívneho predplatného, vrátane zverejnenia
            záznamov, screenshotov celých materiálov alebo exportov.
          </li>
        </ul>
        <p>
          Pri porušení môžeme prístup okamžite ukončiť bez náhrady a domáhať sa
          náhrady škody.
        </p>

        <h2>7. Pravidlá komunity na Discorde</h2>
        <p>
          Prístup do súkromných kanálov je súčasťou Služby. Popri týchto podmienkach
          sa na tebe vzťahujú aj{' '}
          <a href="https://discord.com/terms" target="_blank" rel="noopener noreferrer">
            Podmienky používania Discordu
          </a>{' '}
          a{' '}
          <a href="https://discord.com/guidelines" target="_blank" rel="noopener noreferrer">
            Pravidlá komunity Discordu
          </a>
          . Zakázané je najmä obťažovanie, nenávistné prejavy, spam, zdieľanie
          nelegálneho obsahu a akýkoľvek obsah zobrazujúci alebo sexualizujúci
          osoby mladšie ako 18 rokov.
        </p>
        <p>
          Za porušenie môžeme rolu odobrať alebo účet vylúčiť zo servera, a to aj
          bez vrátenia platby.
        </p>

        <h2>8. Zodpovednosť za obsah, ktorý vytvoríš</h2>
        <p>
          Za obsah, ktorý pomocou postupov zo Služby vytvoríš a zverejníš,
          zodpovedáš výhradne ty. Zaväzuješ sa najmä:
        </p>
        <ul>
          <li>
            nevytvárať obsah zobrazujúci reálne osoby bez ich súhlasu, vrátane
            deepfake podobizní;
          </li>
          <li>
            zobrazovať výlučne fiktívne osoby javiace sa ako <strong>dospelé</strong>;
          </li>
          <li>
            dodržiavať podmienky platforiem, na ktorých obsah zverejňuješ, vrátane
            povinnosti označiť AI-generovaný obsah, ak to platforma alebo právo
            vyžaduje.
          </li>
        </ul>

        <h2>9. Dostupnosť Služby</h2>
        <p>
          Snažíme sa o nepretržitú dostupnosť, ale negarantujeme ju. Služba závisí
          od tretích strán — najmä Discordu, platobného a hostingového poskytovateľa —
          a ich výpadok môže obmedziť aj našu Službu. Krátkodobé prerušenia
          nezakladajú právo na náhradu.
        </p>

        <h2>10. Ukončenie</h2>
        <p>
          Predplatné môžeš zrušiť kedykoľvek. My môžeme zmluvu ukončiť pri závažnom
          porušení týchto podmienok, pri neuhradení platby alebo pri konaní, ktoré
          ohrozuje ostatných členov. Pri ukončení stráca účinnosť licencia podľa
          článku 6 a rola na Discorde sa odoberie.
        </p>

        <h2>11. Obmedzenie zodpovednosti</h2>
        <p>
          V rozsahu, ktorý pripúšťa právo, nezodpovedáme za nepriamu škodu, stratu
          zisku, stratu dát ani za škodu vzniknutú z rozhodnutí, ktoré si urobil na
          základe obsahu Služby. Naša celková zodpovednosť je obmedzená sumou, ktorú
          si nám zaplatil za posledných 12 mesiacov.
        </p>
        <p>
          Tým nie je dotknutá zodpovednosť za škodu spôsobenú úmyselne, hrubou
          nedbanlivosťou, ani zákonné práva spotrebiteľa, ktoré nemožno vylúčiť.
        </p>

        <h2>12. Zmeny podmienok</h2>
        <p>
          Podmienky môžeme meniť. O podstatnej zmene ťa upozorníme e-mailom alebo
          v Službe najmenej 30 dní pred účinnosťou. Ďalším používaním Služby po
          účinnosti zmeny vyjadruješ súhlas s novou verziou.
        </p>

        <h2>13. Rozhodné právo a riešenie sporov</h2>
        <p>
          Zmluvný vzťah sa riadi právom Slovenskej republiky. Ako spotrebiteľ máš
          právo obrátiť sa na Poskytovateľa so žiadosťou o nápravu a následne na
          subjekt alternatívneho riešenia sporov — na Slovensku najmä Slovenskú
          obchodnú inšpekciu. Máš tiež právo obrátiť sa na súd.
        </p>

        <h2>14. Osobné údaje</h2>
        <p>
          Ako spracúvame osobné údaje vrátane údajov z prepojenia Discordu
          vysvetľujú <Link href="/privacy">Zásady ochrany osobných údajov</Link>.
        </p>
      </div>

      <nav className="mt-16 border-t border-white/8 pt-7 text-sm">
        <Link href="/privacy" className="text-brand-400 hover:underline">
          Zásady ochrany osobných údajov →
        </Link>
      </nav>
    </article>
  );
}
