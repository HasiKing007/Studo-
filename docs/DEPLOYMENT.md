# Studo+ online stellen (Fly.io) und aufs iPhone holen

Nach der Einrichtung läuft Studo+ unter **https://studo-plus-hasiking.fly.dev**: immer an, mit HTTPS und persistentem Speicher. Jeder Merge auf `main` deployt automatisch (GitHub Actions → `.github/workflows/deploy.yml`).

## Einmalig (ca. 10 Minuten)

1. **Fly.io-Account anlegen:** https://fly.io/app/sign-up. Fly verlangt eine Kreditkarte. Eine kleine, immer laufende Maschine (256 MB RAM, 1 GB Speicher) kostet erfahrungsgemäß ein paar Euro im Monat (aktuelle Preise: https://fly.io/docs/about/pricing/).
2. **Token erzeugen:** Fly-Dashboard → *Tokens* → *Create Org Token* für die Organisation `personal`. Den Token kopieren (beginnt mit `FlyV1 …`).
3. **Token in GitHub hinterlegen:** Repo `HasiKing007/Studo-` → *Settings* → *Secrets and variables* → *Actions* → *New repository secret*
   - Name: `FLY_API_TOKEN`
   - Wert: der Token aus Schritt 2
4. **Deployment starten:** Repo → *Actions* → *Test & Deploy* → *Run workflow* (Branch `main`). Der erste Lauf legt automatisch die App, den Speicher und den Verschlüsselungs-Schlüssel an.
5. **Sofort selbst anmelden:** https://studo-plus-hasiking.fly.dev öffnen und mit deinem JKU-Benutzernamen und einem Passwort anmelden. Der **erste Login richtet die Instanz ein** und legt das App-Passwort fest. Danach kann sich niemand anderes mehr anmelden.

> Das Server-Image enthält keinen Headless-Browser. Dein Passwort wird deshalb beim ersten Login nicht bei der JKU geprüft. Es ist dann einfach dein Passwort für Studo+. Für den Stundenplan braucht der Server dein JKU-Passwort nicht.

## Stundenplan verbinden

1. In KUSSS den persönlichen Kalender-Export-Link kopieren (*Mein Kalender* → *Kalender exportieren/abonnieren*, den genauen Menüpfad bitte selbst prüfen).
2. In Studo+ unter *Einstellungen → KUSSS-Kalender* einfügen und *Link speichern* tippen. Der erste Sync startet sofort, danach alle 30 Minuten.

## Aufs iPhone

1. Die Adresse in **Safari** öffnen → *Teilen* → *Zum Home-Bildschirm*. Studo+ startet danach wie eine App.
2. In der App: Tab *Kalender* → *In Apple Kalender abonnieren* → *Abonnieren*.
3. Apple Kalender holt die Termine ab jetzt selbst vom Server, auch wenn die App nie geöffnet wird. Wie oft, stellst du unter *Einstellungen → Kalender → Accounts → Abrufen* ein.

## Falls etwas schiefgeht

- Logs: Fly-Dashboard → App → *Monitoring*, oder lokal `fly logs -a studo-plus-hasiking`.
- Ist der App-Name schon vergeben, in `fly.toml` den Namen `studo-plus-hasiking` an beiden Stellen ändern.
- Instanz zurücksetzen (z. B. Passwort vergessen): in der App *Einstellungen → Verbindung trennen*, oder `fly ssh console -a studo-plus-hasiking -C "rm /data/studo.db"` und danach `fly apps restart studo-plus-hasiking`.
