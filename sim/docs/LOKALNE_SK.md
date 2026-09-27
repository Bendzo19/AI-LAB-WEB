# Pokračovanie na vlastnom PC

Tento priečinok (`sim/`) je celý projekt: fyzika, hra, dáta, modely,
skripty a dokumentácia. Na tvojom PC môžeš pokračovať sám alebo s Claude
Code, ktorý tam bude mať priamy prístup k Blenderu, Visual Studiu, Unrealu
a Assetto Corsa. `CLAUDE.md` je návod pre Claude Code: čo projekt je, ako
je postavený, ako sa testuje a čo sú ďalšie kroky.

## 1. Stiahnutie projektu

**Odporúčané (s históriou zmien, dá sa posielať späť na GitHub):**

```bat
git clone -b claude/nifty-cori-dvk1m1 https://github.com/Bendzo19/AI-LAB-WEB.git
cd AI-LAB-WEB\sim
```

(Git pre Windows: https://git-scm.com/download/win. Zvyšok repozitára
AI-LAB-WEB je webová stránka – s hrou nesúvisí.)

**Alebo** rozbaľ `f1sim-source.zip` – obsahuje to isté bez histórie.

## 2. Zostavenie a spustenie

Potrebuješ **Visual Studio 2022 alebo novšie** s „Desktop development with
C++“ (obsahuje aj CMake).

- Dvojklik na **`build.bat`** – nájde nástroje, zostaví hru, spustí testy
  a nainštaluje Python balíčky pre dátové skripty.
- Dvojklik na **`run.bat`** – spustí hru.
- Nové modely áut z Blendera: `build.bat -Models` (Blender sa nájde sám).

Vo Visual Studiu: File → Open → Folder → `sim`, hore **x64-Release**,
cieľ **f1sim.exe**, F5.

## 3. Claude Code lokálne

1. Inštalácia (PowerShell): `irm https://claude.ai/install.ps1 | iex`
   (alebo s Node.js: `npm install -g @anthropic-ai/claude-code`).
2. V priečinku `sim` spusti `claude`. Prečíta si `CLAUDE.md` a vie, kde čo je.
3. Blender MCP pripojíš do Claude Code napr. (pre blender-mcp):
   `claude mcp add blender -- uvx blender-mcp` – v Blenderi musí bežať
   jeho doplnok. Potom môže Claude upravovať model priamo v tvojom Blenderi.
4. Výhody oproti cloudu: vidí tvoj volant a hru naživo, spustí Unreal,
   Assetto Corsa aj Content Manager, číta súbory áut z AC (ukladaj ich do
   `private/`, nikdy nie na GitHub).

Dobré prvé zadanie pre lokálneho Claude:
„Prečítaj CLAUDE.md, zostav projekt a spusti testy. Potom nahrávaj
telemetriu z Assetto Corsa (scripts/ac_telemetry.py) a porovnaj moje kolo
na Red Bull Ringu so simulátorom.“

## 4. Kam ďalej (grafika + realizmus)

Podrobne v `CLAUDE.md` („Next steps“). Stručne:

1. **Test na volante** → ladenie FFB a správania auta.
2. **Porovnanie s Assetto Corsa** → rovnaká trať, telemetria cez seba,
   úprava pneumatík/aerodynamiky/motora, kým sa správanie nezhoduje.
3. **Unreal Engine 5** → grafika na úrovni moderných simulátorov
   (Lumen, Nanite). Fyzika z `core/` sa použije bez zmeny ako plugin –
   rovnako ako to robí Assetto Corsa Competizione (Unreal + vlastná fyzika).
   Nainštaluj UE5 cez Epic Games Launcher; port robí Claude lokálne, kde
   môže projekt v Unreale skutočne zostaviť a vyskúšať.
4. Opotrebenie pneumatík, nastavenie auta, ďalšie trate, zvuk, SimHub.

## Čo kde je

| Priečinok | Obsah |
|---|---|
| `core/` | fyzika (C++), nezávislá od grafiky – najcennejšia časť |
| `app/` | hra: okno, grafika, HUD, volant/pedále/FFB |
| `data/cars/` | parametre áut (2025, 2026) so zdrojmi hodnôt |
| `data/tracks/` | trate (Red Bull Ring s prevýšením, testovacia) |
| `data/models/` | 3D modely (glTF) + volant |
| `art/blender/` | upraviteľné scény modelov (.blend) |
| `scripts/` | FastF1, trate, porovnanie kôl, AC telemetria, Blender generátor |
| `tests/`, `tools/` | testy a validačný benchmark |
| `docs/` | fyzika, dáta, plán (po slovensky) |
