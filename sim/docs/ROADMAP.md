# Plán a potrebné nástroje

## Čo je hotové (verzia 0.1)

- Fyzikálne jadro 1000 Hz: podvozok, zavesenie, pneumatiky s teplotami,
  aerodynamika s ground effectom a aktívnou aerodynamikou 2026, motor +
  MGU-K + batéria, prevodovka, diferenciál, brzdy s teplotami.
- Force feedback z fyziky (moment na riadení), soft-lock, test smeru, klipovanie.
- Volant, pedále, gamepad, klávesnica; nastavenie priamo v hre.
- Time Trial: časomiera, sektory, delta, pravidlá tratových limitov,
  telemetria kola do CSV.
- 9 kamier, HUD aplikácie v štýle AC, pauzové menu.
- Testovacia trať + import tratí (TUM CSV, FastF1 s prevýšením).
- Načítanie vlastných 3D modelov (glTF/GLB).
- 23 regresných testov, validačný benchmark, Windows build, CI.

## Ďalšie kroky (navrhované poradie)

### 1. Tvoja spätná väzba z volantu (hneď)
Ty jazdíš, ja ladím. Najdôležitejšie otázky: je FFB správnym smerom, nie je
príliš slabé/silné, cítiť obrubníky, nie je volant „mŕtvy“ v strede, kmitá
na rovinke? Ako sa auto správa na limite (nedotáčavosť/pretáčavosť)?
Pošli mi `config/settings.ini` a pár súborov z `telemetry/`.

### 2. Kalibrácia na reálne dáta 2026
FastF1 skripty (na tvojom PC) → porovnanie → úprava parametrov → nová verzia.
Viac tratí s prevýšením.

### 3. Fyzika – ďalšia úroveň
- opotrebenie a degradácia pneumatík, tlaky podľa nastavenia, zmesi C1–C5
- nastavenie auta (setup) v hre: krídla, pružiny, stabilizátory, svetlá výška, odklon, diferenciál, brzdy
- presnejšia kinematika zavesenia (skutočné body ramien namiesto parametrov)
- poddajnosť riadenia a podvozku, gyroskopické efekty
- vývoj trate (gumovanie), vietor, teplota trate

### 4. Grafika a obsah
- 3D model auta (generovaný alebo modelovaný) – systém je pripravený (glTF)
- 3D model trate: terén, obrubníky, bariéry, tribúny
- neskôr prechod renderovania do **Unreal Engine 5** (fyzikálne jadro sa
  zabalí ako plugin – ako to robí ACC); alternatíva: Godot 4 (open source)
- zvuk: motor podľa otáčok a záťaže, pneumatiky pri šmyku, prevodovka

### 5. Hra
- hlavné menu: výber auta, trate, relácie
- ghost auto (najlepšie kolo), replay (fyzika je deterministická)
- AI súperi (lepší AI jazdec s prediktívnym riadením – MPC)
- motion platformy a externé displeje: výstup telemetrie cez UDP
  (kompatibilný so SimHub)

## Nástroje a aplikácie, ktoré budeme potrebovať

| Nástroj | Na čo | Cena |
|---|---|---|
| **Visual Studio 2022 Community** + CMake | zostavenie hry na Windows | zadarmo |
| **Git + GitHub** | verzie, automatické buildy (Actions) | zadarmo |
| **Python 3 + FastF1, numpy, matplotlib** | reálne dáta F1, porovnanie kôl | zadarmo |
| **Blender** | úprava a export 3D modelov do GLB, rozdelenie auta na karosériu a kolesá | zadarmo |
| **Generátor 3D modelov** (Meshy, Tripo, Rodin, …) | rýchly model auta z obrázka/textu | freemium |
| **SimHub** | prídavné displeje, LED, bass shakery (po pridaní UDP výstupu) | zadarmo / plus |
| **Ovládač volantu** (Logitech G Hub, Fanatec, Moza Pit House, Simucube Tuner) | rotácia volantu, max moment, filtre | zadarmo |
| **MoTeC i2 Pro** (voliteľné) | profesionálna analýza telemetrie (neskôr export .ld) | zadarmo |
| **Unreal Engine 5** (neskôr) | špičková grafika | zadarmo do limitu príjmov |
| **QGIS** (voliteľné) | výškové dáta tratí z lidarových máp | zadarmo |
| **OpenFOAM** (voliteľné, pokročilé) | vlastné CFD aero mapy | zadarmo |

## Otázky pre teba

1. **Aký máš volant a pedále** (značka, model, max. moment)? Nastavím predvolené hodnoty FFB.
2. **Ktorá sezóna / auto**: pravidlá 2026 (aktuálne) alebo 2022–2025 (ground effect, DRS, viac dát)? Obe vieme mať ako samostatné autá.
3. **Prvá reálna trať**: navrhujem Red Bull Ring (krátka, výrazné prevýšenie, dobré dáta) – súhlasíš?
4. **Grafika**: chceš ísť neskôr do Unreal Engine 5, alebo zostať pri vlastnom rendereri?
5. **Monitor**: jeden, tri, VR? (FOV a podpora troch monitorov / VR sú samostatné úlohy.)
