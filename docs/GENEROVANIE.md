# Generovanie na webe — kredity a súbežnosť

Tento dokument popisuje systém, ktorý nahradil pôvodné generovanie „jeden
beh naraz". Cieľ bol jediný: **sto ľudí naraz musí vygenerovať sto vecí
naraz** — bez radu, bez čakania jeden na druhého a bez toho, aby sa
niekomu odpísali kredity za výsledok, ktorý nikdy nedorazil.

---

## 1. Prečo to predtým nešlo súbežne

Nebol to limit poskytovateľa. Poskytovateľ (kie.ai) má asynchrónne API —
prijatie zadania trvá stovky milisekúnd a samotné generovanie beží na jeho
GPU. Limit bol v architektúre:

- request držal spojenie, kým sa negeneruje (desiatky sekúnd až minúty),
- stav behu žil v pamäti jedného procesu, takže sa muselo čakať v poradí,
- kredity boli spoločné pre celý účet, takže sa nedalo povedať, komu čo
  odpísať, a ani koľko smie minúť naraz.

Ktorýkoľvek z týchto troch bodov sám o sebe stačí na to, aby druhý človek
čakal na prvého.

## 2. Ako to funguje teraz

Generovanie je rozdelené na tri kroky, ktoré sa navzájom neblokujú:

```
  1. ODOSLANIE (request užívateľa, ~300 ms)
     ├─ kontrola vstupu proti popisu modelu
     ├─ výpočet ceny
     ├─ rezervácia kreditov        ← jediný zámok, a len na riadku
     ├─ riadok v generation_jobs      TOHO JEDNÉHO užívateľa
     └─ createTask u poskytovateľa -> uloží sa provider_task_id
                                      odpoveď: 202 + id úlohy

  2. GENEROVANIE (u poskytovateľa, náš server nič nedrží)

  3. DOKONČENIE (callback od poskytovateľa)
     ├─ overenie tokenu v adrese
     ├─ atomický prechod úlohy do konečného stavu
     └─ zaúčtovanie: minie sa skutočná cena, zvyšok rezervácie sa vráti
```

Nikde v tom nie je globálna fronta ani zámok cez viacerých užívateľov.
Sto súbežných requestov = sto paralelných behov.

### Čo to reálne znamená v číslach

Namerané na `npm run loadtest` (100 účtov, každý jedno generovanie,
mock poskytovateľ, produkčný build, skutočný Postgres, jeden kontajner):

| veličina | hodnota |
|---|---|
| prijatých zadaní | 100 zo 100 |
| rozbehnutých okamžite | 100 zo 100 |
| medián odpovede | 464 ms |
| p95 odpovede | 481 ms |
| celý nápor | 528 ms |

Čísla sú o réžii nášho systému, nie o rýchlosti modelu — mock „generuje"
300 ms. Pri skutočnom poskytovateľovi sa k tomu pripočíta čas jeho
`createTask` (rádovo stovky ms) a potom už len čakanie na callback, počas
ktorého náš server nedrží nič.

Pri 300 súbežných zadaniach (nad strop 200) sa rozbehne strop a zvyšok
čaká na uvoľnenie miesta — nič sa nezahodí a nikto nedostane chybu.

## 3. Kredity

Dve tabuľky, jedna pravda:

- `credit_accounts` — aktuálny stav (`balance` = voľné, `reserved` = držané)
- `credit_ledger` — každý pohyb, append-only, s kľúčom idempotencie

**Prečo rezervácia a nie priame odpísanie:** generovanie môže zlyhať.
Keby sme účtovali až po dokončení, dal by sa spustiť dvadsiaty beh na
kredity, ktoré má človek len raz. Keby sme účtovali dopredu natvrdo,
platil by aj za to, čo poskytovateľ odmietol. Rezervácia rieši oboje.

**Prečo sa nedá minúť dvakrát:** rezervácia je jeden príkaz

```sql
UPDATE credit_accounts
   SET balance = balance - $2, reserved = reserved + $2
 WHERE user_id = $1 AND balance >= $2
```

Postgres pri ňom zamkne riadok daného užívateľa. Dva súbežné požiadavky
toho istého človeka sa teda vyhodnotia za sebou (mikrosekundy), riadky
iných užívateľov sa nezamykajú vôbec. Test `npm run loadtest` to overuje:
z desiatich súbežných pokusov na účet s kreditmi na jeden beh prejde
presne jeden a zvyšok dostane 402.

**Prečo sa nedá zaúčtovať dvakrát:** konečný stav úlohy sa nastavuje
podmieneným `UPDATE ... WHERE status IN ('dispatching','running')`.
Kto ten súboj prehrá (druhý callback, cron, ktorý dobehol súčasne),
neúčtuje nič. Poistkou navyše je `UNIQUE (user_id, kind, ref)` v knihe.

**Vrátenie pri zlyhaní** je automatické a úplné — vrátane prípadu, keď
minie prostriedky spoločný účet u poskytovateľa (kód `provider_bez_kreditu`).
Taká chyba ide zároveň do logu ako prevádzková, nie ako chyba užívateľa.

## 4. Stropy nie sú fronta

| premenná | predvolené | načo je |
|---|---|---|
| `GEN_MAX_INFLIGHT_PER_USER` | 4 | aby jeden človek nezabral celý účet ostatným |
| `GEN_MAX_INFLIGHT_TOTAL` | 200 | strop pre celý web |
| `GEN_MAX_INFLIGHT_PER_PROVIDER` | 150 | aby sme nešli cez limit poskytovateľa |
| `GEN_MAX_SUBMITS_PER_MINUTE` | 20 | ochrana proti skriptu |

Pri bežnej prevádzke (sto ľudí, každý jedna–dve úlohy) sa strop nedotkne
nikoho. Keď sa naň narazí, úloha ostane v stave `queued` a pustí sa hneď,
ako sa uvoľní miesto.

**Admisia ide podľa poradia vzniku,** nie podľa okamžitého počtu bežiacich.
Rozdiel je zásadný a je to opravená chyba: keď sa počítali všetky bežiace,
nápor tristo ľudí sa zahryzol sám do seba — všetci naraz videli tristo
bežiacich, všetci usúdili, že sú nad stropom, a všetci sa vrátili do
frontu (z 300 sa rozbehlo 17). S poradím podľa `created_at` vidí
najstarších dvesto pred sebou menej než strop a ide von hneď.

## 5. Poskytovatelia

| id | režim | čo potrebuje |
|---|---|---|
| `kie` | async (callback) | `KIE_API_KEY` |
| `google` | inline | `GOOGLE_API_KEY` + úložisko |
| `openai` | inline | `OPENAI_API_KEY` + úložisko |
| `mock` | async | nič — `GEN_MOCK=1` |

**async** znamená, že poskytovateľ vráti `taskId` a ozve sa callbackom.
Toto je cesta, ktorá drží web priepustný.

**inline** znamená, že jedno HTTP volanie trvá celé generovanie (desiatky
sekúnd). Také modely sa spúšťajú až po odoslaní odpovede užívateľovi
(`after()`), takže request nikdy nečaká; poistkou je cron.

### Ako pustiť Gemini alebo OpenAI priamo

Bez zmeny kódu — model ostane v katalógu aj s cenou, len sa povie, kto ho
má počítať:

```bash
GOOGLE_API_KEY=...
GEN_STORAGE=supabase
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...

GEN_MODEL_ROUTING={"nano-banana-pro":"google:gemini-3-pro-image"}
```

Čo za to dostaneš a čo zaplatíš:

| | cez kie.ai | priamo Google/OpenAI |
|---|---|---|
| cena | nákup + marža prostredníka | priamo cena poskytovateľa |
| limity | zdieľané na cudzom účte | tvoja kvóta, dá sa zdvihnúť |
| výsledok | hotový odkaz | bajty → potrebuješ úložisko |
| moderácia | podľa modelu | Google/OpenAI, nevypína sa |
| účtovanie neúspechov | rieši poskytovateľ | riešiš sám (už je v kóde) |
| počet modelov | desiatky, jeden kľúč | len ich vlastné |

Limity sú pri oboch **na projekt/účet, nie na request**, takže sto ľudí
naraz zvládnu — narazíš až na RPM/TPM svojho tieru. Keď to nastane,
vráti sa 429, čo je označené ako opakovateľná chyba: úloha sa vráti do
frontu a skúsi znova s odstupom namiesto toho, aby padla užívateľovi.

### Názvy modelov u poskytovateľa

`lib/generation/models.json` má pri každom modeli `provider_model`.
Modely s `"overit": true` majú názov, ktorý ešte nikto neporovnal
s dokumentáciou:

```bash
npm run verify:models            # čo treba overiť
npm run verify:models -- --live  # overí názvy priamo u kie.ai
```

Živá kontrola posiela `createTask` s prázdnym vstupom a len pri modeloch,
ktoré majú povinné polia — taká požiadavka musí skončiť chybou o vstupe,
takže sa nič nevygeneruje a nič nezaplatí.

**Toto je jediná vec, ktorá musí byť hotová pred spustením naostro.**

## 6. Katalóg a formulár

`lib/generation/models.json` je jediný zdroj pravdy o tom, čo vieme
generovať, čo to stojí a aké polia model berie. Formulár v Štúdiu sa
kreslí z `polia` — pridanie modelu teda **nevyžaduje nové UI**.

Cena sa počíta v `lib/generation/cena.ts`. Je to čistá funkcia bez
prístupu k prostrediu, aby ju vedel spustiť server aj prehliadač: odhad,
ktorý človek vidí pri posuvníku, je tá istá matematika, akou sa mu potom
rezervujú kredity. Dve implementácie by sa skôr či neskôr rozišli.

Pravidlo pri neistote: **radšej nadhodnotiť**. Rezervovaná čiastka je
strop a čo sa neminie, vráti sa. Opačné poradie by znamenalo mínusové
zostatky.

## 7. Prevádzka

### Cron

`/api/cron/generation` (chránené `CRON_SECRET`) robí päť vecí:

1. vráti do frontu úlohy uviaznuté v odosielaní (spadol proces)
2. pustí úlohy, ktoré čakali na uvoľnenie stropu
3. dotiahne výsledky, na ktoré nedorazil callback
4. zavrie úlohy po časovom strope a vráti kredity
5. raz za hodinu pridelí mesačné kredity predplatiteľom

Na Netlify to spúšťa `netlify/functions/cron-generation.mjs` (každú minútu).
Na Vercel:

```json
{ "crons": [{ "path": "/api/cron/generation", "schedule": "* * * * *" }] }
```

**Generovanie na cron-e nestojí.** Keby nebežal vôbec, web funguje ďalej —
len sa výsledky dotiahnu neskôr, pri pohľade klienta na stav úlohy.

### Čo sledovať

```sql
-- koľko toho práve beží a u koho
SELECT * FROM v_generation_inflight;

-- úlohy, ktoré sa opakovane nedarí odoslať
SELECT id, model_id, attempts, error_code, error_message
  FROM generation_jobs
 WHERE status = 'queued' AND attempts >= 2
 ORDER BY created_at;

-- história jednej úlohy (podpora)
SELECT kind, detail, created_at FROM generation_events
 WHERE job_id = '...' ORDER BY created_at;

-- kontrola účtovníctva: zostatok musí sedieť s knihou
SELECT a.user_id, a.balance, sum(l.balance_delta) AS z_knihy
  FROM credit_accounts a JOIN credit_ledger l ON l.user_id = a.user_id
 GROUP BY a.user_id, a.balance
HAVING a.balance <> sum(l.balance_delta);
```

Posledný dotaz musí vrátiť **nula riadkov**. Keď nie, niekto siahol na
zostatok mimo `lib/generation/credits.ts`.

### Chybové kódy, ktoré znamenajú prevádzkový problém

| kód | čo sa stalo |
|---|---|
| `provider_bez_kreditu` | došli peniaze na spoločnom účte u poskytovateľa |
| `zly_kluc` | API kľúč je neplatný alebo odvolaný |
| `neznamy_model` | zlý `provider_model` v katalógu |
| `bez_uloziska` | priamy poskytovateľ bez nastaveného `GEN_STORAGE` |

Prvé dva idú do logu cez `console.error` s prefixom
`[generation] PREVÁDZKOVÁ CHYBA`.

## 8. Testy

```bash
npm run typecheck
npm run check                 # preflight vrátane sekcie o generovaní
npm run loadtest              # 100 ľudí naraz, proti mocku
npm run loadtest -- --users=150 --jobs=2   # nad strop
```

Záťažový test potrebuje **skutočný Postgres** (nie PGlite — tá má jedno
spojenie a súbeh by nemerala) a bežiaci web s `GEN_MOCK=1`:

```bash
# 1. web s mockom
DATABASE_URL=postgresql://... GEN_MOCK=1 GEN_FORCE_CALLBACK=1 \
APP_URL=http://localhost:3000 npm run dev

# 2. test
DATABASE_URL=postgresql://... npm run loadtest
```

Čo test overuje:

1. všetkých sto zadaní prejde a rozbehne sa okamžite
2. nad stropom sa nič nestratí, len odloží
3. desať súbežných pokusov na kredity pre jeden beh = práve jeden prejde
4. rovnaký `idempotency_key` nezaloží druhú úlohu
5. po dobehnutí nie sú držané žiadne kredity a zostatky sedia s knihou

## 9. Čo v tomto systéme zámerne nie je

- **Vlastný worker / Redis / fronta mimo databázy.** Postgres so
  `SKIP LOCKED` a podmienenými `UPDATE` stačí na rádovo vyššiu záťaž,
  než tento web bude mať, a nepridáva ďalšiu vec, ktorá vie spadnúť.
- **Dopytovanie stavu v slučke na serveri.** Výsledok chodí callbackom;
  dopyt je len poistka.
- **Cena od klienta.** Klient dostane katalóg a spočíta si odhad na
  zobrazenie. Rezervuje sa vždy to, čo spočíta server.
- **Mazanie výsledkov.** Súbory u poskytovateľa majú vlastnú expiráciu;
  keď bude treba archív, je to samostatná úloha.
