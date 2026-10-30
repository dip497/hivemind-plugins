function at(o){return o.getContext("webgl2",{alpha:!1,antialias:!1,depth:!1,stencil:!1,premultipliedAlpha:!1,preserveDrawingBuffer:!0,powerPreference:"low-power"})}var Ot=`#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`,_t=`#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 outColor;
`;function nt(o,t,r){let e=o.createShader(t);if(o.shaderSource(e,r),o.compileShader(e),!o.getShaderParameter(e,o.COMPILE_STATUS)&&!o.isContextLost())throw new Error(`shader: ${o.getShaderInfoLog(e)}`);return e}function T(o,t){let r=o.createProgram();if(o.attachShader(r,nt(o,o.VERTEX_SHADER,Ot)),o.attachShader(r,nt(o,o.FRAGMENT_SHADER,_t+t)),o.linkProgram(r),!o.getProgramParameter(r,o.LINK_STATUS)&&!o.isContextLost())throw new Error(`program: ${o.getProgramInfoLog(r)}`);let e=new Map;return{program:r,at(i){return e.has(i)||e.set(i,o.getUniformLocation(r,i)),e.get(i)}}}function D(o,t,r,e,i=null,s="rgba8"){let l=o.createTexture();o.bindTexture(o.TEXTURE_2D,l);let a=e?o.LINEAR:o.NEAREST;return o.texParameteri(o.TEXTURE_2D,o.TEXTURE_MIN_FILTER,a),o.texParameteri(o.TEXTURE_2D,o.TEXTURE_MAG_FILTER,a),o.texParameteri(o.TEXTURE_2D,o.TEXTURE_WRAP_S,o.CLAMP_TO_EDGE),o.texParameteri(o.TEXTURE_2D,o.TEXTURE_WRAP_T,o.CLAMP_TO_EDGE),o.pixelStorei(o.UNPACK_ALIGNMENT,1),s==="r8"?o.texImage2D(o.TEXTURE_2D,0,o.R8,t,r,0,o.RED,o.UNSIGNED_BYTE,i):s==="r32f"?o.texImage2D(o.TEXTURE_2D,0,o.R32F,t,r,0,o.RED,o.FLOAT,i):o.texImage2D(o.TEXTURE_2D,0,o.RGBA8,t,r,0,o.RGBA,o.UNSIGNED_BYTE,i),l}function H(o,t,r,e,i,s="rgba8"){o.bindTexture(o.TEXTURE_2D,t),o.pixelStorei(o.UNPACK_ALIGNMENT,1),s==="r8"?o.texSubImage2D(o.TEXTURE_2D,0,0,0,r,e,o.RED,o.UNSIGNED_BYTE,i):s==="r32f"?o.texSubImage2D(o.TEXTURE_2D,0,0,0,r,e,o.RED,o.FLOAT,i):o.texSubImage2D(o.TEXTURE_2D,0,0,0,r,e,o.RGBA,o.UNSIGNED_BYTE,i)}function A(o,t,r,e=!0){let i=D(o,t,r,e),s=o.createFramebuffer();return o.bindFramebuffer(o.FRAMEBUFFER,s),o.framebufferTexture2D(o.FRAMEBUFFER,o.COLOR_ATTACHMENT0,o.TEXTURE_2D,i,0),o.bindFramebuffer(o.FRAMEBUFFER,null),{tex:i,fbo:s,w:t,h:r}}function F(o,t){t&&(o.deleteTexture(t.tex),o.deleteFramebuffer(t.fbo))}function w(o,t,r,e){o.bindFramebuffer(o.FRAMEBUFFER,r.fbo??null),o.viewport(0,0,r.w,r.h),o.useProgram(t.program),e(t),o.drawArrays(o.TRIANGLES,0,3)}function x(o,t,r,e,i){o.activeTexture(o.TEXTURE0+i),o.bindTexture(o.TEXTURE_2D,e),o.uniform1i(t.at(r),i)}var ut=`
uniform sampler2D uSrc;
uniform vec2 uStep;
void main() {
  vec4 sum = texture(uSrc, vUv) * 0.2270270270;
  sum += (texture(uSrc, vUv + uStep * 1.3846153846) + texture(uSrc, vUv - uStep * 1.3846153846)) * 0.3162162162;
  sum += (texture(uSrc, vUv + uStep * 3.2307692308) + texture(uSrc, vUv - uStep * 3.2307692308)) * 0.0702702703;
  outColor = sum;
}`;function lt(o,t,r,e,i,s){w(o,t,e,()=>{x(o,t,"uSrc",r,0),o.uniform2f(t.at("uStep"),s/3.23/e.w,0)}),w(o,t,i,()=>{x(o,t,"uSrc",e.tex,0),o.uniform2f(t.at("uStep"),0,s/3.23/i.h)})}import{connectWallpaper as zt}from"@hivemind/view-sdk";import{SCENE_STEP as It,SETTLE_STEPS as Bt}from"@hivemind/view-sdk";function ct(o,t,r){let e=[o.on("viewport",a=>{t.resize(a.w,a.h),r.resize(a.w,a.h,a.dpr)}),o.on("look",a=>r.setLook(a)),o.on("mode",a=>{a!=="run"&&t.point(0,0,!1)}),o.on("pointer",({x:a,y:n,over:u})=>t.point(a,n,u&&o.mode==="run")),o.on("click",({x:a,y:n})=>{o.mode==="run"&&t.splash(a,n)})],i=!1,s=a=>{i=!0,t.step(a)},l=o.animate({step:s,draw:()=>r.draw(t),settle:()=>{if(!i)for(let a=0;a<Bt;a++)s(It)}});return()=>{l();for(let a of e)a()}}var M="Patterns Mono",Nt=2e3,Wt={file:"jetbrains-mono-latin-600-normal.woff2",range:"U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"};function Ht(){let o=document.createElement("canvas");return Object.assign(o.style,{position:"fixed",inset:"0",width:"100%",height:"100%",display:"block"}),document.body.append(o),o}function $t(o,t){let r=t.map(({file:e,range:i})=>{let s=new FontFace(M,`url(${JSON.stringify(new URL(e,o).href)}) format("woff2")`,{weight:"600",unicodeRange:i});return document.fonts.add(s),s.load().then(()=>{},()=>{})});return Promise.race([Promise.all(r).then(()=>{}),new Promise(e=>setTimeout(e,Nt))])}async function ht(o,t,r=[Wt]){let e=Ht(),[i]=await Promise.all([zt(),$t(new URL("../fonts/",import.meta.url),r)]);ct(i,o,t(e))}var $=2;function ft(o,t,r,e,i,s){s&&o.deleteTexture(s.tex);let l=[...new Set(t)],a=r+$*2,n=a*l.length,f=new OffscreenCanvas(n,e).getContext("2d",{willReadFrequently:!0});f.fillStyle="#000",f.fillRect(0,0,n,e),f.fillStyle="#fff",f.font=i,f.textAlign="center",f.textBaseline="middle",l.forEach((p,d)=>f.fillText(p,d*a+a/2,e/2+e*.03));let h=f.getImageData(0,0,n,e).data,c=new Uint8Array(n*e);for(let p=0;p<c.length;p++)c[p]=h[p*4];let m=new Map;return l.forEach((p,d)=>{let b=0;for(let v=0;v<e;v++)for(let S=d*a+$;S<d*a+$+r;S++)b+=c[v*n+S];m.set(p,b/(255*r*e))}),{tex:D(o,n,e,!0,c,"r8"),count:l.length,slot:new Map(l.map((p,d)=>[p,d+1])),coverage:m,slotU:a/n,padU:$/n,cellU:r/n}}function mt(o,t,r){let e=[...new Set(t)].sort((a,n)=>o.coverage.get(a)-o.coverage.get(n)),i=o.coverage.get(e[0]),s=o.coverage.get(e[e.length-1]),l=[];for(let a=0;a<r;a++){let n=i+(s-i)*a/(r-1),u=e[0];for(let f of e)Math.abs(o.coverage.get(f)-n)<Math.abs(o.coverage.get(u)-n)&&(u=f);l.push(u)}return l}var pt=[" ",".","`","'",",",":",";","-","~","=","+","*","x","o","%","#","&","@"],Q=10,dt=["|","_","/","\\"],Xt=`
uniform sampler2D uPic;
uniform sampler2D uForce;
uniform int uHasForce;
uniform float uRamp[${Q}];
uniform float uEdgeSlots[4];
uniform float uEdge;
uniform float uGain;
uniform float uFull;
uniform float uDither;
uniform int uInk;
uniform vec3 uBase;
uniform ivec2 uGrid;
float tone(vec3 c) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float b = dot(uBase, vec3(0.2126, 0.7152, 0.0722));
  return uInk == 1 ? max(0.0, b - l) / max(0.05, b) : l;
}
float at(ivec2 p) { return tone(texelFetch(uPic, clamp(p, ivec2(0), uGrid - 1), 0).rgb); }
void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  if (uHasForce == 1) {
    vec4 f = texelFetch(uForce, cell, 0);
    if (f.a > 0.0) { outColor = f; return; }
  }
  vec4 pc = texelFetch(uPic, cell, 0);
  vec3 c = pc.rgb;
  // Where the picture wants no characters, none; where only its edges, no tone.
  if (pc.a < 0.25) { outColor = vec4(c, 0.0); return; }
  float t = at(cell);
  float gx = at(cell + ivec2(1, -1)) + 2.0 * at(cell + ivec2(1, 0)) + at(cell + ivec2(1, 1))
           - at(cell + ivec2(-1, -1)) - 2.0 * at(cell + ivec2(-1, 0)) - at(cell + ivec2(-1, 1));
  float gy = at(cell + ivec2(-1, 1)) + 2.0 * at(cell + ivec2(0, 1)) + at(cell + ivec2(1, 1))
           - at(cell + ivec2(-1, -1)) - 2.0 * at(cell + ivec2(0, -1)) - at(cell + ivec2(1, -1));
  float nudge = (fract(sin(dot(vec2(cell), vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * uDither;
  int k = int(clamp((t + nudge) / uFull, 0.0, 0.999) * float(${Q}));
  float slot = pc.a < 0.75 ? 0.0 : uRamp[k];
  if (uEdge > 0.0 && length(vec2(gx, gy)) > uEdge) {
    float ax = abs(gx), ay = abs(gy);
    // Rows run down: a step brighter to the right and below runs along "/".
    slot = ax > ay * 2.0 ? uEdgeSlots[0] : ay > ax * 2.0 ? uEdgeSlots[1] : (gx * gy > 0.0 ? uEdgeSlots[2] : uEdgeSlots[3]);
  }
  vec3 col = uInk == 1 ? c * (1.0 - uGain) : min(vec3(1.0), c * uGain);
  outColor = vec4(col, slot / 255.0);
}`,Yt=`
uniform sampler2D uSrc;
uniform vec2 uCellPx;
uniform vec2 uSpan;
void main() {
  vec2 c = gl_FragCoord.xy * uCellPx / uSpan;
  vec2 q = 0.25 * uCellPx / uSpan;
  outColor = (texture(uSrc, c) * 2.0 + texture(uSrc, c + vec2(-q.x, -q.y)) + texture(uSrc, c + vec2(q.x, -q.y)) + texture(uSrc, c + vec2(-q.x, q.y)) + texture(uSrc, c + q)) / 6.0;
}`,Kt=`
uniform sampler2D uCells;
uniform float uCoverage[64];
uniform float uFrom;
uniform int uInk;
void main() {
  vec4 c = texelFetch(uCells, ivec2(gl_FragCoord.xy), 0);
  int slot = int(c.a * 255.0 + 0.5);
  float cov = slot > 0 ? uCoverage[min(slot, 63)] : 0.0;
  float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  float amount = uInk == 1 ? smoothstep(uFrom, 1.0, 1.0 - l) : smoothstep(uFrom, 1.0, l);
  outColor = vec4((uInk == 1 ? vec3(1.0) - c.rgb : c.rgb) * amount * (0.4 + cov), 1.0);
}`,jt=`
uniform sampler2D uCells;
uniform sampler2D uPicture;
uniform sampler2D uBloom;
uniform sampler2D uAtlas;
uniform vec2 uView;
uniform vec2 uCell;
uniform vec2 uPicPer;
uniform float uSlotU, uPadU, uCellU;
uniform float uGround, uBloomK;
uniform int uInk;
uniform int uSmooth;
uniform vec3 uBase;
void main() {
  vec2 px = vec2(gl_FragCoord.x, uView.y - gl_FragCoord.y);
  vec2 cf = px / uCell;
  ivec2 cell = ivec2(floor(cf));
  vec2 inCell = fract(cf);
  vec4 c = texelFetch(uCells, cell, 0);
  float slot = floor(c.a * 255.0 + 0.5);
  float cov = slot > 0.5 ? texture(uAtlas, vec2((slot - 1.0) * uSlotU + uPadU + inCell.x * uCellU, inCell.y)).r : 0.0;
  // The picture under this pixel: its texel, sharp; or, for light, smoothly. The bloom falls off round.
  ivec2 size = textureSize(uPicture, 0);
  vec3 pic = uSmooth == 1 ? texture(uPicture, px * uPicPer / vec2(size)).rgb : texelFetch(uPicture, min(ivec2(floor(px * uPicPer)), size - 1), 0).rgb;
  vec3 glow = texture(uBloom, cf / vec2(textureSize(uCells, 0))).rgb;
  vec3 col;
  if (uInk == 1) {
    vec3 under = mix(uBase, pic, uGround);
    col = mix(under, c.rgb, cov) * (vec3(1.0) - glow * uBloomK);
  } else {
    col = mix(uBase, pic, uGround) + c.rgb * cov + glow * uBloomK;
  }
  outColor = vec4(col, 1.0);
}`,X=class{constructor(t,r=[]){this.gl=t;this.extra=r;this.pick=T(t,Xt),this.down=T(t,Yt),this.glow=T(t,Kt),this.screen=T(t,jt),this.blurP=T(t,ut)}gl;extra;pick;down;glow;screen;blurP;atlas=null;cells=null;coarse=null;bloomA=null;bloomB=null;bloomC=null;ramp=[];edges=[];coverage=new Float32Array(64);cols=0;rows=0;slot(t){return this.atlas?.slot.get(t)??0}layout(t,r,e,i,s){let l=this.gl;this.atlas=ft(l,[...pt,...dt,...this.extra],Math.max(4,Math.round(e)),Math.max(6,Math.round(i)),s,this.atlas??void 0),this.ramp=mt(this.atlas,pt,Q).map(a=>this.atlas.slot.get(a)),this.ramp[0]=0,this.edges=dt.map(a=>this.atlas.slot.get(a)),this.coverage.fill(0);for(let[a,n]of this.atlas.slot)n<64&&(this.coverage[n]=this.atlas.coverage.get(a));if(t!==this.cols||r!==this.rows||!this.cells){for(let a of[this.cells,this.coarse,this.bloomA,this.bloomB,this.bloomC])F(l,a);this.cols=t,this.rows=r,this.cells=A(l,t,r,!1),this.coarse=A(l,t,r),this.bloomA=A(l,t,r),this.bloomB=A(l,t,r),this.bloomC=A(l,t,r)}}draw(t,r,e,i,s,l,a,n){let u=this.gl;if(!this.atlas||!this.cells)return;let f=t,h=n?[i,s]:[this.cols*l,this.rows*a],c=n?[n.w,n.h]:[this.cols,this.rows];n&&(w(u,this.down,this.coarse,m=>{x(u,m,"uSrc",t,0),u.uniform2f(m.at("uCellPx"),l,a),u.uniform2f(m.at("uSpan"),h[0],h[1])}),f=this.coarse.tex),w(u,this.pick,this.cells,m=>{x(u,m,"uPic",f,0),r&&x(u,m,"uForce",r,1),u.uniform1i(m.at("uHasForce"),r?1:0),u.uniform1fv(m.at("uRamp"),this.ramp),u.uniform1fv(m.at("uEdgeSlots"),this.edges),u.uniform1f(m.at("uEdge"),e.edge),u.uniform1f(m.at("uGain"),e.gain),u.uniform1f(m.at("uFull"),e.full),u.uniform1f(m.at("uDither"),e.dither??0),u.uniform1i(m.at("uInk"),e.ink?1:0),u.uniform3fv(m.at("uBase"),e.base),u.uniform2i(m.at("uGrid"),this.cols,this.rows)}),w(u,this.glow,this.bloomA,m=>{x(u,m,"uCells",this.cells.tex,0),u.uniform1fv(m.at("uCoverage"),this.coverage),u.uniform1f(m.at("uFrom"),e.bloomFrom),u.uniform1i(m.at("uInk"),e.ink?1:0)}),lt(u,this.blurP,this.bloomA.tex,this.bloomB,this.bloomC,2.2),w(u,this.screen,{w:i,h:s},m=>{x(u,m,"uCells",this.cells.tex,0),x(u,m,"uPicture",t,1),x(u,m,"uBloom",this.bloomC.tex,2),x(u,m,"uAtlas",this.atlas.tex,3),u.uniform2f(m.at("uView"),i,s),u.uniform2f(m.at("uCell"),l,a),u.uniform2f(m.at("uPicPer"),c[0]/h[0],c[1]/h[1]),u.uniform1f(m.at("uSlotU"),this.atlas.slotU),u.uniform1f(m.at("uPadU"),this.atlas.padU),u.uniform1f(m.at("uCellU"),this.atlas.cellU),u.uniform1f(m.at("uGround"),e.ground),u.uniform1f(m.at("uBloomK"),e.bloom),u.uniform1i(m.at("uInk"),e.ink?1:0),u.uniform1i(m.at("uSmooth"),e.smooth?1:0),u.uniform3fv(m.at("uBase"),e.base)})}};var gt=o=>o<=.04045?o/12.92:((o+.055)/1.055)**2.4,vt=o=>o<=.0031308?12.92*o:1.055*o**.4166666666666667-.055;function wt(o,t,r){let e=(o+.3963377774*t+.2158037573*r)**3,i=(o-.1055613458*t-.0638541728*r)**3,s=(o-.0894841775*t-1.291485548*r)**3;return[4.0767416621*e-3.3077115913*i+.2309699292*s,-1.2684380046*e+2.6097574011*i-.3413193965*s,-.0041960863*e-.7034186147*i+1.707614701*s]}function bt(o,t,r){let e=Math.cbrt(.4122214708*o+.5363325363*t+.0514459929*r),i=Math.cbrt(.2119034982*o+.6806995451*t+.1073969566*r),s=Math.cbrt(.0883024619*o+.2817188376*t+.6299787005*r);return[.2104542553*e+.793617785*i-.0040720468*s,1.9779984951*e-2.428592205*i+.4505937099*s,.0259040371*e+.7827717662*i-.808675766*s]}var xt=o=>o.every(t=>t>=-1e-4&&t<=1+1e-4);function y([o,t,r]){let e=s=>wt(o,s*Math.cos(r*Math.PI/180),s*Math.sin(r*Math.PI/180)),i=e(t);if(!xt(i)){let s=0,l=t;for(let a=0;a<20;a++){let n=(s+l)/2;xt(e(n))?s=n:l=n}i=e(s)}return i.map(s=>Math.round(vt(Math.min(1,Math.max(0,s)))*255))}function _(o,t,r){let[e,i,s]=bt(...o.map(f=>gt(f/255))),[l,a,n]=bt(...t.map(f=>gt(f/255)));return wt(e+(l-e)*r,i+(a-i)*r,s+(n-s)*r).map(f=>Math.round(vt(Math.min(1,Math.max(0,f)))*255))}var I=([o,t,r])=>`#${(1<<24|o<<16|t<<8|r).toString(16).slice(1)}`;var L=(o,t,r)=>o<t?t:o>r?r:o,g=(o,t)=>o+Math.random()*(t-o),C=(o,t)=>o+Math.floor(Math.random()*(t-o+1));function yt(o){return o=Math.imul(o^o>>>16,569420461),o=Math.imul(o^o>>>15,1935289751),(o^o>>>15)>>>0}function U(o,t){return yt(Math.imul(o|0,668265261)^yt(t|0))/4294967296}var Y={dark:{sky:[[.16,.05,285],[.23,.08,315],[.33,.105,18],[.42,.12,42]],plain:[[.3,.065,38],[.16,.04,30]],horizon:.62,sun:[.93,.1,85],sunGlow:[.45,.14,52],glow:.85,mesa:[.18,.045,25],mesaLit:[.4,.11,42],hazes:[.6,.38,.12],dune:[.2,.05,30],duneLit:[.4,.1,50],star:[.93,.03,90],stars:.006,dust:[.75,.09,72],shadow:[.62,.07,295],lit:[.99,.05,78],deep:.62,sands:{ground:[[.1,0,0]],sands:[[.7,.13,75],[.64,.14,52],[.57,.14,35],[.52,.12,18],[.48,.09,350],[.76,.09,80]],under:[0,0],shade:0,dust:[.75,.09,72]},look:{ground:1,gain:1.3,full:.85,edge:.22,bloom:.4,bloomFrom:.62}},light:{sky:[[.8,.075,245],[.86,.058,238],[.91,.042,225],[.945,.03,82]],plain:[[.91,.045,78],[.83,.06,66]],horizon:.62,sun:[.995,.025,95],sunGlow:[.985,.05,92],glow:.7,mesa:[.79,.065,38],mesaLit:[.88,.07,55],hazes:[.55,.35,.1],dune:[.81,.06,64],duneLit:[.91,.05,82],star:[.99,0,0],stars:0,dust:[.6,.06,55],shadow:[.74,.05,285],lit:[1,.02,90],deep:.82,sands:{ground:[[.97,0,0]],sands:[[.62,.13,38],[.76,.13,76],[.9,.05,88],[.53,.12,30],[.7,.09,15],[.5,.07,52]],under:[0,0],shade:0,dust:[.6,.06,55]},look:{ground:1,gain:.5,full:.6,edge:.14,bloom:0,bloomFrom:1}}};function Z(o,t,r){let e=new Int32Array(o+1);for(let i=0;i<=o;i++)e[i]=Math.round(i*t*r);return e}function kt(o,t,r,e){return Array.from({length:t},(i,s)=>{let l=Math.min(1,(s+.5)*r/Math.max(1,e))*(o.length-1),a=Math.min(o.length-2,Math.floor(l));return I(_(o[a],o[a+1],l-a))})}function St(o,t,r){let[e,i]=[y(o),y(t)];return Array.from({length:r+1},(s,l)=>I(_(e,i,l/r)))}var K=class{constructor(t,r){this.canvas=t;this.palettes=r;let e=t.getContext("2d",{alpha:!1});if(!e)throw new Error("2D canvas unavailable");this.ctx=e,this.palette=r.dark,t.addEventListener("contextrestored",()=>{this.stale=!0})}canvas;palettes;ctx;width=0;height=0;dpr=1;light=!1;palette;family=`"${M}", monospace`;stale=!0;looked=!1;resize(t,r,e){this.width=t,this.height=r,this.dpr=e,this.canvas.width=Math.round(t*e),this.canvas.height=Math.round(r*e),this.stale=!0,this.sized()}setLook(t){let r=this.palettes[t.dark?"dark":"light"],e=this.familyOf(t.mono);this.looked&&r===this.palette&&e===this.family||(this.looked=!0,this.light=!t.dark,this.palette=r,this.family=e,this.styled(),this.stale=!0)}familyOf(t){let r=`"${M}", monospace`;if(!t.trim())return r;let e=`"${M}", ${t}, monospace`;return this.ctx.font="10px serif",this.ctx.font=`600 12px ${e}`,this.ctx.font==="10px serif"?r:e}sized(){}};var Tt={dark:{ground:[[.135,.022,285],[.142,.026,320],[.16,.034,20]],sands:[[.43,.1,72],[.42,.105,54],[.41,.105,37],[.4,.09,18],[.39,.07,345],[.425,.065,64]],under:[-.05,-.095],shade:.03,dust:[.62,.06,70]},light:{ground:[[.975,.01,95],[.968,.014,85],[.958,.02,70]],sands:[[.86,.07,55],[.85,.06,15],[.85,.045,305],[.86,.04,235],[.87,.05,140],[.89,.075,95]],under:[-.02,-.035],shade:.025,dust:[.62,.045,60]}};function Vt(o,t){let r=L(Math.round(Math.min(o,t)/110),7,13);return{gw:r,gh:Math.round(r*1.45)/2}}var q=45,E=4,R=6,O=8,k=R*O,P=k*E,At=.17,Jt=.25,tt=30,Qt=36,Et=.25,Zt=10,qt=9,Mt=300,te=900,Ut=1600,B=o=>1+(Math.floor(o)%k+k)%k*E+C(0,E-1),Pt=o=>Math.floor((o-1)/E),j=class{width=0;height=0;gw=8;gh=6;cols=0;rows=0;grain=new Uint8Array(0);count=0;spouts=[];flying=[];bursts=[];pointer={x:0,y:0,active:!1};restAt={x:0,y:0};rested=0;pointerHue=g(0,k);poured=0;sprinkled=0;drained=0;drainAt=0;time=0;acc=0;active=new Int32Array(0);activeCount=0;spare=new Int32Array(0);isActive=new Uint8Array(0);updates=0;arrived=new Uint32Array(0);resize(t,r){let{gw:e,gh:i}=Vt(t,r),s=Math.ceil(t/e),l=Math.ceil(r/i),a=!this.cols,n={cols:this.cols,rows:this.rows,grain:this.grain,width:this.width};if(this.width=t,this.height=r,this.gw=e,this.gh=i,s===this.cols&&l===this.rows){this.laySpouts(n.width);return}this.cols=s,this.rows=l;let u=s*l;if(this.grain=new Uint8Array(u),this.active=new Int32Array(u),this.spare=new Int32Array(u),this.isActive=new Uint8Array(u),this.arrived=new Uint32Array(u),this.activeCount=0,this.laySpouts(a?0:n.width),a){this.lay();return}for(let f=0;f<l;f++){let h=n.rows-1-Math.floor((l-1-f)*n.rows/l);for(let c=0;c<s;c++){let m=Math.floor(c*n.cols/s);this.grain[f*s+c]=n.grain[h*n.cols+m]}}this.flying=[],this.count=0;for(let f=0;f<u;f++)this.grain[f]&&(this.count++,this.wake(f))}laySpouts(t){let r=L(Math.round(this.width/480),2,5);if(t&&this.spouts.length===r){for(let e of this.spouts){let i=this.width/t;Object.assign(e,{x:e.x*i,home:e.home*i,reach:e.reach*i})}return}this.spouts=Array.from({length:r},(e,i)=>{let s=C(0,R-1)*O,l=this.width*((i+.5)/r+g(-.08,.08)/r);return{x:l,home:l,reach:this.width/r*g(.45,.75),phase:g(0,Math.PI*2),speed:g(.035,.07),on:i<2||Math.random()<.6,until:g(10,50),hue:s,toward:s,holdUntil:g(4,14),owed:0}});for(let e of this.spouts)e.x=this.spoutX(e)}spoutX(t){let r=this.time*t.speed+t.phase;return L(t.home+t.reach*(.75*Math.sin(r)+.25*Math.sin(r*2.7+1.3)),this.gw,this.width-this.gw)}lay(){let{cols:t,rows:r}=this,e=new Float32Array(t).fill(r*g(.07,.1)),i=[...this.spouts.filter(n=>n.on).map(n=>({c:n.x/this.gw,h:r*g(.1,.16),w:t*g(.06,.1)})),...Array.from({length:C(2,4)},()=>({c:g(0,t),h:r*g(.05,.12),w:t*g(.08,.18)}))];for(let n=0;n<t;n++)for(let u of i)e[n]=e[n]+u.h*Math.exp(-(((n-u.c)/u.w)**2));for(let n=1;n<t;n++)e[n]=Math.min(e[n],e[n-1]+1);for(let n=t-2;n>=0;n--)e[n]=Math.min(e[n],e[n+1]+1);let s=0;for(let n=0;n<t;n++)s+=e[n]/t;let l=r*g(.035,.05),a=g(0,R);for(let n=0;n<t;n++){let u=Math.min(r*.42,Math.round(e[n])),f=Math.sin(n*.11+a)*.8;for(let h=0;h<u;h++){let c=(h-(e[n]-s)*.55+f)/l,m=Math.floor(c),p=L((c-m-.72)/.28,0,1),d=(Math.floor(a)+m)*O+O*p;this.grain[(r-1-h)*t+n]=B(d),this.count++}}for(let n of this.spouts){if(!n.on)continue;let u=L(Math.round(n.x/this.gw),0,t-1);for(let f=0;f<r;f+=Math.max(1,Math.round(q/tt))){let h=L(u+C(-1,1),0,t-1),c=f*t+h;if(this.grain[c]||this.grain[c+t])break;this.grain[c]=B(n.hue),this.count++,this.wake(c)}}}cellAt(t,r){let e=Math.floor(t/this.gw),i=Math.floor(r/this.gh);return e<0||i<0||e>=this.cols||i>=this.rows?-1:i*this.cols+e}wake(t){t<0||t>=this.grain.length||!this.grain[t]||this.isActive[t]||(this.isActive[t]=1,this.active[this.activeCount++]=t)}wakeAbove(t){if(t<this.cols)return;let r=t%this.cols;this.wake(t-this.cols),r>0&&this.wake(t-this.cols-1),r<this.cols-1&&this.wake(t-this.cols+1)}place(t,r){return t<0||this.grain[t]?!1:(this.grain[t]=r,this.count++,this.wake(t),!0)}take(t){let r=this.grain[t];return r?(this.grain[t]=0,this.count--,this.wakeAbove(t),r):0}update(){let{cols:t,rows:r,grain:e,arrived:i}=this,s=++this.updates,l=this.active.subarray(0,this.activeCount).sort(),a=this.spare,n=l.length;a.set(l),this.activeCount=0;for(let u=0;u<n;u++)this.isActive[a[u]]=0;for(let u=n-1;u>=0;u--){let f=a[u],h=e[f];if(!h||i[f]===s||f>=(r-1)*t)continue;let c=f+t,m=-1;if(!e[c])m=c;else{let d=f-Math.floor(f/t)*t,b=Math.random()<.5?-1:1;d+b>=0&&d+b<t&&!e[c+b]?m=c+b:d-b>=0&&d-b<t&&!e[c-b]&&(m=c-b)}if(m<0)continue;e[m]=h,e[f]=0,i[m]=s,this.wake(m);let p=f;for(;p>=t&&e[p-t]&&i[p-t]!==s;p-=t)e[p]=e[p-t],e[p-t]=0,i[p]=s,this.wake(p);this.wakeAbove(p)}}point(t,r,e){let i=this.pointer,s=Math.hypot(t-i.x,r-i.y);(!e||!i.active||Math.hypot(t-this.restAt.x,r-this.restAt.y)>Zt)&&(this.rested=0,this.restAt={x:t,y:r}),e&&i.active&&this.rested<=Et&&(this.sprinkled+=s/(this.gw*1.6)),Object.assign(i,{x:t,y:r,active:e})}splash(t,r){if(!this.cols)return;let e=qt*this.gw,i=Math.max(0,Math.floor((t-e)/this.gw)),s=Math.min(this.cols-1,Math.floor((t+e)/this.gw)),l=Math.max(0,Math.floor((r-e)/this.gh)),a=Math.min(this.rows-1,Math.floor((r+e)/this.gh)),n=0;for(let u=l;u<=a;u++)for(let f=i;f<=s;f++){let h=u*this.cols+f;if(!this.grain[h]||this.flying.length>=Ut)continue;let[c,m]=[(f+.5)*this.gw,(u+.5)*this.gh],p=Math.hypot(c-t,m-r);p>e||(this.throw(c,m,(c-t)/(p||1),p?(m-r)/p:-1,1-p/e,this.take(h)),n++)}for(let u=n;u<30&&this.flying.length<Ut;u++){let f=g(0,Math.PI*2);this.throw(t,r,Math.cos(f),Math.sin(f),g(.3,.9),B(this.pointerHue))}this.bursts.push({x:t,y:r,at:this.time}),this.bursts.length>4&&this.bursts.shift()}throw(t,r,e,i,s,l){let a=Mt*(.25+.75*Math.sqrt(s))*g(.75,1.15);this.flying.push({x:t,y:r,vx:e*a,vy:(i>0?i*.3:i)*a-Mt*.7*s-g(30,90),code:l,free:-1})}step(t){if(this.cols)for(this.time+=t,this.pour(t),this.fly(t),this.drain(t),this.acc+=t;this.acc>=1/q;)this.acc-=1/q,this.update()}pour(t){for(let i of this.spouts)if(i.x=this.spoutX(i),this.time>i.until&&(i.on=!i.on,i.until=this.time+(i.on?g(25,70):g(6,18))),i.hue===i.toward&&this.time>i.holdUntil?i.toward=i.hue+(Math.random()<.75?1:2)*O:i.hue!==i.toward&&(i.hue=Math.min(i.toward,i.hue+t*O*.35),i.hue===i.toward&&(i.hue%=k,i.toward=i.hue,i.holdUntil=this.time+g(8,20))),!!i.on)for(i.owed+=tt*t;i.owed>=1;i.owed--)this.place(this.cellAt(i.x,0),B(i.hue));let r=this.pointer;if(this.pointerHue=(this.pointerHue+t*.6)%k,!r.active){this.poured=this.sprinkled=0;return}this.rested+=t,this.rested>Et&&(this.poured+=Qt*t);let e=Math.floor(this.poured)+Math.floor(this.sprinkled);this.poured-=Math.floor(this.poured),this.sprinkled-=Math.floor(this.sprinkled);for(let i=0;i<e;i++){let s=this.cellAt(r.x+C(-1,1)*this.gw,r.y);for(let l=0;l<6&&s>=0&&this.grain[s];l++)s=s>=this.cols?s-this.cols:-1;this.place(s,B(this.pointerHue))}}fly(t){let r=[];for(let e of this.flying){if(e.vy+=te*t,e.vx*=1-.5*t,e.x+=e.vx*t,e.y+=e.vy*t,e.x<0&&([e.x,e.vx]=[0,-e.vx*.4]),e.x>this.width-1&&([e.x,e.vx]=[this.width-1,-e.vx*.4]),e.y<0){r.push(e);continue}let i=this.cellAt(e.x,Math.min(e.y,this.height-1)),s=e.y>=(this.rows-1)*this.gh,l=i>=0&&!this.grain[i];if(l&&(e.free=i),(e.vy<0||l)&&!s){r.push(e);continue}let a=e.free>=0&&!this.grain[e.free]?e.free:i;for(;a>=0&&this.grain[a];)a=a>=this.cols?a-this.cols:-1;for(;a>=0&&a+this.cols<this.grain.length&&!this.grain[a+this.cols];)a+=this.cols;this.place(a,e.code)}this.flying=r}drain(t){let r=this.count/(this.cols*this.rows),e=tt*this.spouts.length*1.6*Math.max(0,(r-At)/(Jt-At)),i=Math.floor(this.drainAt);this.drainAt+=e*t;for(let s=i+1;s<=Math.floor(this.drainAt);s++)this.sink(s%this.cols);this.drainAt%=this.cols}sink(t){let{cols:r,grain:e}=this,i=(this.rows-1)*r+t;if(e[i]){for(this.count--,this.drained++;i>=r&&e[i-r];i-=r)e[i]=e[i-r],this.isActive[i-r]&&this.wake(i);e[i]=0,this.wakeAbove(i),this.wake(i+r)}}};var Lt=3,et=1+Lt*P,rt=65535,ot=260,z=.6,Dt=4,Rt=[".","\xB7",":","'","`",","];function ee(o,t,r){let e=t[2]-o[2];return e>180&&(e-=360),e<-180&&(e+=360),[o[0]+(t[0]-o[0])*r,o[1]+(t[1]-o[1])*r,(o[2]+e*r+360)%360]}function it(o,t,r){let e=Pt(t),i=Math.floor(e/(k/R)),s=ee(o.sands[i],o.sands[(i+1)%R],e%(k/R)/(k/R)),l=((t-1)%E/(E-1)-.5)*o.shade;return y([s[0]+l+(r===0?0:o.under[r-1]),s[1],s[2]])}var V=class extends K{shown=new Uint16Array(0);drawn=new Uint16Array(0);dust=new Uint8Array(0);dustDrawn=new Uint8Array(0);touched=new Uint8Array(0);changed=new Int32Array(0);order=new Int32Array(0);counts=new Int32Array(et+1);xs=new Int32Array(1);ys=new Int32Array(1);cols=0;rows=0;gw=0;gh=0;ground=[];styles=[];dustStyles=[];constructor(t){super(t,Tt)}styled(){let t=this.palette;this.styles=new Array(et).fill("");for(let r=1;r<=P;r++)for(let e=0;e<Lt;e++)this.styles[1+e*P+r-1]=I(it(t,r,e));this.dustStyles=St(t.ground[2],t.dust,Dt),this.ground=[]}layout(t){if(t.cols===this.cols&&t.rows===this.rows&&t.gw===this.gw&&t.gh===this.gh&&!this.stale)return;this.cols=t.cols,this.rows=t.rows,this.gw=t.gw,this.gh=t.gh;let r=this.cols*this.rows;if(this.shown.length!==r){this.shown=new Uint16Array(r),this.drawn=new Uint16Array(r),this.changed=new Int32Array(r),this.order=new Int32Array(r);let e=this.cols*Math.ceil(this.rows/2);this.dust=new Uint8Array(e),this.dustDrawn=new Uint8Array(e),this.touched=new Uint8Array(e)}this.xs=Z(this.cols,this.gw,this.dpr),this.ys=Z(this.rows,this.gh,this.dpr),this.ground=[],this.stale=!0}see(t){let{cols:r,rows:e,shown:i}=this,s=t.grain;for(let n=0;n<r;n++){let u=0;for(let f=n;f<s.length;f+=r){let h=s[f];if(!h){i[f]=0,u=0;continue}i[f]=1+(u===0?0:u<4?1:2)*P+h-1,u++}}for(let n of t.flying){let u=t.cellAt(n.x,n.y);u>=0&&(i[u]=n.code)}this.dust.fill(0);let l=this.gh*2,a=Math.ceil(e/2);for(let n of t.bursts){let u=t.time-n.at;if(u<0||u>=z)continue;let f=ot*u,h=this.gw*.8,c=Math.ceil((1-u/z)*Dt),m=Math.max(0,Math.floor((n.x-f-h)/this.gw)),p=Math.min(r-1,Math.floor((n.x+f+h)/this.gw)),d=Math.max(0,Math.floor((n.y-f-h)/l)),b=Math.min(a-1,Math.floor((n.y+f+h)/l));for(let v=d;v<=b;v++)for(let S=m;S<=p;S++){let Ct=Math.hypot((S+.5)*this.gw-n.x,(v+.5)*l-n.y);Math.abs(Ct-f)<h&&U(S,v)<.6&&(this.dust[v*r+S]=Math.max(this.dust[v*r+S],c))}}}draw(t){if(!t.cols||!this.width)return;this.layout(t);let r=this.ctx,{xs:e,ys:i,cols:s,rows:l,shown:a,drawn:n}=this;r.setTransform(1,0,0,1,0,0),this.ground.length!==l&&(this.ground=kt(this.palette.ground.map(y),l,this.gh,this.height)),this.see(t),this.stale&&(n.fill(rt),this.dustDrawn.fill(0),this.stale=!1),this.touched.fill(0);for(let c=0;c<this.dust.length;c++){if(this.dust[c]===this.dustDrawn[c])continue;this.dustDrawn[c]=this.dust[c],this.touched[c]=1;let m=Math.floor(c/s)*2,p=c%s;n[m*s+p]=rt,m+1<l&&(n[(m+1)*s+p]=rt)}let u=0;for(let c=0;c<a.length;c++)a[c]!==n[c]&&(n[c]=a[c],this.changed[u++]=c);let f=this.counts.fill(0);for(let c=0;c<u;c++)f[a[this.changed[c]]+1]++;for(let c=1;c<=et;c++)f[c]=f[c]+f[c-1];for(let c=0;c<u;c++){let m=this.changed[c],p=a[m];this.order[f[p]]=m,f[p]=f[p]+1}let h="";for(let c=0;c<u;c++){let m=this.order[c],p=a[m],d=m/s|0,b=m-d*s,v=p?this.styles[p]:this.ground[d];v!==h&&(r.fillStyle=h=v),r.fillRect(e[b],i[d],e[b+1]-e[b],i[d+1]-i[d]),this.dust[(d>>1)*s+b]&&(this.touched[(d>>1)*s+b]=1)}r.font=`600 ${Math.round(this.gh*2*.74*this.dpr)}px ${this.family}`,r.textAlign="center",r.textBaseline="middle";for(let c=0;c<this.dust.length;c++){let m=this.dust[c];if(!m||!this.touched[c])continue;let p=Math.floor(c/s)*2,d=c%s,b=this.dustStyles[m];b!==h&&(r.fillStyle=h=b);let v=i[Math.min(l,p+2)];r.fillText(Rt[Math.floor(U(d,p+7)*Rt.length)],(e[d]+e[d+1])/2,(i[p]+v)/2)}}};var W=3,G=5,N=.7,st=.075,re=.04,Gt=[.75,.5],oe=["+","*"],ie=.55,se="|",ne="*",ae=1.2,ue=3.5,le=`
uniform vec2 uSize;
uniform float uDpr;
uniform vec3 uSky0, uSky1, uSky2, uSky3, uPlainFar, uPlainNear, uSun, uSunGlow, uMesa, uMesaLit, uDune, uDuneLit;
uniform vec2 uSunAt;
uniform float uSunR, uGlowK, uGlowWide, uGlowClose, uHorizonY;
uniform vec4 uButtes[${W*G}];
uniform float uHazes[${W}];
uniform int uInk;
// A butte: a flat top (half-width b.y), a cliff (b.w across) down to its scree, a skirt of scree
// widening below it; b.z tall.
float butte(vec4 b, float x) {
  float dx = abs(x - b.x);
  float cliff = b.w, skirt = b.y * 0.9;
  float h = dx < b.y ? 1.0 : dx < b.y + cliff ? mix(1.0, 0.42, pow((dx - b.y) / cliff, 0.6)) : 0.42 * pow(max(0.0, 1.0 - (dx - b.y - cliff) / skirt), 1.6);
  return b.z * h;
}
float ridge(int range, float x) {
  float top = 0.0;
  for (int i = 0; i < ${G}; i++) top = max(top, butte(uButtes[range * ${G} + i], x));
  return uHorizonY - top;
}
// Far dunes rolling across the plain: two rows, each a sum of slow waves.
float dune(int k, float x) {
  float f = float(k);
  float y = uHorizonY + uSize.y * (0.05 + 0.07 * f);
  float a = uSize.y * (0.016 + 0.012 * f);
  return y - a * (sin(x / uSize.x * (5.0 + 3.0 * f) + 1.7 * f) * 0.6 + sin(x / uSize.x * (11.0 + 2.0 * f) + 0.4) * 0.4 + 1.0);
}
vec3 skyAt(float y) {
  float t = clamp(y / uHorizonY, 0.0, 1.0);
  return t < 0.45 ? mix(uSky0, uSky1, smoothstep(0.0, 0.45, t))
       : t < 0.8 ? mix(uSky1, uSky2, smoothstep(0.45, 0.8, t))
       : mix(uSky2, uSky3, smoothstep(0.8, 1.0, t));
}
void main() {
  vec2 p = gl_FragCoord.xy / uDpr;
  float px = 1.0 / uDpr;
  vec3 sky = skyAt(p.y);
  // The sun's glow, wide and close, falling off round it, toward the glow's colour; the sun.
  float d = length(p - uSunAt) / uSize.y;
  float glow = (exp(-pow(d / 0.3, 2.0)) * uGlowWide + exp(-pow(d / 0.07, 2.0)) * uGlowClose) * uGlowK;
  sky = mix(sky, uSunGlow, min(1.0, glow));
  sky = mix(sky, uSun, clamp((uSunR * uSize.y - length(p - uSunAt)) / px + 0.5, 0.0, 1.0));
  vec3 col = sky;
  vec2 light = normalize(vec2(sign(uSunAt.x - p.x) * 0.9, 0.42));
  if (p.y > uHorizonY - px) {
    float t = clamp((p.y - uHorizonY) / (uSize.y - uHorizonY), 0.0, 1.0);
    vec3 plain = mix(uPlainFar, uPlainNear, smoothstep(0.0, 1.0, t));
    col = mix(col, plain, clamp((p.y - uHorizonY) / px + 0.5, 0.0, 1.0));
    for (int k = 0; k < 2; k++) {
      float top = dune(k, p.x);
      float cover = clamp((p.y - top) / px + 0.5, 0.0, 1.0);
      if (cover <= 0.0) continue;
      float slope = (dune(k, p.x + 4.0) - dune(k, p.x - 4.0)) / 8.0;
      float sun = max(0.0, dot(normalize(vec2(slope, 1.0)), light));
      vec3 c = mix(uDune, uDuneLit, smoothstep(0.2, 0.9, sun));
      // Further dunes take more of the plain's haze.
      col = mix(col, mix(c, uPlainFar, 0.45 - 0.25 * float(k)), cover);
    }
  }
  vec3 haze = mix(uSky2, uSky3, 0.6);
  for (int k = 0; k < ${W}; k++) {
    float top = ridge(k, p.x);
    float cover = clamp((p.y - top) / px + 0.5, 0.0, 1.0) * clamp((uHorizonY - p.y) / px + 0.5, 0.0, 1.0);
    if (cover <= 0.0) continue;
    float slope = (ridge(k, p.x + 2.0) - ridge(k, p.x - 2.0)) / 4.0;
    float sun = max(0.0, dot(normalize(vec2(slope, 1.0)), light));
    // The face toward the sun lit, the one away in shadow, a top catching light along its rim.
    float rim = smoothstep(3.0, 0.0, p.y - top) * 0.35;
    vec3 m = mix(uMesa, uMesaLit, clamp(smoothstep(0.25, 0.95, sun) + rim, 0.0, 1.0));
    col = mix(col, mix(m, haze, uHazes[k]), cover);
  }
  // A grain of noise, under a step of the colour, so the long gradients do not band.
  col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  outColor = vec4(col, 0.0);
}`,ce=`
uniform sampler2D uGrain;
uniform sampler2D uTop;
uniform vec2 uGrid;
float T(float c) { return texelFetch(uTop, ivec2(clamp(c, 0.0, uGrid.x - 1.0), 0), 0).r; }
// A grain falling through the air: not one just landing, a grain above the sand.
float airAt(vec2 g) {
  if (g.x < 0.0 || g.y < 0.0 || g.x >= uGrid.x || g.y >= uGrid.y || g.y >= T(g.x) - 1.0) return 0.0;
  return texelFetch(uGrain, ivec2(g), 0).r * 255.0;
}
void main() {
  vec2 g = floor(gl_FragCoord.xy);
  float dens = 0.0, across = 0.0, code = 0.0, near = 99.0;
  // Over six grains up and down, so where a spout has moved a column its stream bends smoothly
  // across rather than stepping.
  for (int k = -6; k <= 6; k++) {
    for (int i = -1; i <= 1; i++) {
      float c = airAt(g + vec2(float(i), float(k)));
      if (c < 0.5) continue;
      float w = (1.0 - abs(float(k)) / 7.0) * (i == 0 ? 1.0 : 0.8);
      dens += w;
      across += w * float(i);
      float d = abs(float(k)) + abs(float(i)) * 0.5;
      if (d < near) { near = d; code = c; }
    }
  }
  outColor = vec4(min(1.0, dens / 4.0), dens > 0.0 ? across / dens * 0.5 + 0.5 : 0.5, code / 255.0, 1.0);
}`,he=`
uniform sampler2D uBack;
uniform sampler2D uGrain;
uniform sampler2D uTop;
uniform sampler2D uPal;
uniform sampler2D uAir;
uniform vec2 uGrid;
uniform vec2 uGrainPx;
uniform float uDpr;
uniform vec2 uSunAt;
uniform vec3 uShadow, uLit, uDust;
uniform float uDeep, uOutline, uCrest;
uniform vec4 uBursts[4];
uniform int uInk;
float grainAt(vec2 g) {
  if (g.x < 0.0 || g.y < 0.0 || g.x >= uGrid.x || g.y >= uGrid.y) return 0.0;
  return texelFetch(uGrain, ivec2(g), 0).r * 255.0;
}
float T(float c) { return texelFetch(uTop, ivec2(clamp(c, 0.0, uGrid.x - 1.0), 0), 0).r; }
// The surface, a line through each stack's top, eased with its neighbours': smooth, not stepped.
float eased(float c) { return (T(c - 1.0) + 2.0 * T(c) + T(c + 1.0)) * 0.25; }
float surface(float x) {
  float xc = x - 0.5;
  float i = floor(xc);
  return mix(eased(i), eased(i + 1.0), xc - i);
}
vec3 palette(float code) { return texelFetch(uPal, ivec2(int(code) - 1, 0), 0).rgb; }
// The strata here: of the stacked grains round this point, the one whose place round the colours'
// cycle is nearest the blend of theirs, so each band is flat and its edge runs smoothly between
// grains instead of stepping from one to the next.
vec3 strata(vec2 g) {
  vec2 b = g - 0.5;
  vec2 i = floor(b);
  vec2 f = b - i;
  float codes[4];
  float sum = 0.0, w = 0.0;
  for (int k = 0; k < 4; k++) {
    vec2 o = vec2(float(k & 1), float(k >> 1));
    vec2 at = i + o;
    float c = grainAt(at);
    codes[k] = c < 0.5 || at.y < T(at.x) ? 0.0 : c;
    if (codes[k] < 0.5) continue;
    float wk = mix(1.0 - f.x, f.x, o.x) * mix(1.0 - f.y, f.y, o.y) + 1e-4;
    sum += floor((codes[k] - 1.0) / ${E}.0) * wk;
    w += wk;
  }
  if (w <= 0.0) return palette(max(1.0, grainAt(vec2(floor(g.x), T(floor(g.x))))));
  float hue = sum / w, best = 1e9, code = 1.0;
  for (int k = 0; k < 4; k++) {
    if (codes[k] < 0.5) continue;
    float d = abs(floor((codes[k] - 1.0) / ${E}.0) - hue);
    if (d < best) { best = d; code = codes[k]; }
  }
  return palette(code);
}
void main() {
  vec2 p = gl_FragCoord.xy / uDpr;
  vec2 g = p / uGrainPx;
  vec3 col = texelFetch(uBack, ivec2(gl_FragCoord.xy), 0).rgb;
  float mask = 0.0;
  float depth = g.y - surface(g.x);
  float aa = 1.0 / (uGrainPx.y * uDpr);
  if (depth > -aa) {
    // The surface's slope here, its normal, and the low sun's light on it.
    float dydx = (surface(g.x + 1.5) - surface(g.x - 1.5)) / 3.0 * uGrainPx.y / uGrainPx.x;
    vec2 n = normalize(vec2(dydx, 1.0));
    vec2 l = normalize(vec2(sign(uSunAt.x - p.x) * 0.9, 0.42));
    float sun = max(0.0, dot(n, l));
    vec3 face = mix(uShadow, uLit, smoothstep(0.15, 0.85, sun));
    vec3 band = strata(g);
    // Lit at its face, the strata's own colour, darker, deep down; the crest on the sun's side
    // catching the light.
    float crest = smoothstep(0.35, 0.8, sun) * smoothstep(uCrest, 0.0, depth);
    vec3 s = band * mix(face, vec3(uDeep), smoothstep(1.5, 16.0, depth));
    s += band * uLit * 0.3 * crest;
    col = mix(col, s, clamp(depth / aa + 0.5, 0.0, 1.0));
    if (depth > 0.0 && depth < uOutline) mask = 0.5;
    if (crest > 0.3) mask = 1.0;
  } else {
    // In the air: the falling grains' ribbon, from this column's and its neighbours' streams, each
    // where its stream runs across, between this row and the next.
    vec2 a = g - vec2(0.0, 0.5);
    float c0 = floor(g.x), r0 = floor(a.y), fy = a.y - r0;
    float best = 0.0;
    vec3 rib = vec3(0.0);
    for (int i = -1; i <= 1; i++) {
      float cx = c0 + float(i);
      vec4 u = texelFetch(uAir, ivec2(clamp(vec2(cx, r0), vec2(0.0), uGrid - 1.0)), 0);
      vec4 v = texelFetch(uAir, ivec2(clamp(vec2(cx, r0 + 1.0), vec2(0.0), uGrid - 1.0)), 0);
      float dens = mix(u.r, v.r, fy);
      if (dens <= 0.0) continue;
      float centre = cx + 0.5 + (mix(u.g, v.g, fy) * 2.0 - 1.0);
      float k = smoothstep(0.1, 0.5, dens) * clamp(uGrainPx.x * 0.3 - abs(g.x - centre) * uGrainPx.x + 0.5, 0.0, 1.0);
      if (k > best) {
        best = k;
        float code = (fy < 0.5 ? u.b : v.b) * 255.0;
        rib = palette(max(1.0, code > 0.5 ? code : (u.b + v.b) * 255.0));
      }
    }
    if (best > 0.0) col = mix(col, rib * mix(uShadow, uLit, 0.75), best);
  }
  // A click's puff of dust: a ring of light, spreading and fading.
  for (int b = 0; b < 4; b++) {
    vec4 u = uBursts[b];
    if (u.w <= 0.0) continue;
    float k = smoothstep(12.0, 0.0, abs(length(p - u.xy) - u.z)) * u.w * 0.6;
    col = uInk == 1 ? mix(col, uDust, k) : col + uDust * k;
  }
  outColor = vec4(col, mask);
}`,Ft={dark:1.2,light:.55},J=class{constructor(t,r){this.canvas=t;this.gl=r;this.chars=new X(r),this.backdrop=T(r,le),this.sand=T(r,he),this.air=T(r,ce)}canvas;gl;chars;backdrop;sand;air;palette=Y.dark;ink=!1;family=`"${M}", monospace`;width=0;height=0;dpr=1;laidOut="";gcols=0;grows=0;grainTex=null;topTex=null;palTex=null;forceTex=null;back=null;pic=null;airT=null;streamRgb=[];streamSlot=0;sparkSlot=0;grainBuf=new Uint8Array(0);topBuf=new Float32Array(0);forceBuf=new Uint8Array(0);buttes=new Float32Array(W*G*4);stars=[];starRgb=[255,255,255];cols=0;rows=0;resize(t,r,e){this.width=t,this.height=r,this.dpr=e,this.canvas.width=Math.round(t*e),this.canvas.height=Math.round(r*e)}setLook(t){this.ink=!t.dark,this.palette=t.dark?Y.dark:Y.light,this.family=t.mono.trim()?`"${M}", ${t.mono}, monospace`:`"${M}", monospace`,this.laidOut=""}skyline(){let t=this.width,r=this.height;for(let e=0;e<W;e++)for(let i=0;i<G;i++){let s=n=>U(e*31+i*7+n,Math.round(t/50)*13+Math.round(r/50)),l=(e*G+i)*4,a=t*((i+.1+.8*s(1))/G)+(e-1)*t*.06;e>0&&Math.abs(a-t*N)<t*.1&&(a+=(a<t*N?-1:1)*t*.1),this.buttes[l]=a,this.buttes[l+1]=t*(.025+.045*s(2))*(1+e*.2),this.buttes[l+2]=r*(.04+.035*s(3))*(1+e*.45)*(s(4)<.3?.55:1),this.buttes[l+3]=t*(.008+.008*s(5))}}starField(t){let r=this.palette;if(this.stars=[],r.stars<=0)return;let e=t.gh*2,i=this.width*N,s=this.height*(r.horizon-st),l=oe.map(a=>this.chars.slot(a));for(let a=0;a<this.rows;a++){let n=(a+.5)*e;if(n>this.height*r.horizon*ie)break;for(let u=0;u<this.cols;u++){let f=(u+.5)*t.gw;if(U(u*3+1,a*5+2)>=r.stars||Math.hypot(f-i,n-s)<this.height*.22||this.stars.at(-1)?.cell===a*this.cols+u-1)continue;let h=U(u,a+99);this.stars.push({cell:a*this.cols+u,slot:l[h<.3?0:1],bright:.45+.55*U(u+5,a),phase:h*40,speed:.6+1.6*U(a,u+11)})}}}layout(t){let r=`${t.cols}x${t.rows}:${t.gw}x${t.gh}@${this.dpr}:${this.family}:${this.ink}:${this.width}x${this.height}`;if(r===this.laidOut)return;this.laidOut=r;let e=this.gl;this.cols=t.cols,this.rows=Math.ceil(t.rows/2);let i=t.gw*this.dpr,s=t.gh*2*this.dpr;this.chars.layout(this.cols,this.rows,i,s,`600 ${Math.round(s*.74)}px ${this.family}`);let l=this.canvas.width,a=this.canvas.height;if(t.cols!==this.gcols||t.rows!==this.grows||!this.grainTex){for(let h of[this.grainTex,this.topTex,this.forceTex])h&&e.deleteTexture(h);this.gcols=t.cols,this.grows=t.rows,this.grainBuf=new Uint8Array(t.cols*t.rows),this.topBuf=new Float32Array(t.cols),this.forceBuf=new Uint8Array(this.cols*this.rows*4),this.grainTex=D(e,t.cols,t.rows,!1,null,"r8"),F(e,this.airT),this.airT=A(e,t.cols,t.rows,!1),this.topTex=D(e,t.cols,1,!1,null,"r32f"),this.forceTex=D(e,this.cols,this.rows,!1,null)}(!this.pic||this.pic.w!==l||this.pic.h!==a)&&(F(e,this.pic),F(e,this.back),this.pic=A(e,l,a),this.back=A(e,l,a,!1)),this.palTex&&e.deleteTexture(this.palTex);let n=new Uint8Array(P*4),u=y(this.palette.lit),f=this.ink?Ft.light:Ft.dark;this.streamRgb=[[0,0,0]];for(let h=1;h<=P;h++){let c=it(this.palette.sands,h,0);n.set([...c,255],(h-1)*4),this.streamRgb.push(c.map((m,p)=>Math.min(255,Math.round(m*u[p]*f/255))))}this.palTex=D(e,P,1,!1,n),this.streamSlot=this.chars.slot(se),this.sparkSlot=this.chars.slot(ne),this.skyline(),this.paintBackdrop(),this.starField(t),this.starRgb=y(this.palette.star)}paintBackdrop(){let t=this.gl,r=this.palette,e=i=>y(i).map(s=>s/255);w(t,this.backdrop,this.back,i=>{t.uniform2f(i.at("uSize"),this.width,this.height),t.uniform1f(i.at("uDpr"),this.dpr),r.sky.forEach((s,l)=>t.uniform3fv(i.at(`uSky${l}`),e(s))),t.uniform3fv(i.at("uPlainFar"),e(r.plain[0])),t.uniform3fv(i.at("uPlainNear"),e(r.plain[1])),t.uniform3fv(i.at("uSun"),e(r.sun)),t.uniform3fv(i.at("uSunGlow"),e(r.sunGlow)),t.uniform3fv(i.at("uMesa"),e(r.mesa)),t.uniform3fv(i.at("uMesaLit"),e(r.mesaLit)),t.uniform3fv(i.at("uDune"),e(r.dune)),t.uniform3fv(i.at("uDuneLit"),e(r.duneLit)),t.uniform2f(i.at("uSunAt"),this.width*N,this.height*(r.horizon-st)),t.uniform1f(i.at("uSunR"),re),t.uniform1f(i.at("uGlowK"),r.glow),t.uniform1f(i.at("uGlowWide"),Gt[0]),t.uniform1f(i.at("uGlowClose"),Gt[1]),t.uniform1f(i.at("uHorizonY"),this.height*r.horizon),t.uniform4fv(i.at("uButtes"),this.buttes),t.uniform1fv(i.at("uHazes"),r.hazes),t.uniform1i(i.at("uInk"),this.ink?1:0)})}force(t){let r=this.forceBuf;r.fill(0);let e=(l,[a,n,u],f)=>{let h=l*4;r[h]=a,r[h+1]=n,r[h+2]=u,r[h+3]=f},i=[0,0,0];for(let l of this.stars)e(l.cell,_(i,this.starRgb,l.bright*(.6+.4*Math.sin(t.time*l.speed+l.phase))),l.slot);let{cols:s}=t;for(let l=0;l<s;l++){let a=this.topBuf[l]-1;for(let n=0;n<a;n++){let u=t.grain[n*s+l];u&&e((n>>1)*s+l,this.streamRgb[u],this.streamSlot)}}for(let l of t.flying){let a=t.cellAt(l.x,l.y);if(a<0)continue;let n=a/s|0;e((n>>1)*s+(a-n*s),this.streamRgb[l.code],this.sparkSlot)}}draw(t){if(!t.cols||!this.width||this.gl.isContextLost())return;this.layout(t);let r=this.gl,{cols:e,rows:i}=t;this.grainBuf.set(t.grain);for(let h of t.flying){let c=t.cellAt(h.x,h.y);c>=0&&(this.grainBuf[c]=h.code)}for(let h=0;h<e;h++){let c=i-1;for(;c>=0&&t.grain[c*e+h];)c--;this.topBuf[h]=c+1}H(r,this.grainTex,e,i,this.grainBuf,"r8"),H(r,this.topTex,e,1,this.topBuf,"r32f"),this.force(t),H(r,this.forceTex,this.cols,this.rows,this.forceBuf),w(r,this.air,this.airT,h=>{x(r,h,"uGrain",this.grainTex,0),x(r,h,"uTop",this.topTex,1),r.uniform2f(h.at("uGrid"),e,i)});let s=this.palette,l=h=>y(h).map(c=>c/255),a=new Float32Array(16);t.bursts.slice(-4).forEach((h,c)=>{let m=t.time-h.at;m<0||m>=z||a.set([h.x,h.y,ot*m,1-m/z],c*4)}),w(r,this.sand,this.pic,h=>{x(r,h,"uBack",this.back.tex,0),x(r,h,"uGrain",this.grainTex,1),x(r,h,"uTop",this.topTex,2),x(r,h,"uPal",this.palTex,3),x(r,h,"uAir",this.airT.tex,4),r.uniform2f(h.at("uGrid"),e,i),r.uniform2f(h.at("uGrainPx"),t.gw,t.gh),r.uniform1f(h.at("uDpr"),this.dpr),r.uniform2f(h.at("uSunAt"),this.width*N,this.height*(s.horizon-st)),r.uniform3fv(h.at("uShadow"),l(s.shadow)),r.uniform3fv(h.at("uLit"),l(s.lit)),r.uniform3fv(h.at("uDust"),l(s.dust)),r.uniform1f(h.at("uDeep"),s.deep),r.uniform1f(h.at("uOutline"),ae),r.uniform1f(h.at("uCrest"),ue),r.uniform4fv(h.at("uBursts"),a),r.uniform1i(h.at("uInk"),this.ink?1:0)});let n=this.ink?l(s.sky[3]):[0,0,0],u=this.canvas.width,f=this.canvas.height;this.chars.draw(this.pic.tex,this.forceTex,{...s.look,ink:this.ink,base:n},u,f,t.gw*this.dpr,t.gh*2*this.dpr,{w:u,h:f})}};await ht(new j,o=>{let t=at(o);return t?new J(o,t):new V(o)});
