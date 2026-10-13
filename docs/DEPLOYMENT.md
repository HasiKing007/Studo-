# Studo+ kostenlos online stellen (Cloudflare) und aufs iPhone holen

Studo+ läuft als **Cloudflare Worker** im Gratis-Plan: immer erreichbar, mit HTTPS, ohne Kreditkarte. Die Daten (Termine, Schalter, Einstellungen) liegen in einer SQLite-Datenbank in einem Durable Object, das ebenfalls im Gratis-Plan enthalten ist. Alle 30 Minuten gleicht der Worker selbstständig mit KUSSS ab. Jeder Merge auf `main` deployt automatisch über GitHub Actions (`.github/workflows/deploy.yml`).

Die Gratis-Grenzen (rund 100.000 Anfragen pro Tag) sind für eine Person um Größenordnungen mehr als genug.

## Einmalig (ca. 10 Minuten, alles im Browser)

1. **Cloudflare-Account anlegen:** https://dash.cloudflare.com/sign-up (nur E-Mail, keine Kreditkarte).
2. **Workers einmal öffnen:** Im Dashboard links auf *Compute (Workers)* bzw. *Workers & Pages* klicken. Beim ersten Öffnen legt Cloudflare deine persönliche Adresse `<name>.workers.dev` an. Merk dir den Namen.
3. **Account-ID kopieren:** Steht im Dashboard auf der Workers-Übersicht rechts (*Account ID*).
4. **API-Token erstellen:** Rechts oben Profil → *My Profile* → *API Tokens* → *Create Token* → Vorlage **„Edit Cloudflare Workers“** → bei *Account Resources* deinen Account wählen → *Continue to summary* → *Create Token*. Token kopieren (wird nur einmal angezeigt).
5. **Beides in GitHub hinterlegen:** Repo `HasiKing007/Studo-` → *Settings* → *Secrets and variables* → *Actions* → *New repository secret*:
   - `CLOUDFLARE_API_TOKEN` = der Token aus Schritt 4
   - `CLOUDFLARE_ACCOUNT_ID` = die Account-ID aus Schritt 3
6. **Deployment starten:** PR mergen, oder Repo → *Actions* → *Test & Deploy* → *Run workflow* (Branch `main`).
7. **Sofort selbst anmelden:** `https://studo-plus.<name>.workers.dev` öffnen und mit deiner JKU-Kennung (z. B. `k12345678`) und einem frei gewählten Passwort anmelden. Der **erste Login richtet die App für dich ein**, danach kann sich niemand anderes mehr anmelden.

## Stundenplan verbinden

1. In KUSSS den persönlichen Kalender-Export-Link kopieren (*Mein Kalender* → *Kalender exportieren/abonnieren*; den genauen Menüpfad bitte selbst prüfen).
2. In Studo+ unter *Einstellungen → KUSSS-Kalender* einfügen und *Link speichern* tippen. Der erste Sync startet sofort.

## Aufs iPhone

1. Die Adresse in **Safari** öffnen → *Teilen* → *Zum Home-Bildschirm*. Studo+ startet danach wie eine App.
2. In der App: Tab *Kalender* → *In Apple Kalender abonnieren* → *Abonnieren*.
3. Apple Kalender holt die Termine ab jetzt selbst vom Server, auch wenn du die App nie öffnest. Wie oft, stellst du unter *Einstellungen → Kalender → Accounts → Abrufen* ein.

## Lokal ausprobieren

```bash
cd worker
npm install
npm run dev        # http://localhost:8787, mit Beispielterminen (DEMO=1)
npm test
```

## Falls etwas schiefgeht

- Logs: Cloudflare-Dashboard → *Workers* → `studo-plus` → *Logs*.
- Deployment rot mit Hinweis auf „workers.dev subdomain“: Schritt 2 nachholen.
- Passwort vergessen: im Dashboard → `studo-plus` → *Settings* → den Worker löschen und neu deployen (*Run workflow*). Achtung: Dabei gehen die gespeicherten Schalter verloren, der Stundenplan wird neu geladen.

## Sicherheit

- Der KUSSS-Kalenderlink liegt in der Datenbank des Durable Objects, die nur dein Worker lesen kann. Eine zusätzliche Verschlüsselung mit einem Schlüssel, der ebenfalls bei Cloudflare läge, würde praktisch nichts bringen und ist deshalb weggelassen.
- Das App-Passwort wird mit PBKDF2-SHA256 (100.000 Runden, Salt) gehasht. Nach 5 Fehlversuchen ist das Login 15 Minuten gesperrt.
- Der Abo-Link enthält ein 192-Bit-Zufallstoken und kann in den Einstellungen jederzeit erneuert werden.
