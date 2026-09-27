# Fyzikálny model

Cieľ: fyzika, ktorá sa správa ako skutočné auto F1 – nie „herná“ fyzika
s dokreslenými efektmi. Všetko, čo cítiš vo volante, vychádza z rovnakých
síl, ktoré hýbu autom.

Kód: `core/src/vehicle.cpp`, `tyre.cpp`, `track.cpp`, `ffb.cpp`.
Parametre: `data/cars/f1_2026_generic.ini`.

## Časový krok

Pevný krok **1 ms (1000 Hz)** v samostatnom vlákne. Pre porovnanie:
iRacing ~360 Hz, rFactor 2 / ACC 400 Hz. Force feedback sa posiela na
volant 500×/s (nastaviteľné). Simulácia je deterministická – rovnaké vstupy
dávajú bit po bite rovnaký výsledok (test `vehicle_is_deterministic`),
čo je základ pre replaye a ghost autá.

## Karoséria a zavesenie (14 stupňov voľnosti + pohon)

- Karoséria: tuhé teleso 6 DOF (poloha, natočenie, zotrvačné momenty roll/pitch/yaw).
- 4 neodpružené hmoty: zvislý pohyb pozdĺž tlmiča.
- Pružiny kolies, **heave** (tretia) pružina s dorazom (packer), stabilizátory,
  dorazy a obmedzenie vyvesenia, tlmiče s dvojstupňovou charakteristikou
  (pomalé/rýchle, kompresia/odskok).
- Geometria: statický odklon a zbiehavosť, zmena odklonu so zdvihom,
  **výška stredu klopenia** (geometrický prenos zaťaženia) a **anti-dive /
  anti-squat** – sily pneumatík sa prenášajú do karosérie cez ramená
  zavesenia vrátane „jacking“ síl.
- Kontakt podlahy (plank) so zemou a trenie, nárazy do bariér.

## Pneumatiky

- Tvar kriviek podľa **Magic Formula** (Pacejka), kombinovaný šmyk cez
  normalizovaný šmyk → elipsa trenia, ktorej osi závisia od zaťaženia.
- **Citlivosť na zaťaženie** (koeficient trenia klesá s rastúcou silou).
- **Relaxačné dĺžky** – pneumatika nevytvorí silu okamžite, deformuje sa
  (dôležité pre prechodové stavy a stabilitu FFB pri nízkych rýchlostiach).
- **Vratný moment** z pneumatického závesu, ktorý so šmykom klesá a za
  hranicou priľnavosti sa mierne otočí → volant „zľahne“ tesne pred
  limitom (test `tyre_aligning_moment_centres_and_drops_before_peak`).
- Odklon: optimum priľnavosti a bočná sila od odklonu.
- **Teplotný model s 2 uzlami** (povrch dezénu, kostra): ohrev trením pri
  šmyku a hysteréziou (valivý odpor), chladenie vzduchom (závisí od
  rýchlosti), vedenie do trate, výmena povrch↔kostra. Priľnavosť závisí od
  teploty (okno ~100 °C). Tlak pneumatiky sa počíta z teploty kostry.
- Povrchy: asfalt, obrubník (vlnky → vibrácie vo volante), tráva, štrk.
  Asfalt má mikro-nerovnosti (niekoľko mm), ktoré cítiť cez FFB.

## Aerodynamika

- Prítlak a odpor ako funkcia rýchlosti, **svetlej výšky vpredu a vzadu**
  (ground effect: nižšie = viac prítlaku, pod kritickou výškou „stall“),
  **rake** (mení vyváženie) a **uhla vybočenia** (strata prítlaku v šmyku).
- **Aktívna aerodynamika 2026**: Z-mode (zákruty) a X-mode (rovinky,
  menší odpor aj prítlak), prechod ~0,35 s, pri brzdení sa X-mode sám zruší.
  Klapka zadného krídla sa vizuálne otvára.

## Pohon a ERS (pravidlá 2026)

- Spaľovací motor ~400 kW (krivka výkonu), obmedzovač, brzdenie motorom,
  automatické protiprelivové ovládanie spojky a štart.
- 8-stupňová sekvenčná prevodovka, preradenie ~30 ms, **ochrana proti
  pretočeniu** (podradenie sa odmietne), automatický medziplyn.
- Diferenciál s lamelovým obmedzením: predpätie + uzávierka pri plyne / bez plynu.
- **MGU-K 350 kW**: nasadenie s poklesom výkonu nad ~290 km/h, rekuperácia
  pri brzdení (brake-by-wire zadnej nápravy – brzdenie motorom + MGU-K +
  hydraulika dávajú spolu presne požadované zadné brzdenie), rekuperácia pri
  voľnobehu. Batéria 4 MJ, limit rekuperácie 8,5 MJ/kolo.
- Režimy ERS: vyvážený, kvalifikačný, nabíjanie.
- Spotreba paliva mení hmotnosť.

## Brzdy

Karbónové brzdy: trenie závisí od teploty (studené bŕzdia horšie, prehriate
slabnú), ohrev z brzdnej práce, chladenie prúdením a sálaním. Rozdelenie
bŕzd nastaviteľné za jazdy.

## Force feedback

Moment na volante = súčet momentov okolo osí natočenia predných kolies:

- vratný moment pneumatík (pneumatický záves),
- mechanický záves (caster) × bočná sila,
- rameno rejdu (scrub) × pozdĺžna sila → asymetrické brzdenie ťahá volant,
- vratný účinok záklonu/sklonu čapu (centrovanie pri nízkej rýchlosti),

delený prevodom riadenia, znížený o **posilňovač** (F1 ho má). Keďže
zaťaženie kolies obsahuje nerovnosti trate a obrubníky, cítiš ich priamo
cez fyziku. Nad to sa pridáva iba to, čo by mal skutočný volant: **soft-lock**
na doraze riadenia auta a voliteľné tlmenie. Žiadne „konzervové“ efekty.

Mierka: `car_torque_scale` 1,0 = skutočný moment F1 (po posilňovači);
výsledok sa normalizuje na maximálny moment tvojej základne. HUD ukazuje
klipovanie (keď požadovaný moment prekročí možnosti volantu).

## Validácia

`f1sim_bench` (výsledky v tomto repozitári):

| Test | F1 2025 | F1 2026 | Verejná referencia |
|---|---|---|---|
| 0–100 km/h | 2,75 s | 2,98 s | 2,4–3,5 s (bez TC závisí od štartu) |
| 0–200 km/h | 4,80 s | 5,09 s | 4–6 s |
| Max. rýchlosť (DRS/Z-mode zatvorené / otvorené) | 332 / 345 km/h | 324 / 349 km/h | 300–345 / 325–365 |
| Brzdenie 300→100 km/h | 80 m, 1,60 s | 90 m, 1,79 s | 70–130 m |
| Max. spomalenie | 6,9 g | 5,6 g | 4–7 g (autá 2022–25 ~6 g) |
| Bočné preťaženie R50 | 2,5 g pri 123 km/h | 2,2 g pri 111 km/h | 1,8–2,8 g |
| Bočné preťaženie R150 | 4,8 g pri 303 km/h | 3,9 g pri 274 km/h | 3–5 g |
| Moment volantu na limite (R150) | 20,1 Nm | 14,7 Nm | 3–40 Nm |

Teoretický čas kola (kvázi-statický model bodovej hmoty, ideálna stopa) vs.
pole position 2025:

| Trať | Auto 2025 | Auto 2026 | Pole 2025 |
|---|---|---|---|
| Red Bull Ring (s prevýšením) | 67,3 s | 68,3 s | 63,971 s |
| Monza (TUM, bez prevýšenia) | – | 82,6 s | 78,8 s |
| Silverstone (TUM, bez prevýšenia) | – | 93,7 s | 84,9 s |

Model je ~5 % pomalší na RBR. Hlavné známe príčiny: kvázi-statický model
nepozná kombinovanú priľnavosť pri brzdení do zákruty tak dobre ako jazdec,
stredová čiara TUM má v Remus (T3) polomer len ~8 m, a prítlak auta 2025 je
odhad. Presná kalibrácia potrebuje telemetriu (FastF1) – postup v
[DATA.md](DATA.md).

Stabilita na svahoch: Red Bull Ring má stúpanie až 12,9 %. Výška povrchu je
hladké 2D pole (2 m bunky), takže sa v ostrých zákrutách na svahu „neprekladá“,
a dotaz na zem je presný aj pri veľkom sklone (regresný test
`track_query_is_exact_on_steep_slopes`).

## Čo model zatiaľ nemá (úprimne)

- Presné dáta pneumatík Pirelli (nie sú verejné) – krivky sú odhad.
- Opotrebenie pneumatík, zmena tlaku podľa nastavenia, rôzne zmesi.
- Porpoising / aerodynamická nestabilita, turbulencia za autom (nie je súper).
- Poddajnosť riadenia a karosérie, gyroskopické efekty kolies.
- Počasie, gumovanie trate, vývoj teploty trate.
- Presné mapy motora a ERS (skutočné sú tajné) – nasadenie je zjednodušené.
- Robot-jazdec je testovací nástroj, nie súper; na Red Bull Ringu jazdí
  kolá 78–87 s (neplatné – v pomalých zákrutách Remus a T4 prichádza
  rýchlo a vyjde za obrubník). Na fyziku auta pre človeka to vplyv nemá.
