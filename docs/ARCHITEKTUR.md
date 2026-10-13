# Studo+ – Architektur, Entwicklungsplan & Sicherheitskonzept

Persönliche Uni-App für die JKU Linz: Stundenplan aus KUSSS, Anwesenheitspflicht pro Kurs oder Termin, abonnierbarer Apple-Kalender, Schnellzugriffe, installierbar als iOS-PWA.

> **Stand:** Startcode läuft (Demo-Modus getestet, 5 Kern-Tests grün). Die echten JKU-Endpunkte konnte ich von hier aus nicht erreichen. Alles, was KUSSS/Moodle-URLs oder Login-Formulare betrifft, ist mit **„prüfen“** markiert und muss einmal gegen die echten Seiten abgeglichen werden.

---

## 1. Architektur-Überblick

```
 iPhone (Safari / Home-Bildschirm)          Apple Kalender (iPhone, iPad, Mac)
 ┌──────────────────────────────┐           ┌──────────────────────────────┐
 │ PWA: index.html, app.js,     │           │ Abo: webcal://…/cal/<token>  │
 │ styles.css, sw.js, manifest  │           │ (fragt alle 15 min – 1 h ab) │
 └──────────────┬───────────────┘           └──────────────┬───────────────┘
        HTTPS + Session-Cookie                 HTTPS, geheimes Token in URL
                └──────────────┬───────────────────────────┘
                     ┌─────────▼─────────┐
                     │  FastAPI-Backend   │  (ein Prozess, ein Nutzer)
                     │  ─ auth.py         │  App-Login, Sessions, Rate-Limit
                     │  ─ sync.py         │  Abgleich + Änderungserkennung
                     │  ─ ics_feed.py     │  dynamischer .ics-Feed
                     │  ─ rooms.py        │  Raum-Parser
                     │  ─ crypto.py       │  Fernet + scrypt
                     └───┬───────────┬───┘
                 SQLite  │           │  alle 30 min (Hintergrund-Task)
          ┌──────────────▼──┐   ┌────▼───────────────────────────────────┐
          │ studo.db        │   │ JKU-Quellen                             │
          │ events,         │   │ ① KUSSS-iCal-Export (empfohlen, Token)  │
          │ course_settings │   │ ② Headless-Login via JKU-SSO (optional, │
          │ event_overrides │   │    Playwright) – für Login-Prüfung,     │
          │ settings (verschl.)│ │    Link-Ermittlung, spätere Features   │
          └─────────────────┘   └────────────────────────────────────────┘
```

### Tech-Stack (Empfehlung)

| Schicht | Wahl | Warum |
|---|---|---|
| Backend | **FastAPI** + Uvicorn (Python 3.11+) | async (Sync läuft parallel zur API), Pydantic-Validierung, wenig Boilerplate |
| Speicher | **SQLite** (WAL-Modus), kein ORM | Ein Nutzer, wenige Tabellen; eine Datei, leicht zu sichern |
| Kalender | **icalendar** | Parsen des KUSSS-Exports *und* Erzeugen des eigenen Feeds |
| HTTP | **httpx** | async, sauberes Timeout-/Redirect-Handling |
| Scraping (optional) | **Playwright** (Chromium headless) | JKU-SSO ist ein mehrstufiger SAML/JS-Flow; ein echter Browser ist robuster als nachgebaute Requests |
| Kryptografie | **cryptography (Fernet)** + `hashlib.scrypt` | Standardbibliotheken, keine Eigenbau-Krypto |
| Frontend | **HTML/CSS/JS ohne Framework**, ES-Module | Drei Tabs, wenig Zustand; kein Build-Schritt, schnell auf dem iPhone |
| Betrieb | Raspberry Pi / Heimserver / kleiner VPS + **Tailscale** oder **Caddy** (HTTPS) | PWA und Service Worker brauchen HTTPS; Apple Kalender muss den Feed erreichen |

Vue/React würde ich erst einführen, wenn die App deutlich wächst (Noten, Prüfungsanmeldung, Moodle-Abgaben).

---

## 2. Die vier Kernentscheidungen

### 2.1 Daten holen: iCal-Export vor Scraping

KUSSS kann deinen persönlichen Kalender als iCal-Link veröffentlichen (KUSSS → *Mein Kalender* → *Kalender exportieren/abonnieren*, **Menüpfad prüfen**). Der Link enthält ein geheimes Token und funktioniert ohne Login.

- **Vorteile:** kein Passwort nötig, kein Bruch bei UI-Änderungen, keine MFA-Probleme, minimale Last auf den Uni-Servern.
- **Das Backend** lädt diesen Link alle 30 Minuten, normalisiert die Termine und reichert sie an (Raum-Parser, Anwesenheitspflicht, Ausfall-Erkennung).
- **Headless-Browser** (Playwright) nur dort, wo es keine Alternative gibt: Prüfen der Zugangsdaten beim ersten App-Login, automatisches Auslesen des iCal-Links, später Noten/Anmeldungen. Siehe `backend/app/jku/kusss_login.py`.

Moodle bietet ebenfalls einen Kalender-Export (*Kalender → Exportieren → URL abrufen*), der genauso eingebunden werden kann (Abgabefristen). Die Moodle-Mobile-API (`/login/token.php`) funktioniert bei SSO-Instanzen meist nicht mit Benutzername/Passwort; dafür wäre der „Launch“-SSO-Flow der Moodle-App nötig – eher Phase 3.

### 2.2 SSO-Schnellzugriffe: was technisch geht und was nicht

**Ehrlich:** Session-Cookies von deinem Backend in den Browser für `kusss.jku.at` oder `moodle.jku.at` zu „injizieren“, geht nicht. Browser setzen Cookies nur für die Domain, die sie ausliefert (Same-Origin-Policy). Eine fremde Seite (deine App) kann keine Cookies für die JKU setzen, und Safari/ITP blockiert solche Tricks zusätzlich. Ein Reverse-Proxy, der KUSSS unter deiner Domain „durchreicht“, würde technisch funktionieren, ist aber ein Sicherheitsrisiko (du betreibst einen Man-in-the-Middle vor deinem Uni-Account) und verstößt sehr wahrscheinlich gegen die Benutzungsordnung. Davon rate ich klar ab.

**Was funktioniert und in der Praxis fast genauso gut ist:**

1. **IdP-Session nutzen.** KUSSS, Moodle und Co. melden sich alle über denselben JKU-Identity-Provider an. Bist du dort einmal eingeloggt (Häkchen „angemeldet bleiben“, falls angeboten), leitet jeder weitere Link ohne Passworteingabe durch. Die Schnellzugriffe in Studo+ sind deshalb normale Links auf die Login-Einstiegspunkte (`config.QUICK_LINKS`).
2. **iCloud-Schlüsselbund / Passwort-App** füllt die JKU-Anmeldung mit Face ID aus, falls die Session abgelaufen ist. Das ist ein Tippen, kein Tippen von Passwörtern.
3. **iOS-Besonderheit:** Eine Home-Bildschirm-PWA hat einen *eigenen* Cookie-Speicher, getrennt von Safari. Links zu fremden Domains öffnen in Safari (bzw. einem In-App-Browser-Overlay), wo deine normale Safari-Session gilt. Das ist für SSO sogar gut: Du loggst dich einmal in Safari ein und bleibst es.

### 2.3 Anwesenheitspflicht: Kurs-Standard + Ausnahmen

- `course_settings(course_id, attendance)` – Standard für alle Termine eines Kurses (Schalter auf der Karte).
- `event_overrides(uid, attendance)` – Ausnahme für einen einzelnen Termin (Karte antippen → „Wie Kurs / Ja / Nein“).
- Effektiver Wert = `COALESCE(override, kurs, 0)` (eine SQL-Abfrage, siehe `db.EFFECTIVE_ATTENDANCE_SQL`).
- `course_id` ist die LVA-Nummer (z. B. `336.100`); VL und UE eines Fachs haben unterschiedliche Nummern und damit getrennte Schalter. Genau das willst du meistens (UE mit Anwesenheitspflicht, VL ohne).

### 2.4 Abonnierbarer Kalender

`GET /cal/<token>.ics` erzeugt den Feed bei jedem Abruf frisch aus der DB, also immer aktuell. Damit Apple Kalender Änderungen zuverlässig übernimmt:

| Mechanismus | Umsetzung |
|---|---|
| Stabile UID | UID aus KUSSS wird übernommen → Apple ersetzt statt dupliziert |
| Änderungserkennung | Fingerprint (Zeit, Ort, Titel, Status) pro Termin; ändert er sich → `SEQUENCE+1`, `LAST-MODIFIED` neu |
| Ausfälle | Termin verschwindet aus KUSSS → bleibt im Feed als `STATUS:CANCELLED` mit „Entfällt:“ im Titel |
| Anwesenheitspflicht | wählbar: `! Analysis 1`, `🔴 Analysis 1` oder nur „Anwesenheitspflicht“ in den Notizen; zusätzlich `CATEGORIES` |
| Zeitzonen | Ausgabe in UTC (`…Z`): keine VTIMEZONE-Fehler bei Sommer-/Winterzeit |
| Aktualisierung | `REFRESH-INTERVAL`/`X-PUBLISHED-TTL` = 30 min als Hinweis. Das echte Intervall stellst du auf dem iPhone ein (*Einstellungen → Kalender → Accounts → Abrufen*); iOS fragt Abos grob alle 15 min bis 1 h ab, schneller geht es nicht |
| Abo starten | Button verlinkt `webcal://…` → iOS öffnet direkt „Kalenderabonnement hinzufügen“ |

---

## 3. Code-Kernstücke

### a) Dynamischer, abonnierbarer .ics-Feed

Vollständig in `backend/app/ics_feed.py` und `backend/app/main.py` (`calendar_feed`). Gekürzt:

```python
@app.get("/cal/{token}.ics")
def calendar_feed(token: str):
    expected = db.get_setting("feed_token") or ""
    if not expected or not hmac.compare_digest(token, expected):   # timing-sicher
        raise HTTPException(404)                                   # 404 statt 401: verrät nichts
    body = ics_feed.build_feed(db.get_setting("marker_style", "prefix"))
    return Response(body, media_type="text/calendar; charset=utf-8",
                    headers={"Cache-Control": "no-cache, max-age=0"})
```

```python
def build_feed(marker_style="prefix", past_days=30) -> bytes:
    rows = ...  # events JOIN course_settings LEFT JOIN event_overrides
    cal = Calendar()
    cal.add("prodid", "-//Studo+//JKU Stundenplan//DE"); cal.add("version", "2.0")
    cal.add("x-wr-calname", "JKU Stundenplan")
    cal.add("refresh-interval", timedelta(minutes=30), parameters={"VALUE": "DURATION"})
    for r in rows:
        title = r["title"] + (f" ({r['kind']})" if r["kind"] else "")
        if r["attendance"]: title = MARKERS[marker_style] + title     # "! Analysis 1 (UE)"
        if r["status"] == "cancelled": title = "Entfällt: " + title
        ev = Event()
        ev.add("uid", r["uid"]);           ev.add("sequence", r["sequence"])
        ev.add("summary", title);          ev.add("status", "CANCELLED" if ... else "CONFIRMED")
        ev.add("dtstart", ...); ev.add("dtend", ...)                   # UTC
        ev.add("location", "Keplergebäude · K 224B")                   # aus rooms.py
        ev.add("description", "Anwesenheitspflicht\nOrt laut KUSSS: K 224B")
        cal.add_component(ev)
    return cal.to_ical()
```

Die Änderungserkennung, die `sequence` hochzählt, steckt in `sync.apply()`.

### b) Uni-Authentifizierung sicher im Backend

Vollständig in `backend/app/auth.py`, `crypto.py`, `jku/kusss_login.py`. Der Ablauf:

```
Erster Login ─► Playwright: KUSSS → JKU-IdP → Formular ausfüllen → zurück auf KUSSS?
               ├─ nein ─► 401, Fehlversuch zählen (max. 5 / 15 min)
               └─ ja   ─► scrypt-Hash des Passworts speichern (lokale Logins)
                          iCal-Link auslesen → Fernet-verschlüsselt speichern
                          Passwort NUR wenn „für Sync merken“ → Fernet-verschlüsselt
                          Browser schließen, Cookies verwerfen
Spätere Logins ─► lokal gegen scrypt-Hash (kein Request an die JKU)
App-Session    ─► 256-bit Zufallstoken im Cookie (HttpOnly, Secure, SameSite=Strict),
                  in der DB nur SHA-256 davon, 30 Tage gültig
```

```python
async def login(username, password, remember_for_sync, client_ip):
    _rate_limit(client_ip)
    if owner and pw_hash and crypto.verify_password(password, pw_hash):
        verified = True                                   # schneller lokaler Pfad
    else:
        session = await kusss_login.login(username, password)   # echter JKU-Login
        if session.ical_url:
            db.set_setting("ical_url", crypto.encrypt(session.ical_url))
    db.set_setting("owner_pw_hash", crypto.hash_password(password))
    if remember_for_sync:
        db.set_setting("jku_password", crypto.encrypt(password))
```

Die Playwright-Selektoren sind absichtlich tolerant gehalten (mehrere Kandidaten für Benutzer-/Passwortfeld). Beim ersten echten Test `headless=False` setzen und zusehen, dann ggf. anpassen.

---

## 4. Sicherheitsrisiken & Gegenmaßnahmen

| Risiko | Gegenmaßnahme in Studo+ |
|---|---|
| **JKU-Passwort im Klartext gespeichert** | Standardmäßig wird es gar nicht gespeichert (iCal-Link reicht für den Sync). Wenn doch („merken“): Fernet-verschlüsselt; der Schlüssel liegt nur in `STUDO_MASTER_KEY` (Umgebung / systemd-Credential / macOS-Schlüsselbund), nie in DB oder Git |
| DB-Diebstahl (Backup, Laptop) | Ohne Master-Key sind Passwort und iCal-Link wertlos; Login-Passwort nur als scrypt-Hash |
| Feed-URL wird bekannt | Langes Zufallstoken (192 bit), timing-sicherer Vergleich, 404 bei falschem Token, „Abo-Link erneuern“ in den Einstellungen. Der Feed enthält nur Stundenplan-Daten, keine Zugangsdaten |
| Session-Diebstahl / XSS / CSRF | Cookie `HttpOnly`, `Secure`, `SameSite=Strict`; strikte Content-Security-Policy (`script-src 'self'`, keine Inline-Skripte); kein `innerHTML` mit Nutzerdaten |
| Brute-Force auf das App-Login | Max. 5 Fehlversuche pro IP / 15 min; Instanz akzeptiert nur den ersten verknüpften JKU-Account |
| Unverschlüsselte Übertragung | Betrieb nur hinter HTTPS (Tailscale Funnel oder Caddy mit Let's-Encrypt), HSTS aktiv |
| Server öffentlich im Internet | Am besten nur im Tailnet erreichbar; einzig `/cal/…` muss für Apple Kalender erreichbar sein (Tailscale Funnel nur für diesen Pfad, oder iPhone ist ohnehin im Tailnet) |
| Missbrauch / Sperre durch die JKU | Ein Abruf alle 30 min, keine parallelen Logins, eigener User-Agent, nur dein eigener Account. Benutzungsordnung der JKU/ZID beachten |
| MFA am JKU-IdP | Headless-Login kann MFA nicht automatisch lösen → Sync läuft unabhängig davon über den iCal-Link |
| Schlüssel-Verlust | Master-Key sicher notieren (Passwortmanager). Ohne Key: „Verbindung trennen“, neu anmelden |

**Grundsatz:** So wenig Geheimnisse wie möglich speichern. Der iCal-Link ist das einzige, das du für den Kern-Use-Case wirklich brauchst.

---

## 5. Entwicklungsplan

**Phase 0 – Startcode (erledigt)**
FastAPI-Backend, SQLite-Schema, iCal-Import, Raum-Parser, Sync mit Änderungs- und Ausfallerkennung, ICS-Feed, App-Login, PWA mit drei Tabs, Dark Mode, Icons aus deinem Logo, Demo-Modus, Kern-Tests.

**Phase 1 – An die echte JKU anschließen (nächster Schritt, bei dir lokal)**
1. In KUSSS den Kalender-Export-Link holen, in den Einstellungen eintragen, Sync prüfen.
2. Einen echten Export ansehen: Format von `SUMMARY` und `LOCATION` mit `clean_title()` / `rooms.BUILDINGS` abgleichen und die Gebäude-Tabelle ergänzen.
3. `kusss_login.py` einmal mit `headless=False` durchklicken und die Selektoren fixieren (oder ganz weglassen und nur den iCal-Link nutzen).
4. Moodle-Kalender-Export als zweite Quelle (Abgabefristen) – `sync.run_once()` auf mehrere Quellen erweitern.

**Phase 2 – Deployment & iPhone**
1. Auf Raspberry Pi/VPS deployen, HTTPS via Tailscale oder Caddy, `STUDO_BASE_URL` setzen.
2. iPhone: Safari → Teilen → „Zum Home-Bildschirm“. Kalender-Tab → „In Apple Kalender abonnieren“.
3. systemd-Service mit `Restart=always`, nächtliches Backup von `data/studo.db`.

**Phase 3 – Komfort**
Push-Benachrichtigung bei Raumänderung/Ausfall (Web Push funktioniert bei Home-Bildschirm-PWAs ab iOS 16.4), Noten-Übersicht und Prüfungstermine via Headless-Login, Moodle-Abgaben, Widget-artige „Nächster Termin“-Ansicht.

---

## 6. Projektstruktur

```
studo-plus/
├── run.sh                    Start (lädt .env)
├── requirements.txt
├── .env.example              Konfiguration inkl. Master-Key-Hinweis
├── backend/
│   ├── app/
│   │   ├── main.py           API-Routen, Feed-Endpoint, Static-Hosting, Security-Header
│   │   ├── auth.py           App-Login, Sessions, Rate-Limit, „Verbindung trennen“
│   │   ├── crypto.py         Fernet-Verschlüsselung, scrypt-Hashing, Tokens
│   │   ├── db.py             SQLite-Schema & Helfer
│   │   ├── sync.py           Abgleich, Fingerprints, SEQUENCE, Ausfälle, Hintergrund-Loop
│   │   ├── ics_feed.py       Erzeugung des Apple-Kalender-Feeds
│   │   ├── rooms.py          Raumcode → Gebäude + Raum
│   │   ├── demo.py           Beispieldaten (STUDO_DEMO=1)
│   │   └── jku/
│   │       ├── ical_source.py   KUSSS-iCal laden & parsen
│   │       └── kusss_login.py   optionaler Headless-Login (Playwright)
│   └── tests/test_core.py
├── frontend/                 PWA (index.html, app.js, styles.css, sw.js, manifest.json, icons/)
└── docs/                     dieses Dokument + Screenshots
```

## 7. Hinweise zum Design

Umgesetzt nach dem Gemini-Vorschlag: System-Schrift, flache Karten mit 1-px-Rahmen und 12-px-Radius, Orange `#D35400` nur für aktive Schalter, das „+“ und den aktiven Tab, echter Dark Mode (`#000` / `#1C1C1E`), sanftes Einblenden beim Tab-Wechsel.

- **Schalter & Haptik:** Safari (ab iOS 17.4/18) rendert `<input type="checkbox" switch>` als echten iOS-Schalter *mit* Taptic-Feedback. Eine JavaScript-API für die Taptic Engine gibt es in Safari nicht, daher ist der native Schalter der einzige Weg zu echter Haptik. Andere Browser bekommen einen nachgebauten Schalter.
- **App-Icon:** aus deinem Logo erzeugt, aber flach (ohne den Verlauf des Mockups), passend zur „keine Verläufe“-Regel. iOS rundet die Ecken selbst ab.
