# Notebook Studio

Diaľkové ovládanie **vlastného** notebooku (Lenovo LOQ 15IRX9, Windows 11) z
mobilu: stav a senzory, ochrana a čistenie, napájanie, obrazovka, AI agent a
zapnutie cez Wake-on-LAN. Bez otvárania portov, so šifrovaním medzi zariadeniami.

> Stav: **jadro hotové a otestované** (protokol, agent, relay, zobúdzač, AI mozog,
> klient mobilu). Pripája sa na skutočný notebook po spustení agenta na ňom.
> Časti špecifické pre Windows a Lenovo sa overia až na zariadení.

## Štruktúra

```
packages/protocol   spoločný jazyk: katalóg príkazov, správy, šifrovanie, párovanie
packages/brain      AI agent (Claude API + nástroje z katalógu) + testovacia sada
apps/agent-windows  agent na notebooku (backend Windows + simulácia, potvrdenia, audit)
apps/relay          server, ktorý smeruje šifrované správy (obsah nevidí)
apps/hub            zobúdzač v domácej sieti (Wake-on-LAN)
apps/mobile         klient pre mobilnú PWA (párovanie, spojenie, príkazy, chat)
docs/               ARCHITECTURE.md, SECURITY.md, SETUP.md
```

## Rýchly štart (vývoj, všetko simulované)

```bash
cd notebook-studio
npm install
npm test              # 48 testov naprieč balíkmi, vrátane celej reťaze mobil↔relay↔agent

# tri terminály:
npm start -w @ns/relay                          # relay na :8787
NS_RELAY=ws://localhost:8787 npm run sim -w @ns/agent-windows   # agent v simulácii, vypíše párovací kód
```

Agent v simulácii nič na počítači nemení a vracia hodnoverné dáta — je to zároveň
„ukážkový režim“ aplikácie.

## Nasadenie na skutočný notebook

Pozri `docs/SETUP.md`. V skratke:

1. **Relay** nasaď na malý server (alebo doma) a nastav jeho verejnú adresu.
2. Na notebooku spusti **agenta** (`npm run dev -w @ns/agent-windows`), doplň do
   konfigurácie `anthropicApiKey` pre AI a zoznam povolených aplikácií.
3. V mobile zadaj **párovací kód**, potvrď **overovací kód (SAS)** na notebooku.
4. Voliteľne nastav **zobúdzač** na vždy zapnutom zariadení v domácej sieti a v
   BIOS-e/sieťovej karte zapni **Wake-on-LAN**.

## Trénovanie agenta

`packages/brain` má testovaciu sadu reálnych príkazov po slovensky
(`src/eval/cases.ts`). Overuje, či agent volá správne nástroje a rešpektuje
potvrdenia. Spustenie proti skutočnému modelu:

```bash
ANTHROPIC_API_KEY=... npm run eval -w @ns/brain
```

Nové požiadavky, ktoré budeš chcieť, pridávaš ako ďalšie prípady do tej sady a
ako ďalšie príkazy do katalógu (`packages/protocol/src/commands.ts`).

## Bezpečnosť

Šifrovanie medzi zariadeniami, párovanie s overovacím kódom, potvrdzovanie
nebezpečných akcií, audit, vývojársky režim vypnutý. Detail v `docs/SECURITY.md`.
