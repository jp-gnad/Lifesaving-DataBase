# Lifesaving Ergebnisarchiv

Eine reine statische GitHub-Pages-Website für die Datenbank `Lifesaving_Results.sqlite3` aus Google Drive.

## Architektur

Die Website versucht zuerst, die öffentliche Datei direkt von Google Drive abzurufen:

```text
GitHub Pages (HTML/CSS/JS) ──direkter HTTPS-Abruf──> öffentliche SQLite-Datei in Google Drive
```

Google Drive beantwortet browserseitige Cross-Origin-Downloads aktuell mit HTTP 403, obwohl die Datei öffentlich freigegeben ist. Deshalb fällt die Website automatisch auf die identische, unter `data/Lifesaving_Results.sqlite3` mitveröffentlichte Datei zurück. Es gibt weiterhin keinen eigenen Server, keinen Proxy, keine API und keinen Build-Schritt.

Die SQLite-Datei wird vollständig im Browser mit der lokal mitgelieferten WebAssembly-Version von [sql.js](https://sql.js.org/) gelesen.

## Daten aktualisieren

1. Die aktuelle `Lifesaving_Results.sqlite3` aus Google Drive herunterladen.
2. `data/Lifesaving_Results.sqlite3` durch diese Datei ersetzen.
3. Die Änderung in den `main`-Branch pushen; GitHub Pages veröffentlicht den neuen Datenstand.

Eine automatische Synchronisierung würde einen API-Schlüssel, Proxy oder serverseitigen Job erfordern und ist bewusst nicht eingebaut.

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
