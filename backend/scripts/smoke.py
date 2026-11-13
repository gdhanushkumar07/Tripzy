"""Print a composed trip for eyeballing. Usage: python scripts/smoke.py "Hyderabad 3 days with parents veg Dec 18" """
import sys, time
sys.path.insert(0, ".")
from app.engines.brief import parse_rules
from app.engines import trip as T
from app.engines.weather import forecast
from app.engines.timeutil import day_dates
text = sys.argv[1] if len(sys.argv) > 1 else "Hyderabad, 3 days, with my parents, veg, Dec 18"
swipes = dict(a.split("=") for a in sys.argv[2:]) if len(sys.argv) > 2 else {"c1": "a", "c3": "a", "c4": "a", "c6": "b", "c9": "a"}
t0 = time.time()
b = parse_rules(text).model_dump()
c = T.init_capsule(b, swipes)
ctx = T.build_ctx(c)
dates = [d.isoformat() for d in day_dates(b["start_date"], b["days"])]
c["weather"] = forecast(b["city"], *T.CITIES[b["city"]]["center"], dates)
c["stay"] = T.stay_options(c, ctx)[0]
T.compose(c)
for d in c["days"]:
    v = d["verify"]
    print(f"\n== Day {d['index']+1} {d['date']} {d['weekday']} score={v['score']} energy={v['energy']['pct']}% cost={d['cost']} travel={v['travel_share']}%")
    for bl in d["blocks"]:
        if bl["kind"] == "leg":
            print(f"     ~ {bl['mode']} {bl['minutes']}m (+{bl['buffer']})")
        else:
            print(f"  {bl['start']}-{bl['end']} [{bl['kind']}] {bl['name']} e={bl.get('energy')} {('wait=' + str(bl['wait'])) if bl.get('wait') else ''} pb={list((bl.get('plan_b') or {}).keys())}")
    for ch in v["checks"]:
        if ch["level"] != "ok":
            print("    !", ch["level"], ch["text"])
print("\nnotes:", c["notes"], "| planned Rs", c["budget"]["planned_total"], "|", round(time.time() - t0, 1), "s")
