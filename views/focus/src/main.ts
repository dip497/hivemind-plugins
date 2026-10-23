// Focus: your agents, one at a time. Every agent, grouped by what it needs from you, and beside the
// list the live terminal of whoever has waited longest, with a box for its next task. Drawn in the
// app's own design system (apps/desktop/DESIGN.md), with React and Tailwind.
import { applyThemeVars, connect } from "@hivemind/view-sdk";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const hm = await connect();
applyThemeVars(hm);
createRoot(document.getElementById("root")!).render(createElement(App, { hm }));
