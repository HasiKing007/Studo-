# Studo+

Uni-Organizer-App: Stundenplan automatisch aus KUSSS (JKU) oder per iCal-Link (andere Hochschulen), Kalender mit Tages- und Wochenansicht, Kurse nach Semester, Noten und Studienfortschritt (ECTS pro Studienrichtung), Anwesenheitspflicht als Zusatzfunktion, abonnierbarer Apple-Kalender, Schnellzugriffe, installierbar als iOS-PWA. Mehrere Nutzer:innen, jede:r mit eigenem Konto, plus eigenes Admin-Konto mit Nutzungsübersicht.

Architektur, Sicherheitskonzept und Entwicklungsplan: [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md)

Online stellen (kostenlos, Cloudflare) und aufs iPhone holen: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

## Zwei Backends

- `worker/` (JavaScript, Cloudflare Workers): **die Online-Version** mit Mehrbenutzer-Login, JKU-SSO, mehreren Hochschulen und Admin-Übersicht. Läuft kostenlos und immer erreichbar.
- `backend/` (Python, FastAPI): ältere Ein-Personen-Variante zum lokalen Ausprobieren. Sie kennt die neuen Endpunkte (Hochschulauswahl, Admin) nicht.

## Schnellstart (Demo, ohne JKU-Zugang)

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"   # in .env als STUDO_MASTER_KEY eintragen
# in .env: STUDO_DEMO=1
./run.sh
```

Dann http://localhost:8000 öffnen und mit beliebigem Benutzernamen/Passwort anmelden.

## Mit echter JKU

1. In `.env` `STUDO_DEMO=0` und `STUDO_BASE_URL` auf deine HTTPS-Adresse setzen.
2. In KUSSS den persönlichen Kalender-Export-Link kopieren und in der App unter *Einstellungen → KUSSS-Kalender* einfügen.
3. Optional für den Login mit JKU-Daten: `pip install playwright && playwright install chromium`.
4. Auf dem iPhone: Safari → Teilen → *Zum Home-Bildschirm*. Im Tab *Kalender* auf *In Apple Kalender abonnieren* tippen.

## Tests

```bash
cd backend && python -m pytest -q
```

## Sicherheit in Kürze

- `STUDO_MASTER_KEY` nie committen. Ohne ihn sind gespeicherte Geheimnisse nicht lesbar (Absicht).
- Nur über HTTPS betreiben, idealerweise nur im eigenen Tailnet.
- Der Abo-Link ist ein Geheimnis. Bei Verdacht in den Einstellungen erneuern.
