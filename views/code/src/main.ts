// Code: your workspace as VS Code's workbench. Frames are folders and tiles are files in the
// explorer; each editor tab is a tile, shown live; the panel holds problems, output and terminals.
import { applyThemeVars, connect } from "@hivemind/view-sdk";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const hm = await connect();
applyThemeVars(hm);
createRoot(document.getElementById("root")!).render(createElement(App, { hm }));
