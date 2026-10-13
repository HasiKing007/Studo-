# Studo+ kostenlos online stellen (Cloudflare) und aufs iPhone holen

Studo+ läuft als **Cloudflare Worker** im Gratis-Plan: immer erreichbar, mit HTTPS, ohne Kreditkarte. Die Daten (Termine, Schalter, Einstellungen) liegen in einer SQLite-Datenbank in einem Durable Object, das ebenfalls im Gratis-Plan enthalten ist. Alle 30 Minuten gleicht der Worker selbstständig mit KUSSS ab. Jeder Merge auf `main` deployt automatisch über GitHub Actions (`.github/workflows/deploy.yml`).

Jedes Konto bekommt ein eigenes Durable Object (eigene Datenbank). Die Gratis-Grenzen (rund 100.000 Anfragen pro Tag) reichen für einige hundert aktive Studierende.

## Einmalig (ca. 10 Minuten, alles im Browser)

1. **Cloudflare-Account anlegen:** https://dash.cloudflare.com/sign-up (nur E-Mail, keine Kreditkarte).
2. **Workers einmal öffnen:** Im Dashboard links auf *Compute (Workers)* bzw. *Workers & Pages* klicken. Beim ersten Öffnen legt Cloudflare deine persönliche Adresse `<name>.workers.dev` an. Merk dir den Namen.
3. **Account-ID kopieren:** Steht im Dashboard auf der Workers-Übersicht rechts (*Account ID*).
4. **API-Token erstellen:** Rechts oben Profil → *My Profile* → *API Tokens* → *Create Token* → Vorlage **„Edit Cloudflare Workers“** → bei *Account Resources* deinen Account wählen → *Continue to summary* → *Create Token*. Token kopieren (wird nur einmal angezeigt).
5. **Beides in GitHub hinterlegen:** Repo `HasiKing007/Studo-` → *Settings* → *Secrets and variables* → *Actions* → *New repository secret*:
   - `CLOUDFLARE_API_TOKEN` = der Token aus Schritt 4
   - `CLOUDFLARE_ACCOUNT_ID` = die Account-ID aus Schritt 3
   - `STUDO_ADMIN_PASSWORD` = ein langes, eigenes Passwort für das **Admin-Konto**. Das Admin-Konto ist getrennt von deinem Studierenden-Konto: Auf der Anmeldeseite unten *Admin-Anmeldung* wählen, Benutzer `admin`, dieses Passwort. Ohne das Secret bleibt der Admin-Login gesperrt.
6. **Deployment starten:** PR mergen, oder Repo → *Actions* → *Test & Deploy* → *Run workflow* (Branch `main`).
7. **Anmelden:** `https://studo-plus.<name>.workers.dev` öffnen, Hochschule wählen und mit dem Uni-Account anmelden. Den Link kannst du an andere Studierende weitergeben, jede:r bekommt ein eigenes Konto.

## Anmeldung und Stundenplan

- **JKU:** Login mit Matrikelnummer (mit oder ohne „k“) und JKU-Passwort. Der Worker meldet sich damit über das JKU-Single-Sign-on bei KUSSS an, öffnet *Studierzimmer → Terminexport*, legt dort bei Bedarf über *Create* den Kalender-Abo-Link an und übernimmt ihn. Außerdem liest er den Namen und die *Notenauskunft* (Noten, ECTS, Studienrichtung) für den Tab *Studium*. Das Passwort wird nicht gespeichert, nur ein PBKDF2-Prüfwert, damit der Login auch klappt, wenn das JKU-SSO gerade nicht erreichbar ist.
- **Andere Hochschulen:** Beim ersten Login wird ein eigenes Studo+-Passwort festgelegt. Danach unter *Einstellungen → Kalender-Link (iCal)* den persönlichen Kalender-Link aus dem Uni-System einfügen (CAMPUSonline, TISS, u:space usw. bieten so einen Link an).
- Weitere Hochschulen: ein Eintrag in `worker/src/unis.js`.

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
- JKU-Login klappt nicht: Fehlermeldung in der App lesen. Wenn KUSSS/SSO sich geändert hat, steht die Ursache in den Logs (`jku.js`). Als Ausweichweg kann der Kalender-Link immer auch manuell eingefügt werden.
- Passwort vergessen (nicht JKU): In der App *Konto und Daten löschen* geht nur angemeldet. Sonst im Cloudflare-Dashboard unter *Durable Objects* das Objekt löschen lassen oder das Konto neu unter einem anderen Namen anlegen.

## Sicherheit und Datenschutz

- Jedes Konto hat seine eigene Datenbank. Session-Cookie und Abo-Link enthalten die zufällige Objekt-ID plus ein geheimes Token, gespeichert wird davon nur der SHA-256-Hash bzw. das Token selbst.
- Passwörter werden nie im Klartext gespeichert (PBKDF2-SHA256, 100.000 Runden, Salt). Rate-Limit: 5 Fehlversuche pro Konto und 10 pro IP in 15 Minuten.
- Der Kalender-Link liegt in der Datenbank des Kontos, die nur der Worker lesen kann.
- Das Admin-Konto meldet sich mit einem signierten Cookie an, das nur für `/api/admin` gilt und nach 12 Stunden abläuft.
- Die Admin-Übersicht zeigt nur Kennungen und Nutzungszahlen (Logins, App-Öffnungen, Kalender-Abrufe), keine Termine und keine Links.
- **DSGVO:** Sobald andere Studierende Studo+ nutzen, bist du für deren Daten verantwortlich (Kennung, Stundenplan). Sinnvoll: eine kurze Datenschutzerklärung in der App und nur Leute einladen, die du kennst. *Konto und Daten löschen* entfernt alles eines Kontos sofort.
- Der Abo-Link enthält ein 192-Bit-Zufallstoken und kann in den Einstellungen jederzeit erneuert werden.
