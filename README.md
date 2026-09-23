# Lifesaving Ergebnisarchiv

Eine reine statische GitHub-Pages-Website für `Lifesaving_Results.sqlite3`.

## Architektur

Die Website lädt genau eine Datenquelle aus dem eigenen Repository:

```text
GitHub Pages (HTML/CSS/JS) ──> data/Lifesaving_Results.sqlite3
```

Es gibt keinen eigenen Server, keinen Proxy, keine API und keinen Build-Schritt. Google Drive wird von der Website nicht kontaktiert.

Die SQLite-Datei wird vollständig im Browser mit der lokal mitgelieferten WebAssembly-Version von [sql.js](https://sql.js.org/) gelesen.

## Daten aktualisieren

1. Die aktuelle `Lifesaving_Results.sqlite3` aus Google Drive herunterladen.
2. `data/Lifesaving_Results.sqlite3` durch diese Datei ersetzen.
3. Die Änderung in den `main`-Branch pushen; GitHub Pages veröffentlicht den neuen Datenstand.

Eine automatische Synchronisierung mit Google Drive würde einen API-Schlüssel, Proxy oder serverseitigen Job erfordern und ist bewusst nicht eingebaut.

## Lokal testen

Da WebAssembly nicht zuverlässig über `file://` geladen wird, muss das Verzeichnis über einen einfachen statischen Dateiserver geöffnet werden:

```powershell
python -m http.server 8000
```

Danach `http://localhost:8000` öffnen.

## GitHub Pages

Die Website ist für die Veröffentlichung direkt aus dem Root-Verzeichnis des `main`-Branches vorbereitet. Alle Pfade sind relativ, damit sie unter der Projekt-URL von GitHub Pages funktionieren.

## Sichtbarkeit

Die Oberfläche enthält keinen Download-Link zur Datenbank. Da das Repository und GitHub Pages öffentlich sind, kann die SQLite-Datei technisch dennoch über ihre URL oder das Repository heruntergeladen werden. Ein echter Zugriffsschutz wäre nur mit einem Backend und Authentifizierung möglich.

## Drittanbieter-Code

`vendor/sql.js/` enthält sql.js 1.14.2 einschließlich der MIT-Lizenz. Die Dateien werden zusammen mit der Website über GitHub Pages ausgeliefert; es wird kein externes CDN verwendet.
