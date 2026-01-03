# Klusplanner (static app)

Een simpele, offline-friendly klusplanner voor verkoop/verbouwing/verhuizen:

- 1 masterlijst met klussen
- Personenlijst (los, meerdere mensen per klus)
- Klusdetail als **callsheet** (met **Print → Opslaan als PDF**)
- Dashboard met voortgang + uren (begroot vs werkelijk)
- Materialenoverzicht (geaggregeerd uit openstaande klussen)
- Import/Export JSON

## Starten (lokaal)

Omdat de app `fetch()` gebruikt om startdata te laden, werkt dit het best met een simpele lokale server:

### Optie 1 — Python
```bash
python -m http.server 8000
```
Open daarna: `http://localhost:8000`

### Optie 2 — VS Code Live Server
Installeer *Live Server* en open `index.html`.

## Data & opslag

- Startdata staat in:
  - `data/tasks.json`
  - `data/people.json`

- Tijdens gebruik wordt alles opgeslagen in je browser via **localStorage**.
- Je kunt altijd je actuele data downloaden via **Import/Export → Export JSON**.

## GitHub Pages

1. Maak een repo (bijv. `klusplanner`)
2. Upload alle bestanden uit deze map naar de root van je repo
3. Zet GitHub Pages aan op branch `main` (of `gh-pages`) → `/ (root)`
4. Open je Pages-URL

## Tips voor PDF callsheets
Open een klus → klik **Print callsheet** → kies **Opslaan als PDF** in je printmenu.
