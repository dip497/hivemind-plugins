function J(e){return e.getContext("webgl2",{alpha:!1,antialias:!1,depth:!1,stencil:!1,premultipliedAlpha:!1,preserveDrawingBuffer:!0,powerPreference:"low-power"})}var gt=`#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`,vt=`#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 outColor;
`;function Z(e,r,t){let o=e.createShader(r);if(e.shaderSource(o,t),e.compileShader(o),!e.getShaderParameter(o,e.COMPILE_STATUS)&&!e.isContextLost())throw new Error(`shader: ${e.getShaderInfoLog(o)}`);return o}function F(e,r){let t=e.createProgram();if(e.attachShader(t,Z(e,e.VERTEX_SHADER,gt)),e.attachShader(t,Z(e,e.FRAGMENT_SHADER,vt+r)),e.linkProgram(t),!e.getProgramParameter(t,e.LINK_STATUS)&&!e.isContextLost())throw new Error(`program: ${e.getProgramInfoLog(t)}`);let o=new Map;return{program:t,at(a){return o.has(a)||o.set(a,e.getUniformLocation(t,a)),o.get(a)}}}function C(e,r,t,o,a=null,i="rgba8"){let c=e.createTexture();e.bindTexture(e.TEXTURE_2D,c);let l=o?e.LINEAR:e.NEAREST;return e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,l),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,l),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.pixelStorei(e.UNPACK_ALIGNMENT,1),i==="r8"?e.texImage2D(e.TEXTURE_2D,0,e.R8,r,t,0,e.RED,e.UNSIGNED_BYTE,a):i==="r32f"?e.texImage2D(e.TEXTURE_2D,0,e.R32F,r,t,0,e.RED,e.FLOAT,a):e.texImage2D(e.TEXTURE_2D,0,e.RGBA8,r,t,0,e.RGBA,e.UNSIGNED_BYTE,a),c}function Q(e,r,t,o,a,i="rgba8"){e.bindTexture(e.TEXTURE_2D,r),e.pixelStorei(e.UNPACK_ALIGNMENT,1),i==="r8"?e.texSubImage2D(e.TEXTURE_2D,0,0,0,t,o,e.RED,e.UNSIGNED_BYTE,a):i==="r32f"?e.texSubImage2D(e.TEXTURE_2D,0,0,0,t,o,e.RED,e.FLOAT,a):e.texSubImage2D(e.TEXTURE_2D,0,0,0,t,o,e.RGBA,e.UNSIGNED_BYTE,a)}function S(e,r,t,o=!0){let a=C(e,r,t,o),i=e.createFramebuffer();return e.bindFramebuffer(e.FRAMEBUFFER,i),e.framebufferTexture2D(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,a,0),e.bindFramebuffer(e.FRAMEBUFFER,null),{tex:a,fbo:i,w:r,h:t}}function tt(e,r){r&&(e.deleteTexture(r.tex),e.deleteFramebuffer(r.fbo))}function k(e,r,t,o){e.bindFramebuffer(e.FRAMEBUFFER,t.fbo??null),e.viewport(0,0,t.w,t.h),e.useProgram(r.program),o(r),e.drawArrays(e.TRIANGLES,0,3)}function g(e,r,t,o,a){e.activeTexture(e.TEXTURE0+a),e.bindTexture(e.TEXTURE_2D,o),e.uniform1i(r.at(t),a)}var et=`
uniform sampler2D uSrc;
uniform vec2 uStep;
void main() {
  vec4 sum = texture(uSrc, vUv) * 0.2270270270;
  sum += (texture(uSrc, vUv + uStep * 1.3846153846) + texture(uSrc, vUv - uStep * 1.3846153846)) * 0.3162162162;
  sum += (texture(uSrc, vUv + uStep * 3.2307692308) + texture(uSrc, vUv - uStep * 3.2307692308)) * 0.0702702703;
  outColor = sum;
}`;function W(e,r,t,o,a,i){k(e,r,o,()=>{g(e,r,"uSrc",t,0),e.uniform2f(r.at("uStep"),i/3.23/o.w,0)}),k(e,r,a,()=>{g(e,r,"uSrc",o.tex,0),e.uniform2f(r.at("uStep"),0,i/3.23/a.h)})}import{connectWallpaper as Mt}from"@hivemind/view-sdk";import{SCENE_STEP as yt,SETTLE_STEPS as Tt}from"@hivemind/view-sdk";function rt(e,r,t){let o=[e.on("viewport",l=>{r.resize(l.w,l.h),t.resize(l.w,l.h,l.dpr)}),e.on("look",l=>t.setLook(l)),e.on("mode",l=>{l!=="run"&&r.point(0,0,!1)}),e.on("pointer",({x:l,y:u,over:f})=>r.point(l,u,f&&e.mode==="run")),e.on("click",({x:l,y:u})=>{e.mode==="run"&&r.splash(l,u)})],a=!1,i=l=>{a=!0,r.step(l)},c=e.animate({step:i,draw:()=>t.draw(r),settle:()=>{if(!a)for(let l=0;l<Tt;l++)i(yt)}});return()=>{c();for(let l of o)l()}}var R="Patterns Mono",wt=2e3,X={file:"jetbrains-mono-latin-600-normal.woff2",range:"U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"},ot={file:"jetbrains-mono-greek-600-normal.woff2",range:"U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF"};function Rt(){let e=document.createElement("canvas");return Object.assign(e.style,{position:"fixed",inset:"0",width:"100%",height:"100%",display:"block"}),document.body.append(e),e}function Et(e,r){let t=r.map(({file:o,range:a})=>{let i=new FontFace(R,`url(${JSON.stringify(new URL(o,e).href)}) format("woff2")`,{weight:"600",unicodeRange:a});return document.fonts.add(i),i.load().then(()=>{},()=>{})});return Promise.race([Promise.all(t).then(()=>{}),new Promise(o=>setTimeout(o,wt))])}async function nt(e,r,t=[X]){let o=Rt(),[a]=await Promise.all([Mt(),Et(new URL("../fonts/",import.meta.url),t)]);rt(a,e,r(o))}var N=2;function at(e,r,t,o,a,i){i&&e.deleteTexture(i.tex);let c=[...new Set(r)],l=t+N*2,u=l*c.length,s=new OffscreenCanvas(u,o).getContext("2d",{willReadFrequently:!0});s.fillStyle="#000",s.fillRect(0,0,u,o),s.fillStyle="#fff",s.font=a,s.textAlign="center",s.textBaseline="middle",c.forEach((n,h)=>s.fillText(n,h*l+l/2,o/2+o*.03));let d=s.getImageData(0,0,u,o).data,m=new Uint8Array(u*o);for(let n=0;n<m.length;n++)m[n]=d[n*4];let b=new Map;return c.forEach((n,h)=>{let p=0;for(let x=0;x<o;x++)for(let w=h*l+N;w<h*l+N+t;w++)p+=m[x*u+w];b.set(n,p/(255*t*o))}),{tex:C(e,u,o,!0,m,"r8"),count:c.length,slot:new Map(c.map((n,h)=>[n,h+1])),coverage:b,slotU:l/u,padU:N/u,cellU:t/u}}var st=e=>e<=.04045?e/12.92:((e+.055)/1.055)**2.4,ut=e=>e<=.0031308?12.92*e:1.055*e**.4166666666666667-.055;function ct(e,r,t){let o=(e+.3963377774*r+.2158037573*t)**3,a=(e-.1055613458*r-.0638541728*t)**3,i=(e-.0894841775*r-1.291485548*t)**3;return[4.0767416621*o-3.3077115913*a+.2309699292*i,-1.2684380046*o+2.6097574011*a-.3413193965*i,-.0041960863*o-.7034186147*a+1.707614701*i]}function it(e,r,t){let o=Math.cbrt(.4122214708*e+.5363325363*r+.0514459929*t),a=Math.cbrt(.2119034982*e+.6806995451*r+.1073969566*t),i=Math.cbrt(.0883024619*e+.2817188376*r+.6299787005*t);return[.2104542553*o+.793617785*a-.0040720468*i,1.9779984951*o-2.428592205*a+.4505937099*i,.0259040371*o+.7827717662*a-.808675766*i]}var lt=e=>e.every(r=>r>=-1e-4&&r<=1+1e-4);function v([e,r,t]){let o=i=>ct(e,i*Math.cos(t*Math.PI/180),i*Math.sin(t*Math.PI/180)),a=o(r);if(!lt(a)){let i=0,c=r;for(let l=0;l<20;l++){let u=(i+c)/2;lt(o(u))?i=u:c=u}a=o(i)}return a.map(i=>Math.round(ut(Math.min(1,Math.max(0,i)))*255))}function A(e,r,t){let[o,a,i]=it(...e.map(s=>st(s/255))),[c,l,u]=it(...r.map(s=>st(s/255)));return ct(o+(c-o)*t,a+(l-a)*t,i+(u-i)*t).map(s=>Math.round(ut(Math.min(1,Math.max(0,s)))*255))}var G=([e,r,t])=>`#${(1<<24|e<<16|r<<8|t).toString(16).slice(1)}`,K=([e,r,t],o)=>`rgba(${e},${r},${t},${+o.toFixed(3)})`;var L={dark:{ground:[[.135,.03,292],[.14,.032,278],[.148,.034,255]],glow:{colour:[.3,.07,230],alpha:.18},head:[.95,.045,192],tail:[[.8,.12,186],[.6,.13,250],[.42,.14,300]],haze:[.2,.045,268]},light:{ground:[[.972,.008,95],[.965,.01,90],[.955,.013,84]],glow:{colour:[.99,.01,95],alpha:.5},head:[.2,.035,265],tail:[[.36,.03,262],[.56,.018,255],[.78,.01,250]],haze:[.955,.01,90]}};var V=(e,r,t)=>e<r?r:e>t?t:e,I=(e,r)=>e+Math.random()*(r-e),T=(e,r)=>e+Math.floor(Math.random()*(r-e+1));var M="0123456789ABEFHKMNRTVXZ+=*<>/\\|#%&$@?!:;^~\xA7\xB6\xB1\xD7\xF7\xA4\u0394\u0398\u039B\u039E\u03A0\u03A3\u03A6\u03A8\u03A9\u03B1\u03B2\u03B3\u03B4\u03B6\u03B7\u03B8\u03BB\u03BC\u03BE\u03C0\u03C3\u03C6\u03C8\u03C9",U=[{size:.58,speed:[5,9],length:[16,34],share:1,light:.5},{size:.78,speed:[6,11],length:[14,30],share:.8,light:.75},{size:1,speed:[7,13],length:[12,26],share:.6,light:1}],At=.12,y=120,z=.3,St=4,Ut=7,Pt=.28,kt=8,ht=380,mt=520,_=16,O=class{width=0;height=0;layers=[];time=0;pointer={x:0,y:0,active:!1};part=0;centre={x:0,y:0};rings=[];resize(r,t){let o=V(Math.min(r,t)/900,.75,1.6)*19,a=this.layers.length?{layers:this.layers,width:this.width,height:this.height}:null;this.width=r,this.height=t,this.layers=U.map((i,c)=>{let l=Math.round(o*i.size),u=Math.round(l*.92),f=Math.round(l*1.12),s=Math.ceil(r/u),d=Math.ceil(t/f),m=new Uint8Array(s*d);for(let p=0;p<m.length;p++)m[p]=T(0,M.length-1);let b={size:l,cw:u,ch:f,cols:s,rows:d,glyphs:m,streams:[],lit:new Float32Array(s*d),litCells:[]},n=Math.max(4,Math.round(s*i.share)),h=a?.layers[c];if(h){for(let p of h.streams)b.streams.push({...p,col:Math.min(s-1,Math.floor((p.col+.5)/h.cols*s)),head:p.head/h.rows*d});for(let p=0;p<Math.min(d,h.rows);p++)for(let x=0;x<Math.min(s,h.cols);x++)m[p*s+x]=h.glyphs[p*h.cols+x];for(;b.streams.length>n;)b.streams.splice(T(0,b.streams.length-1),1)}for(;b.streams.length<n;)b.streams.push(this.stream(b,c,I(-.2,1.3)*d));return b})}stream(r,t,o){let a=U[t],i=T(0,r.cols-1);for(let c=0;c<8&&r.streams.some(l=>l.col===i);c++)i=T(0,r.cols-1);return{col:i,head:o,speed:I(a.speed[0],a.speed[1]),length:T(a.length[0],a.length[1])}}point(r,t,o){Object.assign(this.pointer,{x:r,y:t,active:o}),o&&(this.centre={x:r,y:t})}splash(r,t){this.rings.push({x:r,y:t,at:this.time}),this.rings.length>3&&this.rings.shift()}push(r,t){if(this.part<=0)return 0;let o=r-this.centre.x,a=(t-this.centre.y)*.85,i=o*o+a*a;if(i>=y*y)return 0;let c=1-Math.sqrt(i)/y;return(o<0?-1:1)*y*z*c*c*this.part}step(r){this.layers.length&&(this.time+=r,this.part=V(this.part+(this.pointer.active?1:-1)*St*r,0,1),this.rings=this.rings.filter(t=>ht*(this.time-t.at)<mt),this.layers.forEach((t,o)=>{let{glyphs:a,cols:i,rows:c,lit:l}=t;for(let s of t.streams){let d=Math.floor(s.head);s.head+=s.speed*r;let m=Math.floor(s.head);m!==d&&m>=0&&m<c&&(a[m*i+s.col]=T(0,M.length-1))}for(let s=0;s<t.streams.length;s++)t.streams[s].head-t.streams[s].length<c||(t.streams.splice(s,1),t.streams.push(this.stream(t,o,I(-.35,0)*c)),s--);for(let s=Ct(At*i*c*r);s>0;s--)a[T(0,a.length-1)]=T(0,M.length-1);let u=Math.exp(-r*kt),f=[];for(let s of t.litCells)l[s]=l[s]*u,l[s]<.02?l[s]=0:f.push(s);t.litCells=f,this.part>0&&this.flicker(t,r);for(let s of this.rings)this.scramble(t,s)}))}flicker(r,t){let{x:o,y:a}=this.centre,{cw:i,ch:c,cols:l,rows:u}=r,f=Math.max(0,Math.floor((o-y)/i)),s=Math.min(l-1,Math.floor((o+y)/i)),d=Math.max(0,Math.floor((a-y)/c)),m=Math.min(u-1,Math.floor((a+y)/c));for(let b=d;b<=m;b++)for(let n=f;n<=s;n++){let h=Math.hypot((n+.5)*i-o,(b+.5)*c-a);if(h>=y)continue;let p=(1-h/y)*this.part,x=b*l+n;Math.random()<Ut*p*t&&(r.glyphs[x]=T(0,M.length-1),ft(r,x,Pt*p))}}scramble(r,t){let o=ht*(this.time-t.at),a=1-o/mt,{cw:i,ch:c,cols:l,rows:u}=r,f=Math.max(0,Math.floor((t.y-o-_)/c)),s=Math.min(u-1,Math.floor((t.y+o+_)/c));for(let d=f;d<=s;d++){let m=(d+.5)*c-t.y,b=Math.sqrt(Math.max(0,(o+_)**2-m*m)),n=Math.sqrt(Math.max(0,(o-_)**2-m*m));for(let h of[-1,1]){let p=t.x+h*n,x=t.x+h*b,w=Math.max(0,Math.floor(Math.min(p,x)/i)),P=Math.min(l-1,Math.floor(Math.max(p,x)/i));for(let E=w;E<=P;E++){let Y=d*l+E,xt=Math.hypot((E+.5)*i-t.x,m),q=1-Math.abs(xt-o)/_;q<=0||(Math.random()<.35&&(r.glyphs[Y]=T(0,M.length-1)),ft(r,Y,.8*q*a))}}}}};function ft(e,r,t){t<=e.lit[r]||(e.lit[r]||e.litCells.push(r),e.lit[r]=t)}function Ct(e){if(e>30)return Math.round(e+Math.sqrt(e)*(Math.random()+Math.random()+Math.random()-1.5)*2);let r=0;for(let t=Math.exp(-e),o=t,a=Math.random();a>o;r++)t*=e/(r+1),o+=t;return r}var Lt=1.1,pt={dark:.08,light:0},dt={dark:[.42,.18],light:[.55,.22]},Dt=`
uniform sampler2D uFar;
uniform sampler2D uMid, uMidAtlas, uMidRamp;
uniform sampler2D uNear, uNearAtlas, uNearRamp;
uniform sampler2D uBloom;
uniform vec2 uView;
uniform vec2 uMidCell, uNearCell;
uniform ivec2 uMidGrid, uNearGrid;
uniform vec3 uMidAtlasU, uNearAtlasU;
uniform vec3 uTop, uMidSky, uBottom, uGlow, uHaze;
uniform float uGlowK, uHaze0, uHaze1, uBloomK, uDpr;
uniform vec3 uPart;
uniform float uReach, uPush;
uniform int uInk;
float push(vec2 p) {
  if (uPart.z <= 0.0) return 0.0;
  vec2 d = vec2(p.x - uPart.x, (p.y - uPart.y) * 0.85);
  float r = length(d);
  if (r >= uReach) return 0.0;
  float near = 1.0 - r / uReach;
  return (d.x < 0.0 ? -1.0 : 1.0) * uReach * uPush * near * near * uPart.z;
}
vec4 glyphAt(vec2 px, sampler2D cells, sampler2D atlas, sampler2D ramp, vec2 cellSize, ivec2 grid, vec3 atlasU) {
  float sx = px.x - push(px);
  vec2 cell = floor(vec2(sx, px.y) / cellSize);
  if (cell.x < 0.0 || cell.x >= float(grid.x) || cell.y >= float(grid.y)) return vec4(0.0);
  vec2 centre = (cell + 0.5) * cellSize;
  float left = centre.x + push(centre) - cellSize.x * 0.5;
  vec2 inCell = vec2((px.x - left) / cellSize.x, px.y / cellSize.y - cell.y);
  if (inCell.x < 0.0 || inCell.x >= 1.0) return vec4(0.0);
  vec4 c = texelFetch(cells, ivec2(cell), 0);
  float slot = floor(c.g * 255.0 + 0.5);
  if (slot < 0.5) return vec4(0.0);
  float cov = texture(atlas, vec2((slot - 1.0) * atlasU.x + atlasU.y + inCell.x * atlasU.z, inCell.y)).r;
  return vec4(texture(ramp, vec2(c.r, 0.5)).rgb, cov);
}
void main() {
  vec2 dev = vec2(gl_FragCoord.x, uView.y - gl_FragCoord.y);
  vec2 uv = dev / uView;
  vec2 px = dev / uDpr;
  vec3 sky = uv.y < 0.5 ? mix(uTop, uMidSky, uv.y * 2.0) : mix(uMidSky, uBottom, uv.y * 2.0 - 1.0);
  float g = exp(-pow(length((uv - vec2(0.5, 1.05)) * vec2(1.0, 1.6)) / 0.75, 2.0));
  sky = uInk == 1 ? mix(sky, uGlow, g * uGlowK) : sky + uGlow * g * uGlowK;
  vec4 far = texture(uFar, uv);
  vec4 mid = glyphAt(px, uMid, uMidAtlas, uMidRamp, uMidCell, uMidGrid, uMidAtlasU);
  vec4 near = glyphAt(px, uNear, uNearAtlas, uNearRamp, uNearCell, uNearGrid, uNearAtlasU);
  vec3 bloom = texture(uBloom, uv).rgb;
  vec3 col;
  if (uInk == 1) {
    col = sky * (1.0 - far.a) + far.rgb;
    col = mix(col, uHaze, uHaze0);
    col = mix(col, mid.rgb, mid.a);
    col = mix(col, uHaze, uHaze1);
    col = mix(col, near.rgb, near.a);
    col *= vec3(1.0) - bloom * uBloomK;
  } else {
    col = sky + far.rgb;
    col = mix(col, uHaze, uHaze0);
    col += mid.rgb * mid.a;
    col = mix(col, uHaze, uHaze1);
    col += near.rgb * near.a;
    col += bloom * uBloomK;
  }
  outColor = vec4(col, 1.0);
}`,Ft=`
uniform sampler2D uCells, uAtlas, uRamp;
uniform vec2 uView;
uniform vec2 uCell;
uniform ivec2 uGrid;
uniform vec3 uAtlasU;
uniform float uDpr, uScale;
uniform vec3 uPart;
uniform float uReach, uPush;
float push(vec2 p) {
  if (uPart.z <= 0.0) return 0.0;
  vec2 d = vec2(p.x - uPart.x, (p.y - uPart.y) * 0.85);
  float r = length(d);
  if (r >= uReach) return 0.0;
  float near = 1.0 - r / uReach;
  return (d.x < 0.0 ? -1.0 : 1.0) * uReach * uPush * near * near * uPart.z;
}
void main() {
  vec2 px = gl_FragCoord.xy * uScale / uDpr;
  float sx = px.x - push(px);
  vec2 cell = floor(vec2(sx, px.y) / uCell);
  vec4 o = vec4(0.0);
  if (cell.x >= 0.0 && cell.x < float(uGrid.x) && cell.y < float(uGrid.y)) {
    vec2 centre = (cell + 0.5) * uCell;
    float left = centre.x + push(centre) - uCell.x * 0.5;
    vec2 inCell = vec2((px.x - left) / uCell.x, px.y / uCell.y - cell.y);
    vec4 c = texelFetch(uCells, ivec2(cell), 0);
    float slot = floor(c.g * 255.0 + 0.5);
    if (slot > 0.5 && inCell.x >= 0.0 && inCell.x < 1.0) {
      float cov = texture(uAtlas, vec2((slot - 1.0) * uAtlasU.x + uAtlasU.y + inCell.x * uAtlasU.z, inCell.y)).r;
      o = vec4(texture(uRamp, vec2(c.r, 0.5)).rgb, 1.0) * cov;
    }
  }
  outColor = o;
}`,Gt=`
uniform sampler2D uCells, uRamp;
uniform float uFrom;
void main() {
  vec4 c = texelFetch(uCells, ivec2(gl_FragCoord.xy), 0);
  float k = smoothstep(uFrom, 1.0, c.r);
  vec3 col = texture(uRamp, vec2(c.r, 0.5)).rgb;
  outColor = vec4(col * k, 1.0);
}`;function _t(e,r){let t=new Uint8Array(r.length*4);return r.forEach((o,a)=>t.set([o[0],o[1],o[2],255],a*4)),C(e,r.length,1,!0,t)}var H=class{constructor(r,t){this.canvas=r;this.gl=t;this.screen=F(t,Dt),this.far=F(t,Ft),this.bright=F(t,Gt),this.blurP=F(t,et)}canvas;gl;screen;far;bright;blurP;depths=U.map(()=>({atlas:null,cells:null,buf:new Uint8Array(0),light:new Float32Array(0),ramp:null,cols:0,rows:0,slots:new Uint8Array(M.length)}));palette=L.dark;ink=!1;family=`"${R}", monospace`;width=0;height=0;dpr=1;laidOut="";farT=null;farTmp=null;farBlur=null;brightT=null;brightTmp=null;bloomT=null;last=-1;resize(r,t,o){this.width=r,this.height=t,this.dpr=o,this.canvas.width=Math.round(r*o),this.canvas.height=Math.round(t*o)}setLook(r){this.ink=!r.dark,this.palette=r.dark?L.dark:L.light,this.family=r.mono.trim()?`"${R}", ${r.mono}, monospace`:`"${R}", monospace`,this.laidOut=""}ramps(){let r=this.palette,t=v(r.ground[1]),o=r.tail.map(v),a=v(r.head),i=64;return U.map(c=>{let l=[];for(let u=0;u<i;u++){let f=u/(i-1),s;f>.97?s=a:f>.5?s=A(o[1],o[0],(f-.5)/.47):s=A(o[2],o[1],f/.5);let d=Math.min(1,.15+f*1.6)*(this.ink?c.light**3:c.light);l.push(A(this.ink?t:[0,0,0],s,d))}return l})}layout(r){let t=`${r.layers.map(u=>`${u.cols}x${u.rows}:${u.size}`).join()}@${this.dpr}:${this.family}:${this.ink}:${this.width}x${this.height}`;if(t===this.laidOut)return;this.laidOut=t;let o=this.gl,a=this.ramps();r.layers.forEach((u,f)=>{let s=this.depths[f],d=`600 ${Math.round(u.size*this.dpr)}px ${this.family}`;s.atlas=at(o,[...M],Math.round(u.cw*this.dpr),Math.round(u.ch*this.dpr),d,s.atlas??void 0),[...M].forEach((m,b)=>{s.slots[b]=s.atlas.slot.get(m)}),s.ramp&&o.deleteTexture(s.ramp),s.ramp=_t(o,a[f]),(s.cols!==u.cols||s.rows!==u.rows||!s.cells)&&(s.cells&&o.deleteTexture(s.cells),s.cols=u.cols,s.rows=u.rows,s.buf=new Uint8Array(u.cols*u.rows*4),s.light=new Float32Array(u.cols*u.rows),s.cells=C(o,u.cols,u.rows,!1,null))});for(let u of[this.farT,this.farTmp,this.farBlur,this.brightT,this.brightTmp,this.bloomT])tt(o,u);let i=Math.max(1,Math.round(this.canvas.width/2)),c=Math.max(1,Math.round(this.canvas.height/2));this.farT=S(o,i,c),this.farTmp=S(o,i,c),this.farBlur=S(o,i,c);let l=this.depths[2];this.brightT=S(o,l.cols,l.rows),this.brightTmp=S(o,l.cols,l.rows),this.bloomT=S(o,l.cols,l.rows)}fill(r,t){let o=Math.exp(-t*Lt),a=this.ink?pt.light:pt.dark;r.layers.forEach((i,c)=>{let l=this.depths[c],{light:u,buf:f}=l;for(let s=0;s<u.length;s++)u[s]=Math.max(a,u[s]*o);for(let s of i.streams){let d=Math.floor(s.head);for(let m=0;m<s.length;m++){let b=d-m;if(b<0)break;if(b>=i.rows)continue;let n=b*i.cols+s.col,h=m===0?1:.9*Math.pow(1-m/s.length,1.3);h>u[n]&&(u[n]=h)}}for(let s=0;s<u.length;s++){let d=Math.min(1,Math.max(u[s],i.lit[s]*.95));f[s*4]=Math.round(d*255),f[s*4+1]=l.slots[i.glyphs[s]],f[s*4+2]=0,f[s*4+3]=255}})}draw(r){if(!r.layers.length||!this.width||this.gl.isContextLost())return;this.layout(r);let t=this.gl,o=this.last<0?10:Math.max(0,Math.min(.25,r.time-this.last));this.last=r.time,this.fill(r,o),this.depths.forEach(n=>Q(t,n.cells,n.cols,n.rows,n.buf));let a=[r.centre.x,r.centre.y,r.part],[i,c,l]=this.depths,[u,f,s]=r.layers,d=n=>[n.slotU,n.padU,n.cellU];k(t,this.far,this.farT,n=>{g(t,n,"uCells",i.cells,0),g(t,n,"uAtlas",i.atlas.tex,1),g(t,n,"uRamp",i.ramp,2),t.uniform2f(n.at("uCell"),u.cw,u.ch),t.uniform2i(n.at("uGrid"),i.cols,i.rows),t.uniform3fv(n.at("uAtlasU"),d(i.atlas)),t.uniform1f(n.at("uDpr"),this.dpr),t.uniform1f(n.at("uScale"),this.canvas.width/this.farT.w),t.uniform3fv(n.at("uPart"),a),t.uniform1f(n.at("uReach"),y),t.uniform1f(n.at("uPush"),z)}),W(t,this.blurP,this.farT.tex,this.farTmp,this.farBlur,this.ink?5:2.2),k(t,this.bright,this.brightT,n=>{g(t,n,"uCells",l.cells,0),g(t,n,"uRamp",l.ramp,1),t.uniform1f(n.at("uFrom"),.75)}),W(t,this.blurP,this.brightT.tex,this.brightTmp,this.bloomT,1.6);let m=this.palette,b=n=>v(n).map(h=>h/255);k(t,this.screen,{w:this.canvas.width,h:this.canvas.height},n=>{g(t,n,"uFar",this.farBlur.tex,0),g(t,n,"uMid",c.cells,1),g(t,n,"uMidAtlas",c.atlas.tex,2),g(t,n,"uMidRamp",c.ramp,3),g(t,n,"uNear",l.cells,4),g(t,n,"uNearAtlas",l.atlas.tex,5),g(t,n,"uNearRamp",l.ramp,6),g(t,n,"uBloom",this.bloomT.tex,7),t.uniform2f(n.at("uView"),this.canvas.width,this.canvas.height),t.uniform2f(n.at("uMidCell"),f.cw,f.ch),t.uniform2f(n.at("uNearCell"),s.cw,s.ch),t.uniform2i(n.at("uMidGrid"),c.cols,c.rows),t.uniform2i(n.at("uNearGrid"),l.cols,l.rows),t.uniform3fv(n.at("uMidAtlasU"),d(c.atlas)),t.uniform3fv(n.at("uNearAtlasU"),d(l.atlas)),t.uniform3fv(n.at("uTop"),b(m.ground[0])),t.uniform3fv(n.at("uMidSky"),b(m.ground[1])),t.uniform3fv(n.at("uBottom"),b(m.ground[2])),t.uniform3fv(n.at("uGlow"),b(m.glow.colour)),t.uniform1f(n.at("uGlowK"),m.glow.alpha),t.uniform3fv(n.at("uHaze"),b(m.haze));let h=this.ink?dt.light:dt.dark;t.uniform1f(n.at("uHaze0"),h[0]),t.uniform1f(n.at("uHaze1"),h[1]),t.uniform1f(n.at("uBloomK"),this.ink?.25:.9),t.uniform1f(n.at("uDpr"),this.dpr),t.uniform3fv(n.at("uPart"),a),t.uniform1f(n.at("uReach"),y),t.uniform1f(n.at("uPush"),z),t.uniform1i(n.at("uInk"),this.ink?1:0)})}};var B=class{constructor(r,t){this.canvas=r;this.palettes=t;let o=r.getContext("2d",{alpha:!1});if(!o)throw new Error("2D canvas unavailable");this.ctx=o,this.palette=t.dark,r.addEventListener("contextrestored",()=>{this.stale=!0})}canvas;palettes;ctx;width=0;height=0;dpr=1;light=!1;palette;family=`"${R}", monospace`;stale=!0;looked=!1;resize(r,t,o){this.width=r,this.height=t,this.dpr=o,this.canvas.width=Math.round(r*o),this.canvas.height=Math.round(t*o),this.stale=!0,this.sized()}setLook(r){let t=this.palettes[r.dark?"dark":"light"],o=this.familyOf(r.mono);this.looked&&t===this.palette&&o===this.family||(this.looked=!0,this.light=!r.dark,this.palette=t,this.family=o,this.styled(),this.stale=!0)}familyOf(r){let t=`"${R}", monospace`;if(!r.trim())return t;let o=`"${R}", ${r}, monospace`;return this.ctx.font="10px serif",this.ctx.font=`600 12px ${o}`,this.ctx.font==="10px serif"?t:o}sized(){}};var j=16,D=j-1,$=class extends B{sky=new OffscreenCanvas(1,1);painted=!1;styles=[];items=Array.from({length:j},()=>({x:[],y:[],g:[]}));constructor(r){super(r,L)}styled(){let r=this.palette,t=r.ground[1],o=a=>a>.5?bt(r.tail[1],r.tail[0],(a-.5)*2):bt(r.tail[2],r.tail[1],a*2);this.styles=U.map(a=>{let i=[""];for(let c=1;c<D;c++){let l=c/(D-1),u=v(o(l)),f=A(v(t),u,Math.min(1,.25+l*1.5)*a.light);i.push(G(f))}return i.push(G(A(v(t),v(r.head),a.light))),i}),this.painted=!1}sized(){this.painted=!1}paintSky(){let{width:r,height:t,dpr:o}=this;(this.sky.width!==this.canvas.width||this.sky.height!==this.canvas.height)&&(this.sky.width=this.canvas.width,this.sky.height=this.canvas.height);let a=this.sky.getContext("2d");if(!a)return;a.setTransform(o,0,0,o,0,0);let i=this.palette,c=a.createLinearGradient(0,0,0,t);i.ground.forEach((u,f)=>c.addColorStop(f/(i.ground.length-1),G(v(u)))),a.fillStyle=c,a.fillRect(0,0,r,t);let l=a.createRadialGradient(r*.5,t*1.05,0,r*.5,t*1.05,Math.max(r,t)*.75);l.addColorStop(0,K(v(i.glow.colour),i.glow.alpha)),l.addColorStop(1,K(v(i.glow.colour),0)),a.fillStyle=l,a.fillRect(0,0,r,t),this.painted=!0}draw(r){if(!r.layers.length||!this.width)return;(!this.painted||this.stale)&&this.paintSky(),this.stale=!1;let t=this.ctx,o=this.dpr;t.setTransform(1,0,0,1,0,0),t.drawImage(this.sky,0,0),t.textAlign="center",t.textBaseline="middle",r.layers.forEach((a,i)=>{let{cw:c,ch:l,cols:u,rows:f,glyphs:s,lit:d}=a;for(let n of this.items)n.x.length=n.y.length=n.g.length=0;let m=(n,h,p)=>{let x=h*u+n,w=(n+.5)*c,P=(h+.5)*l,E=this.items[p];E.x.push((w+r.push(w,P))*o),E.y.push(P*o),E.g.push(s[x])};if(i===r.layers.length-1)for(let n of a.litCells){let h=Math.round(d[n]*(D-3));h>0&&m(n%u,Math.floor(n/u),h)}for(let n of a.streams){let h=Math.floor(n.head);for(let p=0;p<n.length;p++){let x=h-p;if(x<0)break;if(x>=f)continue;let w=d[x*u+n.col],P=p===0?D:Math.min(D-1,Math.max(1,Math.round((D-2)*Math.pow(1-p/n.length,1.25))+1+Math.round(w*6)));m(n.col,x,P)}}t.font=`600 ${Math.round(a.size*o)}px ${this.family}`;let b=this.styles[i];for(let n=1;n<j;n++){let h=this.items[n];if(h.x.length){t.fillStyle=b[n];for(let p=0;p<h.x.length;p++)t.fillText(M[h.g[p]],h.x[p],h.y[p])}}})}};function bt(e,r,t){let o=r[2]-e[2];return o>180&&(o-=360),o<-180&&(o+=360),[e[0]+(r[0]-e[0])*t,e[1]+(r[1]-e[1])*t,(e[2]+o*t+360)%360]}await nt(new O,e=>{let r=J(e);return r?new H(e,r):new $(e)},[X,ot]);
