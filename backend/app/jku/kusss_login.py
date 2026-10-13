"""Optional: Headless-Login bei KUSSS über den JKU-SSO (Playwright).

Wofür?
  1. Beim ersten App-Login prüfen, ob die JKU-Zugangsdaten stimmen.
  2. Den privaten iCal-Link automatisch aus KUSSS auslesen, damit du ihn nicht
     selbst kopieren musst.
  3. Später: Daten holen, die es nicht als iCal gibt (Noten, Anmeldungen, Moodle-Abgaben).

Wichtig:
  - Die Selektoren unten sind bewusst generisch, weil sich die Login-Seite des JKU-IdP
    ändern kann. Beim ersten Ausprobieren mit `headless=False` zusehen und ggf. anpassen.
  - Kein Brute-Force, keine parallelen Logins, max. ein Login pro Sync. Die Nutzung ist
    für deinen eigenen Account gedacht; halte dich an die Benutzungsordnung der JKU.
  - MFA: Verlangt der IdP einen zweiten Faktor, kann ein Headless-Login nicht
    automatisch durchlaufen. Dann bleibt der iCal-Link der Weg für den Sync.

Installation:  pip install playwright && playwright install chromium
"""
import re
from dataclasses import dataclass

from .. import config


class LoginError(RuntimeError):
    pass


@dataclass
class KusssSession:
    cookies: list[dict]          # nur im RAM halten, nicht persistieren
    ical_url: str | None


USER_SELECTORS = ["input[name=j_username]", "input[name=username]", "#username",
                  "input[type=email]", "input[autocomplete=username]"]
PASS_SELECTORS = ["input[name=j_password]", "input[name=password]", "#password",
                  "input[type=password]"]
SUBMIT_SELECTORS = ["button[type=submit]", "input[type=submit]", "button[name=_eventId_proceed]"]


async def _fill_first(page, selectors: list[str], value: str) -> None:
    for sel in selectors:
        loc = page.locator(sel).first
        if await loc.count():
            await loc.fill(value)
            return
    raise LoginError(f"Kein Eingabefeld gefunden ({selectors[0]} …). Login-Seite geändert?")


async def login(username: str, password: str, *, headless: bool = True,
                find_ical: bool = True) -> KusssSession:
    try:
        from playwright.async_api import async_playwright
    except ImportError as e:
        raise LoginError("Playwright ist nicht installiert (siehe requirements.txt).") from e

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=headless)
        ctx = await browser.new_context(locale="de-AT")
        page = await ctx.new_page()
        try:
            # KUSSS leitet für den Login an den JKU-Identity-Provider weiter.
            await page.goto(f"{config.KUSSS_BASE}/index.action", wait_until="domcontentloaded")
            login_link = page.get_by_role("link", name=re.compile("anmelden|login", re.I)).first
            if await login_link.count():
                await login_link.click()
                await page.wait_for_load_state("domcontentloaded")

            await _fill_first(page, USER_SELECTORS, username)
            await _fill_first(page, PASS_SELECTORS, password)
            for sel in SUBMIT_SELECTORS:
                if await page.locator(sel).first.count():
                    await page.locator(sel).first.click()
                    break
            await page.wait_for_load_state("networkidle", timeout=30_000)

            # Erfolg = wir sind zurück auf KUSSS und sehen einen Logout-Link.
            logged_in = await page.get_by_text(re.compile("abmelden|logout", re.I)).count()
            if "kusss" not in page.url or not logged_in:
                raise LoginError("Anmeldung fehlgeschlagen (falsche Daten oder MFA erforderlich).")

            ical_url = await _find_ical_url(page) if find_ical else None
            return KusssSession(cookies=await ctx.cookies(), ical_url=ical_url)
        finally:
            await browser.close()


async def _find_ical_url(page) -> str | None:
    """Sucht auf der Kalender-Seite nach dem veröffentlichten iCal-Link.

    Pfad und Linktext bitte im echten KUSSS prüfen; wir suchen tolerant nach
    Links/Textfeldern, die auf .ics bzw. 'published-calendar' zeigen.
    """
    cal = page.get_by_role("link", name=re.compile("kalender", re.I)).first
    if await cal.count():
        await cal.click()
        await page.wait_for_load_state("networkidle")
    html = await page.content()
    m = re.search(r"(https?://[^\s\"'<>]*(?:published-calendar|\.ics)[^\s\"'<>]*)", html)
    return m.group(1).replace("&amp;", "&") if m else None
