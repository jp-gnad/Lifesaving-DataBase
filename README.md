# Lifesaving Ergebnisarchiv

Eine reine statische GitHub-Pages-Website für die Datenbank `Lifesaving_Results.sqlite3` in Google Drive.

## Architektur

Zur Laufzeit gibt es genau eine Datenverbindung:

```text
GitHub Pages (HTML/CSS/JS) ──direkter HTTPS-Abruf──> öffentliche SQLite-Datei in Google Drive
```

Die SQLite-Datei wird im Browser geladen und mit der lokal mitgelieferten WebAssembly-Version von [sql.js](https://sql.js.org/) gelesen. Es gibt keinen eigenen Server, keinen Proxy, keine API und keinen Build-Schritt.

## Lokal testen

Da WebAssembly nicht zuverlässig über `file://` geladen wird, muss das Verzeichnis über einen einfachen statischen Dateiserver geöffnet werden:

```powershell
python -m http.server 8000
```

Danach `http://localhost:8000` öffnen.

## GitHub Pages

Die Website ist für die Veröffentlichung direkt aus dem Root-Verzeichnis des `main`-Branches vorbereitet. Alle Pfade sind relativ, damit sie unter der Projekt-URL von GitHub Pages funktionieren.

## Datenquelle

- Drive-Datei-ID: `1WWuvjmEO_6pIMKmgUFadZEqfVROXXSfz`
- Erwarteter Dateiname: `Lifesaving_Results.sqlite3`
- Die Datei muss weiterhin für „Jeder mit dem Link – Betrachter“ freigegeben sein.

## Drittanbieter-Code

`vendor/sql.js/` enthält sql.js 1.14.2 einschließlich der MIT-Lizenz. Die Dateien werden zusammen mit der Website über GitHub Pages ausgeliefert; es wird kein externes CDN verwendet.
