// Focus: your agents, one at a time. A calm list of every agent, those waiting on you first, and
// beside it the live terminal of the one you pick, with a box to give it its next task. Built the
// way a shadcn/ui app is (React, Radix, Tailwind and the components in ui/), to show that a
// designer's components work in a view as they are.
import { applyThemeVars, connect } from "@hivemind/view-sdk";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const hm = await connect();
applyThemeVars(hm);
createRoot(document.getElementById("root")!).render(createElement(App, { hm }));
