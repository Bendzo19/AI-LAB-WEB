# Nasadenie Notebook Studio

## 1. Relay (server)

Relay smeruje šifrované správy a nevidí ich obsah. Môže bežať kdekoľvek, kam sa
notebook aj mobil dostanú cez internet: malý VPS, Fly.io, Render, alebo doma za
reverznou proxy s HTTPS.

```bash
NS_DATA_FILE=/var/lib/notebook-studio/relay.json \
NS_ALLOWED_ORIGINS=https://app.tvojadomena.sk \
NS_TRUST_PROXY=1 \
npm start -w @ns/relay        # počúva na PORT (predvolene 8787)
```

Nasaď za HTTPS/WSS (napr. Caddy alebo Nginx), aby mobilná PWA mohla pripájať
`wss://`. Verejná adresa nech je napr. `wss://relay.tvojadomena.sk`.

Premenné relay:

| Premenná | Význam |
|---|---|
| `PORT` | port (predvolene 8787) |
| `NS_DATA_FILE` | súbor so spárovanými zariadeniami. **Nastav ho** — bez neho reštart relay zabudne párovania a musíš párovať znova. Zapisuje sa atomicky, drží len hashe tokenov a verejné kľúče. |
| `NS_ALLOWED_ORIGINS` | povolené originy mobilnej PWA, oddelené čiarkou (napr. `https://app.tvojadomena.sk`). Predvolene `*`; pre produkciu obmedz. |
| `NS_TRUST_PROXY=1` | čítať IP klienta z `X-Forwarded-For`. Zapni **len** keď relay beží za vlastnou reverznou proxy, inak sa dá IP podvrhnúť. |

## 2. Agent na notebooku (Windows 11)

```bash
npm run dev -w @ns/agent-windows
```

Pri prvom spustení sa vytvoria kľúče a vypíše sa párovací kód. Konfigurácia je v
`%APPDATA%\NotebookStudio\config.json`:

```jsonc
{
  "relayUrl": "wss://relay.tvojadomena.sk",
  "name": "Môj LOQ",
  "devMode": false,                    // terminál a súbory; zapni len ak ich chceš
  "apps": {                            // aplikácie, ktoré smie agent spúšťať
    "Steam": "C:/Program Files (x86)/Steam/steam.exe",
    "Chrome": "C:/Program Files/Google/Chrome/Application/chrome.exe"
  },
  "anthropicApiKey": "sk-ant-...",     // pre AI agenta; ostáva na notebooku
  "anthropicBaseUrl": null
}
```

Agenta odporúčam spúšťať po prihlásení (Naplánované úlohy → pri prihlásení), aby
bežal v tvojej relácii a videl obrazovku. Ako služba v relácii 0 by obrazovku
ani vstup neovládal.

### Zvýšené oprávnenia

Časť príkazov (reštart do BIOS-u, zapnutie Wake-on-LAN) potrebuje admin práva.
Bez nich agent vráti `requires_admin` a nič nespraví. Ak ich chceš, spúšťaj
agenta „ako správca“.

### Lenovo funkcie

Režimy výkonu, šetrenie batérie a podsvietenie klávesnice idú cez Lenovo WMI.
Agent pri štarte zistí, či je dostupné (`lenovo=true/false`). Ak nie, tieto
príkazy vrátia `not_supported` — nič sa nepokazí.

## 3. Mobil (PWA)

Mobilná aplikácia je webová (PWA), pridáš si ju na plochu. Pri prvom spustení:

1. Zadaj **párovací kód** z notebooku.
2. Na notebooku sa objaví **overovací kód (SAS)** — 6 číslic. Skontroluj, že sa
   zhoduje s číslom v mobile, a potvrď na notebooku.
3. Hotovo, mobil je spárovaný a šifrovane spojený.

## 4. Zobúdzač (Wake-on-LAN) — voliteľné

Vypnutý notebook sa na internet nepripojí, preto ho musí zobudiť niečo v tvojej
domácej sieti: Raspberry Pi, NAS, starý počítač.

```bash
# na notebooku najprv zaregistruj hub (vráti hub token)
#   POST /v1/hub/register  s tokenom notebooku
NS_RELAY=wss://relay.tvojadomena.sk \
NS_DEVICE=<deviceId> \
NS_HUB_TOKEN=<hubToken> \
NS_MAC=8c-16-45-aa-bb-cc \
npm start -w @ns/hub
```

V **BIOS-e** a vo vlastnostiach sieťovej karty zapni Wake-on-LAN a vypni rýchle
spustenie Windows (`powercfg /hibernate off` + HiberbootEnabled = 0). Príkaz
`network.wol_enable` to spraví za teba (potrebuje admin). Zapnutie z úplného
vypnutia však závisí od podpory v BIOS-e; zo spánku a hibernácie je spoľahlivejšie.

## 5. Trénovanie a rozširovanie

- Nový príkaz: pridaj do `packages/protocol/src/commands.ts` (názov, riziko,
  oprávnenia, argumenty) a doplň jeho vykonanie v `apps/agent-windows` (Windows
  aj simulácia). Automaticky sa objaví ako nástroj agenta aj v katalógu pre mobil.
- Nová schopnosť agenta: pridaj testovací prípad do `packages/brain/src/eval/cases.ts`
  a over `npm run eval -w @ns/brain`.
