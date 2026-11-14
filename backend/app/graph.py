"""Compose pipeline as a LangGraph StateGraph.

The structure is adapted from PlannerAgent (SuperLuJC/PlannerAgent): a
linear multi-agent graph whose per-node updates stream to the UI over SSE.
Tripzy keeps the LLM out of anything with a clock or a map in it. The nodes
are deterministic engines, and the LLM (optional) only reads the
traveller's words in the brief parser.

understand -> profile -> weather -> discover -> stay -> schedule -> shadow -> verify -> package
"""

from __future__ import annotations

from typing import Any, TypedDict

from langgraph.graph import END, StateGraph

from . import store
from .data.cities import CITIES, PLACE_BY_ID
from .engines import dna as D
from .engines import trip as T
from .engines.timeutil import day_dates
from .engines.weather import forecast


class ComposeState(TypedDict, total=False):
    profile: dict | None
    brief: dict
    swipes: dict
    travellers: list
    stay_id: str | None
    capsule: dict
    step: dict


def _step(agent: str, title: str, detail: str) -> dict:
    return {"agent": agent, "title": title, "detail": detail}


def understand(s: ComposeState) -> dict:
    b = s["brief"]
    if b.get("city") not in CITIES:
        raise ValueError("Unsupported city. Try Hyderabad or Jaipur.")
    party = {"solo": "solo", "couple": "a couple", "friends": "friends", "family": "family",
             "parents": "with parents"}[b["party"]]
    return {"step": _step("Brief Agent", "Understood your trip",
                          f"{CITIES[b['city']]['name']} · {b['days']} days from {b['start_date']} · {party}"
                          + (f" · {b['diet']}" if b.get("diet") != "any" else ""))}


def profile(s: ComposeState) -> dict:
    c = T.init_capsule(s["brief"], s.get("swipes") or {}, {"travellers": s.get("travellers")}, s.get("profile"))
    eb = D.energy_budget(c["dna"], c["travellers"], c["constraints"])
    src = "from your saved Travel DNA" if (s.get("profile") and not s.get("swipes")) else "from this trip's swipes"
    return {"capsule": c, "step": _step("Profile Agent", f"Trip DNA ready ({src})",
                                        " · ".join(c["dna_summary"]) + f". {eb['explain']}.")}


def weather(s: ComposeState) -> dict:
    c = s["capsule"]
    dates = [d.isoformat() for d in day_dates(c["brief"]["start_date"], c["brief"]["days"])]
    lat, lon = CITIES[c["city_key"]]["center"]
    c["weather"] = forecast(c["city_key"], lat, lon, dates)
    parts = [f"{d[5:]}: {w['tmax']:.0f}°C, rain {w['rain_prob']}%" for d, w in c["weather"].items()]
    src = next(iter(c["weather"].values()))["source"]
    return {"capsule": c, "step": _step("Live Watcher", "Weather checked", "; ".join(parts) + f" ({src})")}


def discover(s: ComposeState) -> dict:
    c = s["capsule"]
    ctx = T.build_ctx(c)
    ranked = T.ranked_places(c, ctx)
    c["discover"] = ranked
    top = ", ".join(f"{r['name']} {r['match']}%" for r in ranked[:3])
    return {"capsule": c, "step": _step("Discovery Agent", f"Ranked {len(ranked)} verified places",
                                        f"Top DNA matches: {top}")}


def stay(s: ComposeState) -> dict:
    c = s["capsule"]
    ctx = T.build_ctx(c)
    opts = T.stay_options(c, ctx)
    chosen = next((o for o in opts if o["id"] == s.get("stay_id")), opts[0])
    c["stay_options"], c["stay"] = opts, chosen
    return {"capsule": c, "step": _step("Route Agent", f"Best base: {chosen['name']}",
                                        f"~{chosen['avg_minutes']} min average to your top places "
                                        f"({T.matrix_source(c['city_key']).upper()} road times)")}


def schedule(s: ComposeState) -> dict:
    c = s["capsule"]
    T.compose_days(c)
    n = sum(1 for d in c["days"] for b in d["blocks"] if b["kind"] == "place")
    return {"capsule": c, "step": _step("Planner Agent", f"{len(c['days'])} days composed",
                                        f"{n} stops placed at their best time of day, with meals and rests by energy")}


def shadow(s: ComposeState) -> dict:
    c = s["capsule"]
    T.finish(c, plan_b=True, verify=False)
    n = sum(1 for d in c["days"] for b in d["blocks"] if b.get("plan_b"))
    return {"capsule": c, "step": _step("Shadow Agent", "Plan B computed",
                                        f"{n} stops have a ready rain / crowd / tired alternative")}


def verify(s: ComposeState) -> dict:
    c = s["capsule"]
    T.finish(c, plan_b=False, verify=True)
    scores = ", ".join(f"Day {d['index'] + 1}: {d['verify']['score']}" for d in c["days"])
    return {"capsule": c, "step": _step("Time-Truth Agent", "Feasibility verified",
                                        f"{scores}. Hours, closures, transit and energy all checked.")}


def package(s: ComposeState) -> dict:
    c = s["capsule"]
    store.save(c)
    notes = (" " + " ".join(c["notes"])) if c["notes"] else ""
    return {"capsule": c, "step": _step("Capsule Agent", "Trip Capsule saved",
                                        f"Planned spend ~Rs {c['budget']['planned_total']:,} incl. stay.{notes}")}


def build_graph():
    g = StateGraph(ComposeState)
    order = [("understand", understand), ("profile", profile), ("weather", weather), ("discover", discover),
             ("stay", stay), ("schedule", schedule), ("shadow", shadow), ("verify", verify), ("package", package)]
    for name, fn in order:
        g.add_node(name, fn)
    g.set_entry_point("understand")
    for (a, _), (b, _) in zip(order, order[1:]):
        g.add_edge(a, b)
    g.add_edge("package", END)
    return g.compile()


GRAPH = build_graph()


def run_stream(inputs: dict[str, Any]):
    """Yields (node, step, capsule|None) as each agent finishes."""
    for update in GRAPH.stream(inputs, stream_mode="updates"):
        for node, val in update.items():
            yield node, val.get("step"), val.get("capsule") if node == "package" else None


__all__ = ["run_stream", "PLACE_BY_ID"]
