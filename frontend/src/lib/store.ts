import { create } from "zustand";
import type { Brief } from "./types";

type Draft = {
  brief: Brief | null;
  swipes: Record<string, string>;
  setBrief: (b: Brief) => void;
  patchBrief: (p: Partial<Brief>) => void;
  swipe: (id: string, choice: "a" | "b") => void;
  resetSwipes: () => void;
};

const saved = (() => {
  try {
    return JSON.parse(sessionStorage.getItem("tripzy:draft") || "null");
  } catch {
    return null;
  }
})();

export const useDraft = create<Draft>((set, get) => {
  const persist = () => {
    try {
      sessionStorage.setItem("tripzy:draft", JSON.stringify({ brief: get().brief, swipes: get().swipes }));
    } catch {
      /* ignore */
    }
  };
  return {
    brief: saved?.brief ?? null,
    swipes: saved?.swipes ?? {},
    setBrief: (b) => (set({ brief: b }), persist()),
    patchBrief: (p) => (set({ brief: { ...(get().brief as Brief), ...p } }), persist()),
    swipe: (id, c) => (set({ swipes: { ...get().swipes, [id]: c } }), persist()),
    resetSwipes: () => (set({ swipes: {} }), persist()),
  };
});
