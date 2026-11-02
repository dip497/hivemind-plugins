// The Den pup drawn in 2D: a cartoon wolf pup seen from the side, its head turned a little toward
// you, in flat colour with one shade, a warm ink line and big shining eyes. drawPup(ctx, pose, i)
// draws frame i (0..7) of a pose into a 160 x 144 box (scale the context first to draw larger),
// standing on a ground line at y = 130, facing right, with room above it to jump.
//
// The body is a small rig: a body bean, a head, four stubby legs swinging from hips and shoulders,
// a tail, ears. Each pose says where they go frame by frame.

const INK = "#3b2a21";
const COAT = {
  base: "#a39484", shade: "#857566", saddle: "#6f6257", cream: "#f4ecdd", creamShade: "#ddd0bc",
  earIn: "#e9b9a8", nose: "#2b211c", eye: "#2a1b12", tongue: "#e7838a", mouth: "#5a2a2c",
  ball: "#cfe04a", ballShade: "#a9bd2c", shadow: "rgba(30,22,16,0.22)",
};
const TAU = Math.PI * 2;
const LINE = 2.1;

/** Every pose's frame i, as the rig's numbers. */
function rig(pose, i) {
  const ph = (i / 8) * TAU;
  const s = Math.sin(ph), c = Math.cos(ph);
  const r = {
    x: 0, y: 0, rot: 0, sx: 1, // the whole pup: offset, tilt about its middle, mirrored width (a spin)
    body: { x: 72, y: 82, rx: 29, ry: 18, rot: 0 },
    head: { x: 106, y: 58, r: 21, rot: 0 },
    legs: { fn: 0, ff: 0, bn: 0, bf: 0 }, // swing angles: front near/far, back near/far (radians)
    legLen: 19, sit: false, lie: false, back: false, bow: false,
    tail: { ang: -0.9, wag: 0 }, // up and back from the rump; wag adds to it
    ears: 0, // 0 up, 1 swept back
    eyes: "open", mouth: 0, tongue: false, ball: false, blink: false,
    shadow: 1, motion: 0,
  };
  switch (pose) {
    case "walk": {
      const a = 0.42;
      Object.assign(r.legs, { fn: a * s, ff: -a * s, bn: -a * s, bf: a * s });
      r.y = -1.2 * Math.abs(c);
      r.tail.wag = 0.18 * Math.sin(ph * 2);
      r.head.rot = 0.04 * s;
      break;
    }
    case "carry":
    case "run": {
      const trot = pose === "carry";
      const a = trot ? 0.55 : 0.95;
      // A gallop gathers and stretches: front pair together, back pair together, out of step.
      Object.assign(r.legs, trot
        ? { fn: a * s, ff: -a * s, bn: -a * s, bf: a * s }
        : { fn: a * s, ff: a * Math.sin(ph - 0.5), bn: -a * s, bf: -a * Math.sin(ph - 0.5) });
      r.y = trot ? -1.6 * Math.abs(c) : -4 * Math.max(0, Math.sin(ph + 0.6));
      r.rot = trot ? 0 : 0.08 * Math.sin(ph);
      r.body.rx = trot ? 29 : 31 + 2 * s;
      r.ears = trot ? 0.35 : 0.9;
      r.tail = { ang: trot ? -0.75 : -0.35, wag: (trot ? 0.2 : 0.08) * Math.sin(ph * 2) };
      r.mouth = trot ? 0.35 : 0.45;
      r.tongue = !trot;
      r.ball = trot;
      r.motion = trot ? 0 : 1;
      break;
    }
    case "ball":
    case "sit": {
      r.sit = true;
      r.body = { x: 74, y: 84, rx: 23, ry: 20, rot: -0.75 };
      r.head = { x: 92, y: 46, r: 21, rot: 0.03 * Math.sin(ph) };
      r.tail = { ang: 0.35, wag: 0.35 * Math.sin(ph * 2) };
      r.ball = pose === "ball";
      r.mouth = r.ball ? 0.35 : 0.15 + 0.1 * Math.max(0, s);
      r.tongue = !r.ball && s > 0.3;
      r.blink = !r.ball && i === 5;
      break;
    }
    case "sleep": {
      r.lie = true;
      const breath = 1 + 0.035 * Math.sin(ph);
      r.body = { x: 74, y: 96, rx: 33, ry: 14 * breath, rot: 0 };
      r.head = { x: 102, y: 92 - 1.2 * Math.sin(ph), r: 19, rot: 0.25 };
      r.tail = { ang: 2.6, wag: 0 };
      r.ears = 0.6;
      r.eyes = "closed";
      break;
    }
    case "beg": {
      // A play bow: chest down on its forearms, rump up, tail high and going.
      r.bow = true;
      r.body = { x: 70, y: 82, rx: 30, ry: 17, rot: 0.42 };
      r.head = { x: 103, y: 84, r: 21, rot: -0.18 };
      Object.assign(r.legs, { fn: 1.42, ff: 1.38, bn: -0.04, bf: 0.06 });
      r.legLen = 21;
      r.tail = { ang: -1.5, wag: 0.5 * Math.sin(ph * 2) };
      r.ears = 0.1;
      r.mouth = i % 4 < 2 ? 0.9 : 0.15;
      r.tongue = i % 4 < 2;
      break;
    }
    case "jump": {
      const air = [0, 0.45, 0.8, 1, 1, 0.8, 0.45, 0][i];
      r.y = -24 * air;
      const tuck = air > 0.3 ? 1 : 0;
      Object.assign(r.legs, tuck ? { fn: -0.9, ff: -0.7, bn: 0.9, bf: 0.7 } : { fn: 0.1, ff: -0.1, bn: -0.1, bf: 0.1 });
      r.rot = i < 4 ? -0.18 * air : 0.12 * air;
      r.ears = -0.4 * air;
      r.mouth = air > 0.3 ? 0.7 : 0.2;
      r.tongue = air > 0.3;
      r.tail = { ang: -1.1, wag: 0.3 * Math.sin(ph * 2) };
      r.shadow = 1 - 0.55 * air;
      r.eyes = air > 0.3 ? "happy" : "open";
      break;
    }
    case "shake": {
      // A wet-dog shake: the body wobbles side to side, fur flies, eyes screwed shut.
      r.rot = 0.12 * Math.sin(ph * 2);
      r.head.rot = -0.25 * Math.sin(ph * 2 + 0.6);
      r.x = 1.6 * Math.sin(ph * 2);
      r.tail.wag = 0.6 * Math.sin(ph * 2 + 1.2);
      r.ears = 0.5 + 0.5 * Math.sin(ph * 2 + 0.3);
      r.eyes = "squint";
      r.motion = 2;
      break;
    }
    case "roll": {
      r.back = true;
      r.body = { x: 74, y: 96, rx: 30, ry: 15, rot: 0 };
      r.head = { x: 108, y: 94, r: 19, rot: 0.5 };
      // Paws up, paddling.
      Object.assign(r.legs, { fn: 0.5 * Math.sin(ph * 2), ff: 0.5 * Math.sin(ph * 2 + 1.5), bn: 0.5 * Math.sin(ph * 2 + 3), bf: 0.5 * Math.sin(ph * 2 + 4.5) });
      r.tail = { ang: 2.3, wag: 0.4 * Math.sin(ph * 2) };
      r.eyes = "happy";
      r.mouth = 0.6;
      r.tongue = true;
      r.ears = 0.7;
      break;
    }
    case "spin": {
      // Round after its tail: it turns, so its width goes to nothing and comes back the other way.
      const a = [0, 0.7, 1.45, 2.2, 3.14, 3.9, 4.7, 5.5][i];
      // Never thinner than a third of itself: side on, it is still there.
      r.sx = Math.sign(Math.cos(a) || 1) * Math.max(0.36, Math.abs(Math.cos(a)));
      const legs = 0.5 * Math.sin(ph * 2);
      Object.assign(r.legs, { fn: legs, ff: -legs, bn: -legs, bf: legs });
      r.tail.wag = 0.5 * Math.sin(ph * 3);
      r.mouth = 0.5;
      r.tongue = true;
      r.ears = 0.5;
      r.y = -1.5 * Math.abs(Math.sin(ph * 2));
      break;
    }
  }
  return r;
}

const ell = (ctx, x, y, rx, ry, rot = 0) => { ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU); };
function paint(ctx, fill, line = true) {
  ctx.fillStyle = fill;
  ctx.fill();
  if (line) { ctx.lineWidth = LINE; ctx.strokeStyle = INK; ctx.stroke(); }
}

/** A stubby leg from (x, y), swung by `ang` from straight down, `len` long, with a round paw. */
function leg(ctx, x, y, ang, len, far, up = false) {
  const dir = up ? -1 : 1;
  const ex = x + Math.sin(ang) * len, ey = y + dir * Math.cos(ang) * len;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(ex, ey);
  ctx.lineWidth = 9 + LINE * 2;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.lineWidth = 9;
  ctx.strokeStyle = far ? COAT.shade : COAT.base;
  ctx.stroke();
  ell(ctx, ex + 1.2, ey + dir * 0.4, 5.6, 4.2);
  paint(ctx, far ? COAT.creamShade : COAT.cream);
}

function tail(ctx, x, y, ang) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  // A fluffy plume, wide in the middle, with a pale tip, out along -x.
  ctx.beginPath();
  ctx.moveTo(2, -4);
  ctx.bezierCurveTo(-8, -12, -24, -11, -30, -2);
  ctx.bezierCurveTo(-24, 8, -8, 8, 2, 4);
  ctx.closePath();
  paint(ctx, COAT.saddle);
  ctx.beginPath();
  ctx.moveTo(-20, -6);
  ctx.bezierCurveTo(-25, -7, -29, -5, -30, -2);
  ctx.bezierCurveTo(-28, 2, -24, 4, -20, 3);
  ctx.closePath();
  paint(ctx, COAT.cream, false);
  ctx.restore();
}

function head(ctx, h, r) {
  ctx.save();
  ctx.translate(h.x, h.y);
  ctx.rotate(h.rot);
  const R = h.r;
  const back = r.ears;
  // Ears: the far one first, darker; swept back by `ears`.
  const ear = (bx, near) => {
    ctx.save();
    ctx.translate(bx, -R * 0.62);
    ctx.rotate(-0.15 - 0.9 * back + (near ? 0.12 : -0.12));
    ctx.beginPath();
    ctx.moveTo(-8, 4);
    ctx.quadraticCurveTo(-4, -16, 1, -21);
    ctx.quadraticCurveTo(8, -12, 9, 3);
    ctx.closePath();
    paint(ctx, near ? COAT.saddle : COAT.shade);
    if (near) {
      ctx.beginPath();
      ctx.moveTo(-4, 2);
      ctx.quadraticCurveTo(-1, -10, 1, -14);
      ctx.quadraticCurveTo(5, -8, 5, 2);
      ctx.closePath();
      paint(ctx, COAT.earIn, false);
    }
    ctx.restore();
  };
  ear(-R * 0.55, false);
  // The head: round, fluffy cheeks below.
  ctx.beginPath();
  ctx.moveTo(-R, 0);
  ctx.bezierCurveTo(-R, -R * 1.05, R, -R * 1.05, R * 0.98, -R * 0.05);
  ctx.bezierCurveTo(R * 1.05, R * 0.55, R * 0.5, R * 0.95, 0, R * 0.92);
  ctx.bezierCurveTo(-R * 0.6, R * 0.95, -R * 1.05, R * 0.6, -R, 0);
  ctx.closePath();
  paint(ctx, COAT.base);
  // A darker cap over the top of the head, and the pale mask round the eyes and muzzle.
  ctx.save();
  ctx.clip();
  ell(ctx, -R * 0.15, -R * 0.75, R * 1.05, R * 0.55);
  paint(ctx, COAT.saddle, false);
  ell(ctx, R * 0.25, R * 0.42, R * 0.9, R * 0.62);
  paint(ctx, COAT.cream, false);
  ctx.restore();
  ear(R * 0.18, true);
  // Muzzle: a short rounded snout out to the right, pale, with a dark button nose.
  ell(ctx, R * 0.92, R * 0.28, R * 0.48, R * 0.36, -0.05);
  paint(ctx, COAT.cream);
  ell(ctx, R * 1.3, R * 0.12, R * 0.17, R * 0.13);
  paint(ctx, COAT.nose, false);
  ell(ctx, R * 1.26, R * 0.07, R * 0.06, R * 0.04);
  paint(ctx, "rgba(255,255,255,0.7)", false);
  // Mouth: a small smile, or open (a yip, a pant), with the tongue.
  const mx = R * 1.0, my = R * 0.45;
  if (r.mouth > 0.25 || r.ball) {
    const open = r.ball ? 0.45 : r.mouth;
    ctx.beginPath();
    ctx.moveTo(mx - R * 0.32, my - 1);
    ctx.quadraticCurveTo(mx, my + R * 0.45 * open + 2, mx + R * 0.34, my - 2);
    ctx.closePath();
    paint(ctx, COAT.mouth);
    if (r.tongue && !r.ball) {
      ell(ctx, mx + 1, my + R * 0.22 * open + 1.5, R * 0.16, R * 0.15 * (0.6 + open));
      paint(ctx, COAT.tongue);
    }
  } else {
    ctx.beginPath();
    ctx.moveTo(mx - R * 0.3, my - 1.5);
    ctx.quadraticCurveTo(mx - R * 0.1, my + 2, mx + R * 0.05, my - 0.5);
    ctx.quadraticCurveTo(mx + R * 0.2, my + 2, mx + R * 0.36, my - 2);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }
  if (r.ball) {
    ell(ctx, mx + R * 0.15, my + R * 0.05, R * 0.33, R * 0.33);
    paint(ctx, COAT.ball);
    ctx.beginPath();
    ctx.arc(mx + R * 0.05, my + R * 0.05, R * 0.24, -1.2, 1.2);
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.stroke();
  }
  // Eyes: the near one big, the far one smaller and nearer the far side of the face.
  const eye = (ex, ey, size) => {
    if (r.eyes === "closed" || r.blink) {
      ctx.beginPath();
      ctx.arc(ex, ey - 0.5, size * 0.8, 0.25, Math.PI - 0.25);
      ctx.lineWidth = 1.8; ctx.strokeStyle = INK; ctx.stroke();
      return;
    }
    if (r.eyes === "happy" || r.eyes === "squint") {
      ctx.beginPath();
      ctx.arc(ex, ey + size * 0.4, size * 0.8, Math.PI + 0.35, -0.35);
      ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.stroke();
      return;
    }
    ell(ctx, ex, ey, size * 0.82, size);
    paint(ctx, COAT.eye, false);
    ell(ctx, ex + size * 0.25, ey - size * 0.35, size * 0.34, size * 0.34);
    paint(ctx, "#ffffff", false);
    ell(ctx, ex - size * 0.25, ey + size * 0.35, size * 0.15, size * 0.15);
    paint(ctx, "rgba(255,255,255,0.8)", false);
  };
  eye(R * 0.05, -R * 0.08, R * 0.26);
  eye(R * 0.62, -R * 0.1, R * 0.2);
  // Cheek blush.
  ell(ctx, R * 0.3, R * 0.35, R * 0.18, R * 0.1);
  paint(ctx, "rgba(233,140,140,0.35)", false);
  ctx.restore();
}

/** Draw frame `i` of `pose` into a 160 x 144 box on `ctx`. */
export function drawPup(ctx, pose, i) {
  ctx.save();
  // The rig is laid out on a ground line at y = 112; drawn a size up, on a ground line at 130.
  ctx.translate(76, 130);
  ctx.scale(1.16, 1.16);
  ctx.translate(-76, -112);
  drawRig(ctx, rig(pose, i), i);
  ctx.restore();
}

function drawRig(ctx, r, i) {
  const b = r.body;
  // Shadow on the ground, under the body, smaller as it leaves the ground.
  ctx.save();
  ell(ctx, 76, 112, 34 * r.shadow * (r.sit ? 0.8 : 1), 5 * r.shadow);
  ctx.fillStyle = COAT.shadow;
  ctx.fill();
  ctx.restore();

  ctx.save();
  // A spin turns it about its middle; everything else is offset and tilted about the body.
  ctx.translate(76, 0);
  ctx.scale(r.sx, 1);
  ctx.translate(-76, 0);
  ctx.translate(r.x, r.y);
  ctx.translate(b.x, b.y);
  ctx.rotate(r.rot);
  ctx.translate(-b.x, -b.y);

  if (r.motion === 1) {
    // Speed lines behind a gallop.
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(59,42,33,0.35)";
    ctx.lineWidth = 1.6;
    for (const [y, l] of [[70, 12], [80, 18], [90, 10]]) { ctx.beginPath(); ctx.moveTo(30 - l, y); ctx.lineTo(30, y); ctx.stroke(); }
  }

  const L = r.legLen;
  if (r.back) {
    // On its back: belly up, legs in the air, head lying on the ground.
    tail(ctx, b.x - b.rx + 4, b.y + 2, r.tail.ang + r.tail.wag);
    ell(ctx, b.x, b.y, b.rx, b.ry);
    paint(ctx, COAT.base);
    ctx.save(); ctx.clip();
    ell(ctx, b.x + 2, b.y - b.ry * 0.5, b.rx * 0.85, b.ry * 0.75); paint(ctx, COAT.cream, false);
    ctx.restore();
    leg(ctx, b.x - 16, b.y - 8, r.legs.bf, L * 0.85, true, true);
    leg(ctx, b.x + 14, b.y - 9, r.legs.ff, L * 0.85, true, true);
    leg(ctx, b.x - 10, b.y - 10, r.legs.bn, L * 0.9, false, true);
    leg(ctx, b.x + 20, b.y - 10, r.legs.fn, L * 0.9, false, true);
    head(ctx, r.head, r);
    ctx.restore();
    return;
  }

  // Far legs, darker, behind everything.
  const shoulder = { x: b.x + b.rx * 0.6, y: b.y + b.ry * 0.45 };
  const hip = { x: b.x - b.rx * 0.6, y: b.y + b.ry * 0.45 };
  if (r.sit) {
    leg(ctx, b.x + 14, b.y - 2, 0.02, 27, true);
  } else if (r.lie) {
    // Lying down: paws out in front, under the chin.
    leg(ctx, b.x + 22, b.y + 6, -1.45, 16, true);
  } else {
    leg(ctx, shoulder.x - 4, shoulder.y, r.legs.ff, L, true);
    leg(ctx, hip.x + 4, hip.y, r.legs.bf, L, true);
  }
  // Tail, then the body.
  const tx = r.sit ? b.x - 12 : r.lie ? b.x - b.rx + 6 : b.x - b.rx + 5;
  const ty = r.sit ? b.y + 16 : r.lie ? b.y + 2 : b.y - b.ry * 0.35;
  tail(ctx, tx, ty, r.tail.ang + r.tail.wag);
  ell(ctx, b.x, b.y, b.rx, b.ry, b.rot);
  paint(ctx, COAT.base);
  ctx.save();
  ctx.clip();
  // A dark saddle along the back, a pale belly underneath, a soft shade at the bottom.
  ell(ctx, b.x - 2, b.y - b.ry * 0.95, b.rx * 0.95, b.ry * 0.6, b.rot);
  paint(ctx, COAT.saddle, false);
  ell(ctx, b.x + 4, b.y + b.ry * 0.95, b.rx * 0.8, b.ry * 0.45, b.rot);
  paint(ctx, COAT.cream, false);
  ctx.restore();
  if (r.sit) {
    // Sitting: a round haunch with the back paw tucked in front of it, the near front leg straight.
    ell(ctx, b.x - 6, b.y + 12, 13, 11, -0.2);
    paint(ctx, COAT.base);
    ell(ctx, b.x + 4, b.y + 23, 7, 4.5);
    paint(ctx, COAT.cream);
    leg(ctx, b.x + 19, b.y - 2, -0.02, 27, false);
  } else if (r.lie) {
    ell(ctx, b.x - 14, b.y + 3, 12, 9, 0.1);
    paint(ctx, COAT.base);
    leg(ctx, b.x + 26, b.y + 8, -1.5, 17, false);
  } else {
    leg(ctx, shoulder.x + 2, shoulder.y, r.legs.fn, L, false);
    leg(ctx, hip.x - 2, hip.y, r.legs.bn, L, false);
  }
  // A cream ruff of chest fluff where the neck meets the body.
  const ruff = r.sit ? { x: b.x + 14, y: b.y - 12 } : r.lie ? { x: b.x + 22, y: b.y - 2 } : r.bow ? { x: b.x + 24, y: b.y + 2 } : { x: b.x + 22, y: b.y - 4 };
  ctx.beginPath();
  ctx.moveTo(ruff.x - 8, ruff.y - 8);
  for (let k = 0; k <= 4; k++) {
    const a = -1.2 + (k / 4) * 2.4;
    ctx.quadraticCurveTo(ruff.x + Math.cos(a) * 13, ruff.y + Math.sin(a) * 13, ruff.x + Math.cos(a + 0.3) * 9, ruff.y + Math.sin(a + 0.3) * 10);
  }
  ctx.closePath();
  paint(ctx, COAT.cream);
  head(ctx, r.head, r);
  if (r.motion === 2) {
    // Droplets flying off a shake.
    ctx.fillStyle = "rgba(120,170,220,0.75)";
    for (const [dx, dy] of [[-38, -18], [36, -28], [-30, 6], [44, -8]]) {
      const k = (i % 2) * 3;
      ell(ctx, b.x + dx + Math.sign(dx) * k, b.y + dy - k, 2.2, 2.2);
      ctx.fill();
    }
  }
  ctx.restore();
}

export const POSES = ["walk", "sit", "sleep", "beg", "jump", "run", "shake", "roll", "spin", "carry", "ball"];
