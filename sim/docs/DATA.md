# Dáta: čo máme, čo chýba, odkiaľ ich vziať

Realizmus simulátora stojí na dátach. Tu je poctivý prehľad.

## Čo NIE je k dispozícii

Žiadny tím F1 (Williams ani iný) nezverejňuje dáta auta: aero mapy,
kinematiku zavesenia, dáta pneumatík, mapy motora. Ani ja (AI) k nim nemám
prístup – nemám žiadne interné dáta tímov. Všetko v `f1_2026_generic.ini`
je z verejných zdrojov alebo inžiniersky odhad a každá hodnota je tak
označená (`[REG]`, `[PUB]`, `[EST]`).

## Čo je verejne dostupné (a už sa používa)

| Zdroj | Čo dáva | Použitie |
|---|---|---|
| **Technické pravidlá FIA 2026** | hmotnosť (768 kg), rozvor (max 3,4 m), šírka (1,9 m), výkon MGU-K (350 kW), batéria, limity rekuperácie, 8 prevodov | priamo v parametroch `[REG]` |
| **FastF1** (Python, dáta z F1 live timingu) | pre každé kolo: rýchlosť, plyn, brzda (zap/vyp), prevod, otáčky, DRS, poloha X/Y/**Z** (~4 Hz) | kalibrácia rýchlostí v zákrutách, brzdných bodov, maximálnych rýchlostí; **prevýšenie tratí** |
| **OpenF1** (REST API) | podobné dáta ako FastF1 | alternatíva |
| **TUM racetrack-database** (LGPL-3.0) | stredová čiara + šírka pre ~25 tratí | geometria tratí (`scripts/fetch_tum_track.py`) |
| **OpenStreetMap** | geometria tratí | alternatíva / doplnenie |
| **Copernicus DEM / národné lidarové mapy** | výškové modely terénu (1–30 m) | prevýšenie tam, kde FastF1 nestačí; napr. Slovensko a Rakúsko majú verejné lidarové dáta |
| **Pirelli (tlačové materiály)** | pracovné teploty, tlaky, zmesi | teplotné okná pneumatík |
| **Onboard videá a TV grafiky** | brzdné body, rýchlosti, G-sily | kontrola |

## Postup kalibrácie s reálnymi dátami (na tvojom PC)

1. `pip install fastf1 numpy matplotlib`
2. Trať s prevýšením:
   `python scripts/track_from_fastf1.py --year 2026 --event Austria --out data/tracks/rbr.csv`
3. Reálne kolo:
   `python scripts/fastf1_export.py --year 2026 --event Austria --session Q --out real.csv`
4. Robot alebo ty odjazdíte kolo v simulátore (telemetria sa uloží
   automaticky), prípadne `f1sim_bench ... --telemetry sim.csv`.
5. `python scripts/compare_laps.py sim.csv real.csv --labels SIM F1`
6. Podľa rozdielov upravíme parametre:
   - maximálna rýchlosť na rovinkách → odpor (`cda_*`), výkon, prevody
   - rýchlosť v rýchlych zákrutách → prítlak (`cla_*`)
   - rýchlosť v pomalých zákrutách → mechanická priľnavosť (`mu_*`, citlivosť na zaťaženie)
   - dĺžka brzdenia → `mu_longitudinal`, brzdy, prítlak
   - akcelerácia z pomalých zákrut → trakcia, diferenciál, ERS

Tento cyklus „dáta → porovnanie → úprava → test“ je presne to, čo robia
tímy so simulátormi, len s oveľa hustejšími dátami.

## Dáta, ktoré by kvalitu posunuli najviac (a ako ich získať)

| Dáta | Prečo | Ako |
|---|---|---|
| **Dáta pneumatík** (sily vs. šmyk, zaťaženie, teplota) | pneumatika je 70 % pocitu z jazdy | F1 dáta nie sú dostupné. Existujú komerčné merania (napr. Tire Testing Consortium / Calspan pre FSAE pneumatiky) na overenie tvaru kriviek; F1 hodnoty zostanú odhadom kalibrovaným na telemetriu. |
| **Laserové skeny tratí** (presnosť ~1 cm) | nerovnosti a obrubníky vo volante | komerčné (predávajú ich firmy, ktoré skenujú pre iRacing/rF2); alternatíva: vlastné lidarové mapy štátov + fotogrametria z drona pre menšie trate |
| **Telemetria z vlastného simulátora s reálnym jazdcom** | ladenie FFB a „pocitu“ | ty na volante + záznam CSV z každého kola |
| **Aero mapa** | správanie pri zmene svetlej výšky, v šmyku | CFD (OpenFOAM) na zjednodušenom modeli auta – náročné, ale možné |
