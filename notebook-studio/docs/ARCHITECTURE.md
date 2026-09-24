# Notebook Studio — architektúra

Diaľkové ovládanie **vlastného** notebooku (Lenovo LOQ 15IRX9, Windows 11) z mobilu:
stav, ochrana, čistenie, napájanie, obrazovka a ovládanie myšou, AI agent,
zapnutie cez Wake-on-LAN.

```
 Mobil (PWA)  ──wss──►  Relay (server)  ◄──wss──  Agent na notebooku (Windows)
      │                      ▲                          │
      │                      │wss                       ├─ PowerShell/WMI/CIM
      │                      │                          ├─ Microsoft Defender
      └── (wake) ─────────►  Zobúdzač (hub) v domácej   ├─ Lenovo WMI (režimy, batéria)
                             sieti ──UDP magic packet──►├─ zachytenie obrazovky + vstup
                                                        └─ AI mozog (Claude API + nástroje)
```

## Súčasti

| Balík | Beží kde | Úloha |
|---|---|---|
| `packages/protocol` | všade | Rámce, správy, **katalóg príkazov** (riziko, oprávnenia, argumenty), šifrovanie E2E, párovanie. Jediný zdroj pravdy. |
| `packages/brain` | notebook | AI agent: Claude API s nástrojmi z katalógu, pravidlá, potvrdzovanie, testovacia sada („tréning“). |
| `apps/agent-windows` | notebook | Vykonáva príkazy, posiela telemetriu, obrazovku, prijíma vstup, drží kľúče, audit. Režim `--simulate` na testovanie mimo Windows. |
| `apps/relay` | server (Fly.io/Render/VPS alebo doma) | Smeruje šifrované rámce, párovanie, tokeny, prítomnosť, limity. Obsah nevidí. |
| `apps/hub` | domáca sieť (Raspberry Pi, starý PC, NAS) | Pripojí sa na relay, na požiadanie pošle Wake-on-LAN. |
| `apps/mobile` | mobil (PWA) | Rozhranie Notebook Studio napojené na skutočné dáta; ukážkový režim bez pripojenia. |

## Tok príkazu

1. Mobil pošle `cmd` (šifrované) → relay → notebook.
2. Notebook overí argumenty podľa katalógu. Ak `risk` je `confirm`/`danger`, pošle
   `cmd.confirm_required` a čaká max. 60 s na `cmd.confirm` z mobilu.
3. Vykoná, priebežne `cmd.progress`, nakoniec `cmd.result`.
4. Každý príkaz ide do auditného záznamu na notebooku (kto, čo, výsledok).

AI agent (`chat.user`) beží **na notebooku**: API kľúč nikdy neopustí notebook,
nástroje sú tie isté príkazy z katalógu a platí rovnaké potvrdzovanie v mobile.

## Bezpečnosť (zhrnutie, detail v SECURITY.md)

- Žiadne otvorené porty doma: notebook, mobil aj hub sa pripájajú **von** na relay.
- E2E: ECDH P-256 → HKDF → AES-256-GCM, AAD viaže smer. Relay je len poštár.
- Párovanie jednorazovým kódom + overovací kód (SAS) potvrdený na notebooku.
- Tokeny: relay ukladá iba ich SHA-256. Odvolanie telefónu = zmazanie tokenu.
- Ochrana proti opakovaniu: `id` + `ts` (±2 min).
- Vývojársky režim (terminál, súbory) je **vypnutý**, zapína sa iba lokálne v konfigurácii notebooku.

## Obmedzenia, ktoré treba overiť priamo na notebooku

- **Wake-on-LAN z úplného vypnutia** závisí od BIOS-u. Na spotrebiteľských Lenovo často
  chýba voľba v BIOS-e; zo spánku a hibernácie funguje častejšie. Overí sa `network.wol_status`
  a skúškou. Náhrada: nechávať notebook v spánku alebo hibernácii.
- **Lenovo WMI** (režimy výkonu, šetrenie batérie, podsvietenie) nie je verejne
  dokumentované. Agent rozhranie najprv zistí a bez neho príkazy vráti `not_supported`.
- **BIOS**: z Windows sa dá prečítať verzia, Secure Boot, TPM a reštartovať priamo do
  nastavení UEFI (`power.reboot_to_firmware`). Samotné nastavenia BIOS-u sa menia ručne.
- **Obrazovka a vstup** fungujú, len keď je používateľ prihlásený (agent beží v jeho
  relácii, nie ako služba v relácii 0). Zamknutú obrazovku (UAC, prihlasovanie) nevidí.
