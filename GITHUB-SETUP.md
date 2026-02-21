# GitHub Token aanmaken — Stap voor stap

Dit hoef je maar **1x** te doen. Het token werkt daarna voor beide accounts (Martje & Justin).

---

## Stap 1: Ga naar GitHub

Open in je browser:
**https://github.com/settings/tokens?type=beta**

> Als je nog niet ingelogd bent, log eerst in op GitHub.

---

## Stap 2: Klik "Generate new token"

Je komt op de pagina "Fine-grained personal access tokens".  
Klik op de groene knop **Generate new token**.

---

## Stap 3: Vul de token-instellingen in

| Veld | Wat invullen |
|---|---|
| **Token name** | `Klusplanner` |
| **Expiration** | Kies `90 days` of `Custom` (bijv. 1 jaar) |
| **Description** | `Token voor klusplanner app` |

---

## Stap 4: Repository access

Kies: **Only select repositories**

Klik op het dropdown menu en selecteer je klusplanner repo  
(bijv. `jouw-username/klusplanner`)

---

## Stap 5: Permissions instellen

Klap open: **Repository permissions**

Zoek **Contents** → zet op **Read and write**

> Dat is het enige permission dat nodig is. De rest mag op "No access" blijven.

---

## Stap 6: Genereer het token

Scroll naar beneden en klik **Generate token**.

⚠️ **Kopieer het token NU** — je kunt het daarna niet meer zien!  
Het begint met `github_pat_` of `ghp_`

> Tip: Sla het even op in je Notities app op je telefoon.

---

## Stap 7: Invullen in Klusplanner

1. Open de Klusplanner en log in
2. Klik links op **Instellingen**
3. Klik op **GitHub koppelen**
4. Vul in:

| Veld | Voorbeeld |
|---|---|
| **Token** | `github_pat_xxxxx...` (plak het token) |
| **Repo eigenaar** | Je GitHub username (bijv. `jouw-username`) |
| **Repo naam** | `klusplanner` (de naam van je repo) |

5. Klik **Verbinden** — klaar!

---

## Repo klaarmaken (als je dat nog niet hebt)

Als je de repo nog moet aanmaken:

1. Ga naar **https://github.com/new**
2. Repo name: `klusplanner`
3. Zet op **Private**
4. Klik **Create repository**
5. Upload alle bestanden van het klusplanner zip bestand naar de repo:
   - Klik **uploading an existing file**
   - Sleep alle bestanden erin (index.html, app.js, styles.css, data/ map)
   - Klik **Commit changes**

---

## Veelgestelde vragen

**Moet ik dit op elke computer opnieuw doen?**  
Ja, per browser/apparaat 1x het token invoeren in Instellingen. Maar je hoeft maar 1 token aan te maken.

**Kan Justin hetzelfde token gebruiken?**  
Ja! Zodra één van jullie het token invult, wordt het opgeslagen op dat apparaat. Justin doet hetzelfde op zijn apparaat met hetzelfde token.

**Wat als het token verloopt?**  
Maak een nieuw token aan (stappen hierboven) en vul het opnieuw in via Instellingen → GitHub koppelen.

**Wat als ik het token kwijt ben?**  
Ga naar https://github.com/settings/tokens?type=beta, verwijder het oude token, en maak een nieuw aan.
