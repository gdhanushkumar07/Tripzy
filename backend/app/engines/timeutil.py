from datetime import date, timedelta

WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def to_min(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def fmt(minutes: float) -> str:
    m = int(round(minutes))
    m = max(0, m)
    return f"{(m // 60) % 24:02d}:{m % 60:02d}" if m < 24 * 60 else f"{m // 60 - 24:02d}:{m % 60:02d}+1"


def round5(x: float) -> int:
    return int(5 * round(x / 5))


def ceil5(x: float) -> int:
    v = int(x)
    if v < x:
        v += 1
    return v + (-v) % 5


def parse_date(s: str) -> date:
    return date.fromisoformat(s)


def day_dates(start: str, n: int) -> list[date]:
    d0 = parse_date(start)
    return [d0 + timedelta(days=i) for i in range(n)]


def windows(place: dict) -> list[tuple[int, int]]:
    return [(to_min(a), to_min(b)) for a, b in place.get("hours", [["00:00", "23:59"]])]


def overlaps(s: int, e: int, win) -> bool:
    if not win:
        return False
    a, b = to_min(win[0]), to_min(win[1])
    return s < b and e > a
