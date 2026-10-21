// Packs the models and skies Archipelago draws, from the asset packs named in ASSETS.md, into the few
// small files the view ships: one glTF of every tile, building and tree (one shared texture), one
// glTF per worker with only the animations it plays, and two skies cut down to light the scene.
//
//   node packages/archipelago/views/archipelago/assets/make.mjs <KayKit-Medieval-Hexagon-Pack-1.0> <KayKit-Character-Pack-Adventures-1.0> <polyhaven folder>
//
// It reads the packs as data; nothing in them runs.
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { dedup, mergeDocuments, meshopt, prune, resample, unpartition, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [hexPack, charPack, skies] = process.argv.slice(2);
if (!hexPack || !charPack || !skies) throw new Error("usage: make.mjs <hex pack> <character pack> <polyhaven folder>");
const OUT = path.dirname(new URL(import.meta.url).pathname);
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });

// ── the kit: tiles, nature, buildings, props ────────────────────────────────
const HEX = path.join(hexPack, "addons/kaykit_medieval_hexagon_pack/Assets/gltf");
const COLOURS = ["blue", "green", "red", "yellow"];
const BUILDINGS = ["home_A", "home_B", "tavern", "market", "windmill", "well", "church", "blacksmith", "castle"];
const kit = [
  "tiles/base/hex_grass",
  ...["trees_A_large", "trees_A_medium", "trees_A_small", "trees_B_large", "trees_B_medium", "tree_single_A", "tree_single_B",
    "rock_single_A", "rock_single_C", "rock_single_E", "hills_A_trees", "hills_B", "mountain_A_grass_trees", "mountain_B_grass",
    "cloud_big", "cloud_small", "waterlily_A", "waterplant_A"].map((n) => `decoration/nature/${n}`),
  ...["building_stage_A", "building_stage_B", "building_stage_C", "building_scaffolding", "building_dirt", "building_grain", "building_bridge_A"].map((n) => `buildings/neutral/${n}`),
  ...COLOURS.flatMap((c) => BUILDINGS.map((b) => `buildings/${c}/building_${b}_${c}`)),
  ...[...COLOURS.map((c) => `flag_${c}`), "barrel", "crate_A_big", "sack", "resource_lumber", "resource_stone", "wheelbarrow", "tent", "ladder"].map((n) => `decoration/props/${n}`),
];
const doc = new Document();
for (const name of kit) mergeDocuments(doc, await io.read(path.join(HEX, `${name}.gltf`)));
// One scene; every model a top-level node named for it.
const [scene, ...more] = doc.getRoot().listScenes();
for (const s of more) { for (const n of s.listChildren()) scene.addChild(n); s.dispose(); }
await doc.transform(dedup(), prune(), weld(), unpartition(), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
await io.write(path.join(OUT, "kit.glb"), doc);

// ── the workers ─────────────────────────────────────────────────────────────
// The four share one rig, so their meshes ship without animations and the animations ship once.
const CHARS = path.join(charPack, "addons/kaykit_character_pack_adventures/Characters/gltf");
/** What each one holds while it works. */
const TOOLS = { Barbarian: "1H_Axe", Knight: "1H_Sword", Mage: "1H_Wand", Rogue: "Knife" };
/** An animation and everything it holds: disposing it alone leaves its samplers and their data. */
const drop = (a) => { for (const c of a.listChannels()) c.dispose(); for (const s of a.listSamplers()) s.dispose(); a.dispose(); };
const people = new Document();
for (const [who, tool] of Object.entries(TOOLS)) {
  const d = await io.read(path.join(CHARS, `${who}.glb`));
  for (const a of d.getRoot().listAnimations()) drop(a);
  // Hands hold only the tool; hats and capes stay.
  for (const n of d.getRoot().listNodes()) {
    const parent = n.getParentNode()?.getName() ?? "";
    if (n.getMesh() && parent.startsWith("handslot") && n.getName() !== tool) { n.getMesh().dispose(); n.dispose(); }
  }
  const root = d.getRoot().listScenes()[0].listChildren();
  for (const n of root) n.setName(`${who}:${n.getName()}`);
  mergeDocuments(people, d);
}
{
  const [s0, ...rest] = people.getRoot().listScenes();
  for (const s of rest) { for (const n of s.listChildren()) s0.addChild(n); s.dispose(); }
}
// The moves: how each of them works, then walking, standing, sitting by the fire and cheering.
const MOVES = { Walk: "Walking_A", Idle: "Idle", Sit: "Sit_Floor_Idle", Cheer: "Cheer", Chop: "1H_Melee_Attack_Chop", Cast: "Spellcasting", Use: "Interact" };
const moves = await io.read(path.join(CHARS, "Barbarian.glb"));
const want = new Map(Object.entries(MOVES).map(([k, v]) => [v, k]));
for (const a of moves.getRoot().listAnimations()) { if (want.has(a.getName())) a.setName(want.get(a.getName())); else drop(a); }
await moves.transform(resample({ tolerance: 0.001 }));
// A channel that only ever holds the rest pose says nothing.
const rest = (n, p) => (p === "translation" ? n.getTranslation() : p === "rotation" ? n.getRotation() : n.getScale());
for (const a of moves.getRoot().listAnimations()) {
  for (const c of a.listChannels()) {
    const out = c.getSampler().getOutput(), n = c.getTargetNode(), base = rest(n, c.getTargetPath());
    const k = base.length, arr = out.getArray();
    let still = true;
    for (let i = 0; i < arr.length && still; i++) still = Math.abs(arr[i] - base[i % k]) < 1e-4;
    if (still) { const sm = c.getSampler(); c.dispose(); sm.dispose(); }
  }
}
for (const m of moves.getRoot().listMeshes()) m.dispose();
for (const sk of moves.getRoot().listSkins()) sk.dispose();
await people.transform(prune(), dedup(), unpartition(), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
await io.write(path.join(OUT, "workers.glb"), people);
await moves.transform(prune({ keepLeaves: true }), unpartition(), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
await io.write(path.join(OUT, "moves.glb"), moves);

// ── the skies: equirectangular light, cut to 256 by 128 ─────────────────────
/** A Radiance .hdr (run-length RGBE) as floats. */
function readHdr(buf) {
  let p = 0;
  const line = () => { let s = ""; while (buf[p] !== 0x0a) s += String.fromCharCode(buf[p++]); p++; return s; };
  for (let l = line(); l !== ""; l = line());
  const [, h, , w] = line().split(" ").map(Number);
  const out = new Float32Array(w * h * 3);
  const scan = new Uint8Array(w * 4);
  for (let y = 0; y < h; y++) {
    if (buf[p] !== 2 || buf[p + 1] !== 2) throw new Error("only run-length .hdr files");
    p += 4;
    for (let c = 0; c < 4; c++) {
      for (let x = 0; x < w;) {
        let n = buf[p++];
        if (n > 128) { n -= 128; const v = buf[p++]; while (n--) scan[c * w + x++] = v; } else { while (n--) scan[c * w + x++] = buf[p++]; }
      }
    }
    for (let x = 0; x < w; x++) {
      const e = scan[3 * w + x], f = e ? Math.pow(2, e - 136) : 0;
      for (let c = 0; c < 3; c++) out[(y * w + x) * 3 + c] = scan[c * w + x] * f;
    }
  }
  return { w, h, data: out };
}
/** Floats as a flat (not run-length) Radiance .hdr. */
function writeHdr({ w, h, data }) {
  const head = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`, "latin1");
  const px = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2], m = Math.max(r, g, b);
    if (m < 1e-32) continue;
    const e = Math.ceil(Math.log2(m) + 1e-9), s = 256 / Math.pow(2, e);
    px.set([Math.min(255, r * s), Math.min(255, g * s), Math.min(255, b * s), e + 128], i * 4);
  }
  return Buffer.concat([head, px]);
}
function shrink(img, w, h) {
  const out = new Float32Array(w * h * 3), kx = img.w / w, ky = img.h / h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 3;
    for (let j = 0; j < ky; j++) for (let i = 0; i < kx; i++) {
      const s = ((y * ky + j) * img.w + x * kx + i) * 3;
      for (let c = 0; c < 3; c++) out[o + c] += img.data[s + c] / (kx * ky);
    }
  }
  return { w, h, data: out };
}
for (const [name, file] of [["day", "kloofendal_48d_partly_cloudy_puresky.hdr"], ["night", "kloppenheim_02_puresky.hdr"]]) {
  writeFileSync(path.join(OUT, `sky-${name}.hdr`), writeHdr(shrink(readHdr(readFileSync(path.join(skies, file))), 256, 128)));
}
console.log("made", path.relative(process.cwd(), OUT));
