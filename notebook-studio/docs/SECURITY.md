# Bezpečnosť Notebook Studio

Aplikácia dáva mobilu kontrolu nad notebookom. Preto je bezpečnosť postavená tak,
aby ani prevádzkovateľ relay, ani nikto na sieti nevidel obsah a nemohol posielať
príkazy za teba.

## Šifrovanie medzi zariadeniami (end-to-end)

- Notebook aj mobil majú pár kľúčov **ECDH P-256**. Súkromný kľúč zariadenie
  nikdy neposiela.
- Spoločný kľúč vznikne z ECDH a **HKDF-SHA-256**, šifruje sa **AES-256-GCM**.
- Každá správa má v AAD zapísaný smer (`phone>laptop` / `laptop>phone`) aj
  identitu telefónu, takže relay nemôže správu presmerovať, zopakovať v opačnom
  smere ani podstrčiť inému telefónu.
- Relay vidí iba smerovanie (`komu`), nie obsah. Je to len poštár.

## Párovanie

1. Notebook ukáže jednorazový **8-znakový kód** (bez zameniteľných znakov).
2. Mobil kód zadá a pošle svoj verejný kľúč.
3. Obe strany vypočítajú **overovací kód (SAS)** — 8 číslic z hashu oboch
   verejných kľúčov. Používateľ potvrdí na notebooku, že sa číslo zhoduje s
   mobilom. Zhodné číslo znamená, že obe strany pracujú s rovnakou dvojicou
   kľúčov.
4. Až po potvrdení na notebooku relay pustí šifrované správy od telefónu.

**Hranica záruky SAS.** Overovací kód spoľahlivo odhalí zámenu kľúčov *pasívnym*
relayom aj náhodné prehodenie kľúčov medzi paralelnými párovaniami. Nechráni však
úplne pred *aktívne zlomyseľným* relayom: ten je koncovým bodom oboch výmen kľúčov
a pri krátkom SAS bez „záväzku“ (commitment) by vedel generovať náhradné kľúče, kým
sa čísla na oboch obrazovkách nezhodnú. Preto v súčasnej verzii platí predpoklad,
že **relay je pod tvojou kontrolou** (self-hosted). Úplné riešenie (commit-reveal na
efemérnych kľúčoch alebo PAKE nad párovacím kódom) je plánované spevnenie pred tým,
než by relay bežal ako verejná služba mimo tvojej kontroly.

## Tokeny a odvolanie

- Relay ukladá iba **SHA-256** tokenov, nie samotné tokeny.
- Telefón sa pripojí až po schválení; odvolanie telefónu (`revoked`) okamžite
  zruší jeho token aj spojenie.

## Potvrdzovanie akcií

- Každý príkaz má v katalógu úroveň rizika. `confirm`/`danger` (vypnutie,
  reštart, mazanie, ukončenie procesu, terminál, reštart do BIOS-u, zmena WoL)
  **vždy** vyžadujú potvrdenie na mobile a majú 60-sekundový časový limit.
- Platí to rovnako pre tlačidlá aj pre AI agenta — agent potvrdenie neobíde.
- Každé vykonanie ide do **auditného záznamu** na notebooku.

## Ochrana proti opakovaniu

- Každá správa má jedinečné `id` a čas `ts`. Príjemca odmietne správu staršiu
  ako 2 minúty alebo s už videným `id`.

## Vývojársky režim

- Terminál a čítanie súborov sú za **vývojárskym režimom**, ktorý je predvolene
  vypnutý a zapína sa **iba lokálne** v konfigurácii notebooku, nie z mobilu.
- Aj v ňom platí potvrdzovanie a audit.

## AI agent

- Beží **na notebooku**; API kľúč Claude je v konfiguračnom súbore notebooku a
  nikdy sa neposiela mobilu ani relay.
- Nástroje agenta sú výhradne príkazy z katalógu s rovnakým potvrdzovaním.
- Výstupy nástrojov, obsah súborov a obrazovky sa agentovi predkladajú ako dáta,
  nie ako pokyny (ochrana proti „prompt injection“).

## Čo systém zámerne nerobí

- Neotvára žiadne porty na domácom routeri. Všetky zariadenia sa pripájajú von.
- Neukladá heslá ani obsah citlivých súborov na relay.
- Nedovoľuje mobilu zapnúť vývojársky režim ani zmeniť bezpečnostné nastavenia.

## Zvyškové riziká

- **Aktívne zlomyseľný relay** by pri súčasnom SAS bez commitmentu vedel odpočúvať
  (viď „Hranica záruky SAS“ vyššie). Mitigácia teraz: prevádzkuj relay sám. Plán:
  doplniť commit-reveal / PAKE pred verejným nasadením relaya.
- Bezpečnosť závisí od toho, že **relay a API kľúč** sú pod tvojou kontrolou a
  že párovací **SAS kód** naozaj porovnáš. Kód potvrď len ak čísla sedia.
- Kto získa fyzický prístup k odomknutému notebooku, získa aj konfiguráciu.
  Preto je súbor uložený s právami len pre používateľa a kľúč je viazaný na účet.
