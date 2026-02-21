# Klusplanner Pro v2.0

Een professionele, offline-friendly klusplanner voor verbouwing/verhuizing/verkoop.  
Samenwerken via GitHub — geen server nodig.

---

## Features

### Overzicht (3 weergaven)
- **Lijst** — Filterable tabel met alle klussen, gesorteerd op status/datum
- **Gantt** — Horizontale tijdlijn (week/maand zoom) met ingeplande klussen
- **Agenda** — Apple Calendar-stijl: maand/week/dag weergave met klik-door

### Samenwerken via GitHub
- Twee (of meer) gebruikers werken in dezelfde private repo
- Elke wijziging wordt als commit opgeslagen
- Automatische conflict-detectie (SHA-based)
- Volledige versiegeschiedenis gratis via Git

### Taken
- Snel toevoegen met één klik
- Vrije groepen/labels met kleuren
- Auto-suggest voor project, locatie en categorie
- Definition of Done, materialen, tools, stappenplan
- 3-punts ureninschatting (optimistisch/realistisch/worst)
- Print callsheet (PDF) per klus

### iCal Sync (Apple Agenda)
- Download `.ics` bestand met alle ingeplande klussen
- Importeer in Apple Calendar, Google Calendar, Outlook
- Abonneer via GitHub Pages URL voor automatische sync

### Extra
- Dashboard met KPI's (voortgang, uren, blokkades)
- Materialenlijst (geaggregeerd uit openstaande klussen)
- Personen beheren met klusoverzicht per persoon
- Import/Export JSON
- Offline modus (localStorage)

---

## Setup: GitHub samenwerking

### 1. Maak een private repo

```bash
# Maak een nieuwe private repo aan op github.com
# Naam: bijv. "klusplanner"
```

### 2. Push de bestanden naar de repo

```bash
git init
git add .
git commit -m "Initial klusplanner setup"
git remote add origin https://github.com/JOUW-USERNAME/klusplanner.git
git push -u origin main
```

### 3. Maak Personal Access Tokens

Elke gebruiker maakt een eigen token:

1. Ga naar **GitHub** → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens**
2. Klik **Generate new token**
3. Geef een naam (bijv. "Klusplanner")
4. **Repository access**: Only select repositories → kies jouw klusplanner repo
5. **Permissions**: Repository permissions → **Contents** → **Read and write**
6. Genereer en kopieer het token

### 4. (Optioneel) GitHub Pages aanzetten

Voor iCal auto-sync:
1. Repo → **Settings** → **Pages**
2. Source: **Deploy from a branch** → `main` → `/ (root)`
3. Sla op → je krijgt een Pages-URL

### 5. Inloggen in de app

1. Open `index.html` (lokaal of via Pages)
2. Vul in: token, repo eigenaar, repo naam
3. Vink "Onthoud" aan
4. Klik **Verbinden**

---

## iCal Sync met Apple Agenda

### Eenmalig importeren
1. Ga naar **Instellingen** → klik **Download .ics**
2. Open het bestand → Apple Calendar importeert het

### Auto-sync (via GitHub Pages)
Als je GitHub Pages hebt ingeschakeld:
1. De app genereert een `klusplanner.ics` bij elke sync
2. In iPhone: **Instellingen** → **Agenda** → **Accounts** → **Voeg account toe** → **Overige** → **Voeg agenda-abonnement toe**
3. URL: `https://JOUW-USERNAME.github.io/klusplanner/klusplanner.ics`
4. Apple pollt deze URL automatisch (elke paar uur)

---

## Lokaal starten

```bash
# Python
python -m http.server 8000
# Open http://localhost:8000

# Of VS Code Live Server
```

---

## Bestandsstructuur

```
├── index.html          # App shell
├── styles.css          # Complete design system
├── app.js              # Alle logica
├── data/
│   ├── tasks.json      # Klussen (seed/live data)
│   ├── people.json     # Personen
│   └── groups.json     # Groepen met kleuren
└── README.md
```

---

## Tips

- **Snel klus toevoegen**: Klik de oranje `+ Nieuwe klus` knop in de header
- **Callsheet printen**: Open een klus → Print → Opslaan als PDF
- **Filters combineren**: Gebruik meerdere filters tegelijk in Overzicht
- **Groepen aanpassen**: Ga naar Instellingen → Groepen beheren
- **Conflict bij samenwerken**: Als je collega eerder heeft opgeslagen, klik op de sync knop (🔄) om eerst op te halen
