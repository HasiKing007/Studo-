"""Raumangaben aus KUSSS in (Gebäude, Raum) zerlegen.

KUSSS liefert Orte als Kurzcodes, z. B. "HS 1", "K 224B", "S3 048", "T 911".
Die Zuordnung Präfix -> Gebäude unten ist ein Startpunkt und sollte mit den echten
Daten aus deinem Kalender abgeglichen und ergänzt werden (unbekannte Präfixe werden
unverändert angezeigt, es geht also nichts verloren).
"""
import re

# Präfix (Großbuchstaben, ohne Leerzeichen) -> Gebäudename
BUILDINGS = {
    "HS": "Hörsaaltrakt",
    "K": "Keplergebäude",
    "KEP": "Keplergebäude",
    "S1": "Science Park 1",
    "S2": "Science Park 2",
    "S3": "Science Park 3",
    "S4": "Science Park 4",
    "S5": "Science Park 5",
    "T": "TNF-Turm",
    "TNF": "TNF-Turm",
    "MT": "Managementzentrum",
    "MZ": "Managementzentrum",
    "UC": "Uni-Center",
    "LC": "Learning Center",
    "BA": "Bankengebäude",
    "JUR": "Juridicum",
    "HF": "Hochschulfondsgebäude",
}

# Hörsäle heißen auch im Keplergebäude "HS x" – sie bleiben als "HS x" lesbar.
_HS = re.compile(r"^\s*(HS|Hörsaal)\s*(\d+[A-Z]?)\s*$", re.I)
_CODE = re.compile(r"^\s*([A-Za-z]{1,3}\d?)[\s\-_]*([0-9][0-9A-Za-z.\-]*)\s*$")
_ONLINE = re.compile(r"(online|zoom|teams|webex|digital)", re.I)


def parse_room(raw: str | None) -> tuple[str | None, str | None]:
    """Gibt (gebäude, raum) zurück. Beide können None sein."""
    if not raw:
        return None, None
    text = " ".join(raw.replace("\\,", ",").split())

    if _ONLINE.search(text):
        return "Online", text

    # Mehrteilige Angaben wie "Keplergebäude, HS 1" -> rechten Teil als Raum parsen
    if "," in text:
        left, right = [p.strip() for p in text.split(",", 1)]
        b, r = parse_room(right)
        return (b if b and b != right else left), (r or right)

    if m := _HS.match(text):
        return "Hörsaaltrakt", f"HS {m.group(2).upper()}"

    if m := _CODE.match(text):
        prefix, number = m.group(1).upper(), m.group(2)
        if prefix in BUILDINGS:
            return BUILDINGS[prefix], f"{prefix} {number}"

    return None, text


def format_room(building: str | None, room: str | None) -> str:
    if building and room:
        return f"{building} · {room}"
    return room or building or ""
