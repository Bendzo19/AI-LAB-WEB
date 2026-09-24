# Notebook Studio — PWA (inštalovateľná ukážka)

Toto je **inštalovateľná mobilná appka** (Progressive Web App) ukážkovej verzie
Notebook Studia. Beží celá v prehliadači, **bez pripojenia na notebook** — všetky
dáta a akcie sú simulované. Slúži na to, aby si si appku pridal na plochu iPhonu
a vyskúšal, ako vyzerá a ovláda sa, kým ju napojíme na skutočné zariadenie.

Obsah je jeden statický priečinok: `index.html`, `manifest.webmanifest`, `sw.js`
(offline) a `icons/`. Žiadny build, žiadny server.

## Ako to dostať na iPhone (na plochu ako appku)

Potrebuješ, aby priečinok bežal na **HTTPS adrese**. Dve cesty:

### A) Rýchle nasadenie zadarmo (odporúčané)
1. Nahraj obsah tohto priečinka na ktorýkoľvek statický hosting:
   - **Vercel**: `npx vercel deploy --prod` v tomto priečinku, alebo pretiahni
     priečinok do vercel.com.
   - **Netlify Drop**: potiahni priečinok na app.netlify.com/drop.
   - **GitHub Pages**: zapni Pages nad týmto priečinkom.
2. Dostaneš adresu typu `https://…`.
3. Na iPhone otvor tú adresu v **Safari** → tlačidlo **Zdieľať** → **Pridať na
   plochu**. Objaví sa ikona „Notebook Studio“ a otvorí sa na celú obrazovku ako
   normálna appka.

### B) Otvoriť rovno z Claude
Appku vieš otvoriť aj z náhľadu v Claude a cez **Zdieľať → Pridať na plochu**.
Pre plne „appkový“ režim (celá obrazovka, vlastná ikona) však použi vlastnú
HTTPS adresu z bodu A — vtedy iOS načíta ikonu a manifest.

## Lokálne vyskúšanie na počítači
```bash
cd apps/pwa
python3 -m http.server 8080   # alebo: npx serve .
# otvor http://localhost:8080
```

## Poznámky
- **Offline**: po prvom otvorení sa appka uloží (service worker) a spustí sa aj
  bez internetu. Fonty sa doťahujú z Google Fonts; bez siete použije systémové.
- **iOS obmedzenia**: iPhone PWA nemá prístup k hardvéru notebooku — to zabezpečí
  až agent na samotnom notebooku (mimo tejto ukážky).
- **Aktualizácia**: po zmene súborov zvýš verziu v `sw.js` (`CACHE = 'ns-pwa-v2'`),
  aby si zariadenia stiahli nové súbory.
