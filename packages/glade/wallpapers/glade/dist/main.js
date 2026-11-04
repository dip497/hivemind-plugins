import{connectWallpaper as pe}from"@hivemind/view-sdk";var w=o=>[parseInt(o.slice(1,3),16),parseInt(o.slice(3,5),16),parseInt(o.slice(5,7),16)],K=(o,t,e)=>[o[0]+(t[0]-o[0])*e,o[1]+(t[1]-o[1])*e,o[2]+(t[2]-o[2])*e];var O=(o,t=0,e=1)=>o<t?t:o>e?e:o;function Q(o){let t=o>>>0;return()=>{t=t+1831565813>>>0;let e=t;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}}function G(o,t,e=0){let r=Math.imul(o|0,374761393)^Math.imul(t|0,668265263)^Math.imul(e|0,2147483647);return r=Math.imul(r^r>>>13,1274126177),((r^r>>>16)>>>0)/4294967296}function R(o,t,e=0){let r=Math.floor(o),n=Math.floor(t),a=o-r,u=t-n,s=a*a*(3-2*a),i=u*u*(3-2*u),h=G(r,n,e),l=G(r+1,n,e),m=G(r,n+1,e),c=G(r+1,n+1,e);return h+(l-h)*s+(m-h)*i+(h-l-m+c)*s*i}var se=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5],ue=(o,t)=>(se[(t&3)*4+(o&3)]+.5)/16;function F(o,t,e,r){let n=O(t)*(o.length-1),a=Math.floor(n);return o[Math.min(o.length-1,n-a>ue(e,r)?a+1:a)]}var A={EMPTY:0,SOLID:1,LEAF:2,WATER:3,SKY:4},P=o=>{let t=Math.hypot(o[0],o[1],o[2])||1;return[o[0]/t,o[1]/t,o[2]/t]},X=class{constructor(t,e){this.w=t;this.h=e;this.alb=new Uint8Array(t*e*4),this.nrm=new Uint8Array(t*e*4),this.dat=new Float32Array(t*e*4),this.emi=new Uint8Array(t*e*4),this.zb=new Float32Array(t*e).fill(-1e9)}w;h;alb;nrm;dat;emi;zb;put(t,e,r,n,a,u,s,i,h=0,l=0){if(t=Math.round(t),e=Math.round(e),t<0||e<0||t>=this.w||e>=this.h)return!1;let m=e*this.w+t;if(u<this.zb[m])return!1;this.zb[m]=u;let c=m*4;return this.alb[c]=r[0],this.alb[c+1]=r[1],this.alb[c+2]=r[2],this.alb[c+3]=255,this.nrm[c]=(n[0]*.5+.5)*255,this.nrm[c+1]=(n[1]*.5+.5)*255,this.nrm[c+2]=(n[2]*.5+.5)*255,this.nrm[c+3]=s,this.dat[c]=a,this.dat[c+1]=u,this.dat[c+2]=h,this.dat[c+3]=l,i?(this.emi[c]=i[0],this.emi[c+1]=i[1],this.emi[c+2]=i[2],this.emi[c+3]=255):(this.emi[c]=0,this.emi[c+1]=0,this.emi[c+2]=0,this.emi[c+3]=0),!0}matAt(t,e){return this.nrm[(Math.round(e)*this.w+Math.round(t))*4+3]??0}zAt(t,e){return this.zb[Math.round(e)*this.w+Math.round(t)]??-1e9}},E=o=>o*2;function D(o,t,e,r,n,a,u){let s=u.round??1,i=u.bulge??Math.min(r,n),h=u.ragged??0,l=u.seed??0;for(let m=Math.floor(e-n);m<=Math.ceil(e+n);m++)for(let c=Math.floor(t-r);c<=Math.ceil(t+r);c++){let b=(c+.5-t)/r,p=(m+.5-e)/n,f=b*b+p*p;if(h&&(f+=(R(c*.45,m*.45,l)-.5)*h),f>1)continue;let g=Math.sqrt(Math.max(0,1-Math.min(1,b*b+p*p))),d=P([b*s,-p*s,g*s+(1-s)]),M=u.colour(b,p,d,c,m);M&&o.put(c,m,M,d,a-m,E(a)+g*i,u.mat??A.SOLID,u.glow?.(b,p,c,m),0,u.sway??0)}}function V(o,t,e,r,n,a,u={}){let s=u.bulge??e;for(let i=Math.floor(r);i<=Math.ceil(n);i++){let h=(u.lean??0)*(n-i);for(let l=Math.floor(t+h-e);l<=Math.ceil(t+h+e);l++){let m=(l+.5-t-h)/e;if(m<-1||m>1)continue;let c=Math.sqrt(1-m*m),b=a(m,l,i);b&&o.put(l,i,b,[m,0,c],n-i,E(n)+c*s,u.mat??A.SOLID,u.glow?.(m,l,i))}}}function Z(o,t,e,r,n,a,u={}){let s=u.ragged??0,i=u.seed??0,h=u.lift??0;for(let l=Math.floor(e-n);l<=Math.ceil(e+n);l++)for(let m=Math.floor(t-r);m<=Math.ceil(t+r);m++){let c=(m+.5-t)/r,b=(l+.5-e)/n,p=c*c+b*b;if(s&&(p+=(R(m*.3,l*.6,i)-.5)*s),p>1)continue;let f=a(c,b,m,l);f&&o.put(m,l,f,[0,1,0],0,E(l)+h,u.mat??A.SOLID,void 0,u.extra??0)}}function ut(o,t,e,r,n,a,u={}){for(let s=0;s<r;s++){let i=s/Math.max(1,r-1),h=t+n*i*i*r*.5,l=e-s;o.put(h,l,a(i,Math.round(h),l),P([n*.3,.3,1]),s,E(e)+(u.zBias??.5),u.mat??A.LEAF,void 0,0,(u.sway??1)*i)}}var B=(...o)=>o.map(w),S={grass:B("#26401f","#2f4c24","#3a5a2a","#476a31","#557a39"),grassFar:B("#25392a","#2c432f","#344d34"),dirt:B("#3c2f24","#4a3a2b","#5a4733","#6a553d"),bark:B("#2a1f19","#372820","#453227","#553e2f","#664b38"),barkFar:B("#1f1c1d","#272325","#2f2a2b"),leaf:B("#16291b","#1d3421","#254027","#2f4d2e","#3b5b35"),leafFar:B("#17241f","#1c2b25","#22332b"),stone:B("#3f4045","#4d4e54","#5d5e65","#6e6f77","#82838b"),moss:B("#33482a","#405a31"),wood:B("#4a3322","#5b4029","#6d4e33","#7e5c3c"),canvas:B("#6b5f4b","#7c6f58","#8d7f66","#9e9076"),roof:B("#2e3a2a","#384632","#43533a","#4f6043"),water:w("#0f1a22"),pad:B("#2e5a32","#3a6b3c"),cap:B("#5a3a6e","#6b4a82"),glowCap:w("#58d6ff"),window:w("#ffb45e"),lantern:w("#ffc46b"),sky:B("#05070d","#080b14","#0c111d","#111828")},mt=[0,1,0];function Ft(o,t,e,r){for(let n=0;n<t;n++)for(let a=0;a<o.w;a++){let u=n/t,s=F(S.sky,1-u*.85-.08,a,n),i,h=G(a,n,r);if(h>.9965){let p=120+135*G(a,n,r+1);i=[p,p,p*1.05]}else if(h>.9935){let p=50+40*G(a,n,r+2);i=[p*.9,p*.95,p]}let l=a+.5-e.x,m=n+.5-e.y,c=l*l+m*m<e.r*e.r,b=(l-e.r*.55)**2+(m+e.r*.25)**2<(e.r*.92)**2;c&&!b&&(i=[212,206,186]),o.put(a,n,s,[0,0,1],999,-1e3,A.SKY,i)}}var ht=o=>(t,e,r)=>{let n=R(e*.9,r*.12,7)*.7+R(e*2.1,r*.4,8)*.3;return F(o?S.barkFar:S.bark,n*.85+(1-Math.abs(t))*.15,e,r)},lt=(o,t)=>(e,r,n,a,u)=>{let s=R(a*.22,u*.28,t)*.65+R(a*.7,u*.7,t+1)*.35;return F(o?S.leafFar:S.leaf,s*.8+-r*.2+.1,a,u)};function Tt(o,t,e,r,n,a,u,s){let i=Math.max(4,Math.round(r/4));for(let h=0;h<i;h++){let l=u()*Math.PI*2,m=u()*r*.55,c=r*(.42+u()*.3);D(o,t+Math.cos(l)*m,e+Math.sin(l)*m*.8,c,c*.85,n,{colour:lt(a,s+h),mat:A.LEAF,ragged:.5,seed:s+h*13,bulge:c*.8,sway:a?0:.25})}D(o,t,e,r*.7,r*.6,n,{colour:lt(a,s),mat:A.LEAF,ragged:.45,seed:s+99,bulge:r*.5})}function Y(o,t,e,r,n,a,u,s){V(o,t,r/2,n,e,ht(!0),{bulge:r/2}),a>0&&Tt(o,t+(u()-.5)*6,n,a,e,!0,u,s)}function Rt(o,t,e,r,n,a,u){let s=Math.min(...n.map(i=>i.y));V(o,t,r,s,e,ht(!1),{bulge:r});for(let i of[-1,1])for(let h=0;h<3;h++){let l=r*(.55-h*.12),m=t+i*(r*.8+h*r*.45);D(o,m,e-l*.35,l,l*.45,e+1,{colour:(c,b,p,f,g)=>ht(!1)(c,f,g),bulge:l*.6})}for(let i of n)Tt(o,i.x,i.y,i.r,e,!1,a,u+Math.round(i.x))}function ct(o,t,e,r,n,a){for(let u=0;u<4;u++){let s=t+(a()-.5)*r*1.2,i=r*(.55+a()*.35);D(o,s,e-i*.75,i,i*.75,e,{colour:lt(!1,n+u),mat:A.LEAF,ragged:.55,seed:n+u*7,sway:.15})}}function ft(o,t,e,r,n){D(o,t,e-r*.55,r,r*.65,e+.5,{colour:(a,u,s,i,h)=>{let l=F(S.stone,R(i*.5,h*.5,n)*.7+.15,i,h);return s[1]>.55&&R(i*.6,h*.9,n+3)>.45?F(S.moss,R(i,h,n),i,h):l},ragged:.25,seed:n})}function St(o,t,e){for(let r=t;r<o.h;r++){let n=(r-t)/(o.h-t);for(let a=0;a<o.w;a++){let u=R(a*.08,r*.16,e)*.55+R(a*.3,r*.6,e+1)*.3+G(a,r,e)*.15,s=n<.12?F(S.grassFar,u,a,r):F(S.grass,u*.85+.05,a,r);o.put(a,r,s,mt,0,E(r),A.SOLID)}}}function bt(o,t,e,r,n,a){Z(o,t,e,r,n,(u,s,i,h)=>F(S.dirt,R(i*.3,h*.5,a)*.7+.15,i,h),{ragged:.6,seed:a,lift:.01})}function pt(o,t,e,r){for(let n=0;n<t.length-1;n++){let[a,u]=t[n],[s,i]=t[n+1],h=Math.ceil(Math.hypot(s-a,i-u)/2);for(let l=0;l<=h;l++){let m=l/h,c=a+(s-a)*m,b=u+(i-u)*m,p=e*(.6+.4*((b-t[0][1])/(t.at(-1)[1]-t[0][1]||1)));bt(o,c,b,p,p*.45,r+n)}}}function Et(o,t,e,r,n,a,u,s){for(let i=0;i<a;i++){let h=t+u()*(r-t),l=e+u()*(n-e);if(s(h,l))continue;let m=(l-e)/(n-e||1),c=2+Math.floor(u()*3),b=2+Math.floor(u()*(2+m*3));for(let p=0;p<c;p++){let f=(p-c/2)*.7+(u()-.5);ut(o,h+p-c/2,l,b+Math.floor(u()*2),f,(g,d,M)=>F(S.grass,.45+g*.55+(u()-.5)*.2,d,M),{sway:1})}if(u()<.14){let p=u(),f=p<.35?w("#d8d2e4"):p<.6?w("#9a78c4"):p<.8?w("#e2c45a"):w("#7aa6d8");o.put(h,l-b-1,f,P([0,.5,1]),b+1,E(l)+.6,A.SOLID,void 0,0,1)}}}function $(o,t,e,r,n){let a=Math.ceil(Math.hypot(e[0]-t[0],e[1]-t[1],e[2]-t[2])*1.5);for(let u=0;u<=a;u++){let s=u/a,i=t[0]+(e[0]-t[0])*s,h=t[1]+(e[1]-t[1])*s,l=t[2]+(e[2]-t[2])*s;D(o,i,l-h-r,r,r,l,{colour:(m,c,b,p,f)=>u===0||u===a?F(S.wood,.85-Math.hypot(m,c)*.5,p,f):F(S.bark,R(p*.8,f*.3,n)*.8+.1,p,f),bulge:r})}}function Lt(o,t,e,r,n,a){Z(o,t,e,11*r,4.6*r,(s,i,h,l)=>Math.hypot(s,i)<.62?F(B("#1c1714","#2a211b","#3a2c22"),G(h,l,n),h,l):null,{lift:.02});let u=13;for(let s=0;s<u;s++){let i=s/u*Math.PI*2+a()*.2,h=t+Math.cos(i)*10*r,l=e+Math.sin(i)*4.2*r;ft(o,h,l+1,(2+a()*1.4)*r,n+s)}return $(o,[t-6*r,0,e+1],[t+r,4*r,e],1.4*r,n+50),$(o,[t+6*r,0,e-1],[t-r,4*r,e],1.4*r,n+51),$(o,[t-2*r,0,e-3*r],[t+r,3.5*r,e+.5],1.2*r,n+52),{x:t,y:e}}function kt(o,t,e,r,n,a){let u=Math.round(r*.9),s=Math.round(r*.45),i=[t,e-n],h=[t+r,e],l=h[0]-i[0],m=h[1]-i[1],c=l*-s-u*m;for(let b=e-n-s;b<=e;b++)for(let p=t;p<=t+r+u;p++){let f=p+.5-i[0],g=b+.5-i[1],d=(f*-s-u*g)/c,M=(l*g-m*f)/c;if(d<0||d>1||M<0||M>1)continue;let y=F(S.canvas,.25+R(p*.5,b*.2,a)*.35+(1-d)*.15,p,b);o.put(p,b,y,P([.7,.55,.2]),n*(1-d),E(e-M*s)+.1,A.SOLID)}for(let b=e-n;b<=e;b++){let p=(e-b)/n,f=r*(1-p);for(let g=Math.round(t-f);g<=Math.round(t+f);g++){let M=Math.abs(g-t)<f*.45&&p<.72?w("#120e0b"):F(S.canvas,.55+R(g*.4,b*.3,a+1)*.3,g,b);o.put(g,b,M,P([0,.3,1]),e-b,E(e)+.5,A.SOLID)}}for(let b=1;b<4;b++)o.put(t,e-n-b,w("#5b4029"),[0,0,1],n+b,E(e)+.6,A.SOLID)}function Dt(o,t,e,r,n,a){let u=Math.round(r*1.5),s=Math.round(r*.95),i=e-u;V(o,t,r,i,e,(d,M,y)=>{let L=R(M*.7,y*.09,n)*.75+R(M*2,y*.3,n+1)*.25;return F(S.bark,L*.9+.05,M,y)});for(let d of[-1,1])for(let M=0;M<3;M++){let y=r*(.38-M*.08),L=t+d*(r*.75+M*r*.32);D(o,L,e-y*.4,y,y*.5,e+1,{colour:(x,v,T,k,C)=>F(S.bark,R(k*.6,C*.3,n)*.8,k,C),bulge:y*.6})}let h=r*1.22;for(let d=i-s;d<=i+3;d++){let M=O((i+3-d)/(s+3)),y=h*(1-M*M*.15)*(1-M*.92);for(let L=Math.floor(t-y);L<=Math.ceil(t+y);L++){let x=(L+.5-t)/Math.max(1,y);if(Math.abs(x)>1)continue;let v=Math.sqrt(1-x*x),T=P([x*.8,.75,v*.6]),k=(d-i&3)===0?0:.3,C=F(S.roof,k+R(L*.5,d*.8,n+4)*.55+.1,L,d);o.put(L,d,C,T,e-d,E(e)+v*h+1,A.SOLID,void 0,0,0)}}let l=t-Math.round(r*.25),m=Math.max(3,Math.round(r*.28)),c=Math.round(u*.5);for(let d=e-c;d<=e;d++)for(let M=l-m;M<=l+m;M++){let y=(M-l)/m,L=e-c+Math.round(m*(1-Math.sqrt(Math.max(0,1-y*y))));if(d<L)continue;let v=Math.abs(M-l)===m||d===L?w("#2a1d14"):F(S.wood,((M-l+m)%3===0?.1:.6)+G(M,d,n)*.2,M,d),T=(M+.5-t)/r;o.put(M,d,v,[T,0,Math.sqrt(Math.max(0,1-T*T))],e-d,E(e)+r+.5,A.SOLID)}let b=[l+m-2,e-Math.round(c*.45)];o.put(b[0],b[1],w("#c9a04a"),[0,0,1],e-b[1],E(e)+r+.6,A.SOLID);let p=[];for(let[d,M,y]of[[r*.45,u*.55,r*.17],[-r*.62,u*.72,r*.13]]){let L=t+d,x=e-M,v=Math.max(1.6,y);for(let T=Math.floor(x-v-1);T<=Math.ceil(x+v+1);T++)for(let k=Math.floor(L-v-1);k<=Math.ceil(L+v+1);k++){let C=Math.hypot(k+.5-L,T+.5-x);if(C>v+1)continue;let at=(k+.5-t)/r,ie=[at,0,Math.sqrt(Math.max(0,1-at*at))],st=C>v,At=!st&&(Math.abs(k+.5-L)<.6||Math.abs(T+.5-x)<.6),ae=st||At?void 0:K(S.window,w("#ffe3a8"),O(1-C/v));o.put(k,T,st||At?w("#3a281b"):w("#6b4a2a"),ie,e-T,E(e)+r+.7,A.SOLID,ae)}p.push({x:L,y:x,h:e-x,z:E(e)+r+3})}let f=t+Math.round(h*.45),g=i-Math.round(s*.35);for(let d=0;d<9;d++){let M=f+(d>5?1:0);for(let y=-1;y<=1;y++)o.put(M+y,g-d,F(S.stone,.3+G(M+y,d,n)*.5,M+y,g-d),P([y*.6,.2,1]),e-g+d,E(e)+h+2,A.SOLID)}for(let d=0;d<5;d++){let M=t+(a()-.5)*r*2.2;gt(o,M,e+1+a()*2,1.6+a(),!1,n+d)}return{windows:p,chimney:{x:f+1,y:g-9,h:e-g+9,z:E(e)+h+2}}}function gt(o,t,e,r,n,a){let u=Math.max(1,Math.round(r*1.1));for(let s=0;s<u;s++)o.put(t,e-s,w("#b8b0a0"),[0,0,1],s,E(e)+.8,A.SOLID);D(o,t,e-u-r*.35,r,r*.6,e,{colour:(s,i,h,l,m)=>n?K(w("#2f6b86"),w("#7fdcff"),O(-i*.5+.4)):G(l,m,a)>.8&&i<.2?w("#e8dcc8"):F(S.cap,-i*.6+.3,l,m),glow:n?(s,i)=>[40+60*(1-Math.abs(s)),140+60*(1-Math.abs(s)),190+50*(1-Math.abs(s))]:void 0,bulge:r,round:.9})}function Gt(o,t,e,r,n){V(o,t,1,e-r,e,(i,h,l)=>F(S.wood,.4+(i+1)*.25,h,l));let a=e-r+1;for(let i=1;i<=4;i++)o.put(t+n*i,a,F(S.wood,.5,t+n*i,a),mt,r-1,E(e)+1.2,A.SOLID);let u=t+n*4,s=a+2;for(let i=0;i<5;i++)for(let h=-1;h<=1;h++){let l=i===0||i===4||Math.abs(h)===1&&(i===1||i===3);o.put(u+h,s+i,l?w("#2b2420"):w("#c08a40"),[h*.5,0,1],e-s-i,E(e)+1.4,A.SOLID,l?void 0:i===2?[255,220,140]:[230,160,80])}return{x:u,y:s+2,h:e-s-2,z:E(e)+3}}function Bt(o,t,e,r,n,a,u){let s=i=>{let h=(i+.5-t)/r;return e-n*Math.sqrt(Math.max(0,1-h*h))};Z(o,t,e,r+3,n+1.6,(i,h,l,m)=>F(B("#2a2a22","#36352a","#433f30"),R(l*.4,m*.6,a)*.8,l,m),{ragged:.25,seed:a,lift:.01});for(let i=Math.floor(e-n);i<=Math.ceil(e+n);i++)for(let h=Math.floor(t-r);h<=Math.ceil(t+r);h++){let l=(h+.5-t)/r,m=(i+.5-e)/n;l*l+m*m+(R(h*.25,i*.5,a+1)-.5)*.15>1||o.put(h,i,S.water,mt,0,E(i)+.02,A.WATER,void 0,Math.floor(s(h))-1)}for(let i=0;i<Math.round(r/5);i++){let h=u()*Math.PI*2,l=.3+u()*.55,m=t+Math.cos(h)*r*l,c=e+Math.sin(h)*n*l,b=1.8+u()*1.6;Z(o,m,c,b,b*.5,(p,f,g,d)=>p>.2&&Math.abs(f)<.25?null:F(S.pad,.3+G(g,d,a+i)*.6,g,d),{lift:.05}),u()<.35&&o.put(m,c-1,w("#e9c6d6"),[0,.6,.8],1,E(c)+.1,A.SOLID)}for(let i=0;i<Math.round(r*.9);i++){let h=Math.PI+u()*Math.PI*(u()<.5?.5:1),l=t+Math.cos(h)*(r+1),m=e+Math.sin(h)*(n+.5),c=4+Math.floor(u()*7),b=(u()-.5)*1.2;if(ut(o,l,m,c,b,(p,f,g)=>F(S.grass,.3+p*.6,f,g),{sway:1.2}),u()<.3){let p=l+b*c*.5,f=m-c;for(let g=0;g<3;g++)o.put(p,f-g,w("#4a3020"),[0,0,1],c+g,E(m)+.6,A.SOLID,void 0,0,1.2)}}return{cx:t,cy:e,rx:r,ry:n}}function Pt(o,t,e,r,n){for(let a=0;a<3;a++){let u=r-a;for(let s=0;s<u;s++){let i=t+(s-(u-1)/2)*4.2,h=e-2-a*3.6;D(o,i,h,2.1,1.9,e,{colour:(l,m,c,b,p)=>{let f=Math.hypot(l,m);return f>.78?F(S.bark,.3,b,p):F(S.wood,.9-f*.6+(G(b,p,n)-.5)*.2,b,p)},round:.35,bulge:3})}}}function _t(o,t,e,r,n){let a=e-Math.round(r*1.1);V(o,t,r,a,e,(s,i,h)=>F(S.bark,R(i*.8,h*.2,n)*.8+.1,i,h)),Z(o,t,a,r,r*.42,(s,i,h,l)=>Math.hypot(s,i)>.85?F(S.bark,.2,h,l):F(S.wood,.75-(Math.hypot(s,i)*4%1<.3?.35:0),h,l),{lift:1});let u=[];for(let[s,i]of[[-r*.45,4],[r*.1,6],[r*.5,3]]){let h=Math.round(t+s);for(let l=0;l<i;l++)o.put(h,a-1-l,w("#e9e2cf"),[0,0,1],e-a+1+l,E(e)+r+1,A.SOLID);o.put(h,a-1-i,w("#ffd27a"),[0,0,1],e-a+1+i,E(e)+r+1.1,A.SOLID,[255,214,130]),o.put(h,a-2-i,w("#ff9a3c"),[0,0,1],e-a+2+i,E(e)+r+1.1,A.SOLID,[255,150,60]),u.push({x:h,y:a-1-i,h:e-a+2+i,z:E(e)+r+3})}return u}function It(o,t,e,r){V(o,t,1,e-r,e,(n,a,u)=>F(S.wood,.35+(n+1)*.2,a,u));for(let[n,a,u]of[[e-r+2,1,9],[e-r+6,-1,8]])for(let s=0;s<u;s++)for(let i=0;i<3;i++)s===u-1&&i!==1||o.put(t+a*(s+1),n+i,F(S.wood,i===0?.85:i===2?.25:.6,t+s,n+i),[0,.2,1],e-n-i,E(e)+1.5,A.SOLID)}function zt(o,t,e,r,n){let a=Math.max(2,Math.round(r*1.3));for(let u=0;u<a;u++)for(let s of r>2.2?[-.5,.5]:[0])o.put(t+s,e-u,w("#d8cfbf"),[s,0,1],u,E(e)+.8,A.SOLID);D(o,t,e-a-r*.3,r,r*.62,e,{colour:(u,s,i,h,l)=>G(h,l,n)>.78&&s<.3?w("#f1e8dc"):F(B("#7a1a16","#a1261c","#c23a26"),-s*.6+.35,h,l),bulge:r,round:.9})}function Ct(o,t){let e=Math.max(2,Math.round(t/240));return{px:e,w:Math.ceil(o/e),h:Math.ceil(t/e)}}function Ot(o,t,e=7){let r=new X(o,t),n=Q(e*7919+o*31+t),a=Math.round(t*.47),u={x:Math.round(o*.6),y:Math.round(t*.095),r:Math.max(5,Math.round(t*.028))},s=[];Ft(r,a+2,u,e),St(r,a,e);let i=x=>Math.abs(x-u.x)<o*.14;for(let x=-8;x<o+8;x+=6+n()*7){let v=i(x);Y(r,x,a-1+n()*3,2+Math.round(n()),v?t*(.27+n()*.05):n()*t*.17,v?7+n()*4:12+n()*11,n,e+Math.round(x))}for(let x=-12;x<o+12;x+=15+n()*14){let v=i(x);Y(r,x,a+3+n()*5,3+Math.round(n()*2),v?t*(.24+n()*.04):n()*t*.15,v?9+n()*4:16+n()*12,n,e+500+Math.round(x))}for(let x=n()*20;x<o;x+=18+n()*30)ct(r,x,a+2+n()*6,5+n()*4,e+900+Math.round(x),n);for(let x of[0,1])for(let v=0;v<3;v++){let T=x?o*(.84+v*.055+n()*.02):o*(.03+v*.06+n()*.02),k=a+12+n()*26;Y(r,T,k,5+Math.round(n()*3),n()*t*.12,18+n()*10,n,e+1300+v*17+x*101)}let h={x:Math.round(o*.5),y:Math.round(a+(t-a)*.44)},l={x:Math.round(o*.235),y:Math.round(a+(t-a)*.24)};pt(r,[[o*.43,t+6],[o*.4,t*.86],[o*.31,t*.76],[l.x-2,l.y+3]],6,e+11),pt(r,[[o*.36,t*.79],[h.x-14,h.y+4]],4,e+12),bt(r,h.x,h.y+1,26,9,e+13);let m=Math.max(16,Math.round(t*.085)),c=Dt(r,l.x,l.y,m,e+20,n);for(let x of c.windows)s.push({x:x.x,h:x.h,z:x.z,colour:w("#ffa850"),reach:34,power:.9,flicker:2,lamp:!0});let b=Math.round(h.x+o*.1),p=h.y-Math.round(t*.05);kt(r,b,p,Math.max(11,Math.round(t*.05)),Math.max(14,Math.round(t*.068)),e+30),Lt(r,h.x,h.y,Math.max(1,t/220),e+40,n),Pt(r,b+Math.round(t*.075),p+2,4,e+31),$(r,[h.x-27,0,h.y+2],[h.x-15,0,h.y+6],2,e+41),$(r,[h.x+9,0,h.y-8],[h.x+19,0,h.y-6],1.6,e+42);let f=[[o*.335,t*.9,1],[o*.3,t*.7,-1],[o*.805,t*.72,-1],[l.x+m*1.25,l.y+3,-1]];for(let[x,v,T]of f){let k=Gt(r,Math.round(x),Math.round(v),Math.max(14,Math.round(t*.06)),T);s.push({x:k.x,h:k.h,z:k.z,colour:w("#ffb85c"),reach:40,power:1,flicker:1,lamp:!0})}for(let x of _t(r,Math.round(o*.89),Math.round(t*.7),Math.max(5,Math.round(t*.024)),e+60))s.push({x:x.x,h:x.h,z:x.z,colour:w("#ffb35c"),reach:26,power:.55,flicker:1,lamp:!0});It(r,Math.round(o*.37),Math.round(t*.8),Math.max(12,Math.round(t*.06)));for(let[x,v,T]of[[o*.15,a+30,3],[o*.06,t*.98,2],[o*.58,t*.66,2],[o*.95,t*.97,3],[o*.41,a+10,2]])for(let k=0;k<T;k++)zt(r,x+(n()-.5)*12,v+(n()-.5)*3,1.6+n()*1.6,e+70+k);let g=Bt(r,Math.round(o*.72),Math.round(t*.85),Math.max(30,Math.round(o*.1)),Math.max(10,Math.round(t*.055)),e+50,n),d=(x,v,T,k)=>Rt(r,x,v,T,[{x:x+k*T*1.6,y:t*.05,r:t*.15},{x:x-k*T*.8,y:t*.18,r:t*.11},{x:x+k*T*3.4,y:t*.12,r:t*.1},{x:x+k*T*.5,y:t*.3,r:t*.08}],n,e+Math.round(x));d(Math.round(o*.035),Math.round(t*.965),Math.max(7,Math.round(t*.032)),1),d(Math.round(o*.965),Math.round(t*.95),Math.max(8,Math.round(t*.036)),-1);let M=[[o*.07,t*.95],[o*.92,t*.93],[o*.84,t*.78],[o*.11,a+26]];for(let[x,v]of M){for(let T=0;T<4+Math.floor(n()*3);T++)gt(r,x+(n()-.5)*10,v+(n()-.5)*3,1.4+n()*1.4,!0,e+T);s.push({x,h:3,z:E(v)+2,colour:w("#4ccaff"),reach:18,power:.55,flicker:0})}for(let x=0;x<7;x++){let v=n()*o,T=a+8+n()*(t-a-8);r.matAt(v,T)===A.WATER||Math.hypot(v-h.x,(T-h.y)*2.5)<34||Math.hypot(v-l.x,(T-l.y)*2)<m*2||ft(r,v,T,2+n()*3,e+70+x)}for(let[x,v,T]of[[o*.16,t*1,13],[o*.27,t*1.02,9],[o*.6,t*1.03,11],[o*.86,t*1.02,14]])ct(r,x,v,T,e+80+Math.round(x),n);let y=(x,v)=>r.matAt(x,v)===A.WATER||Math.hypot(x-h.x,(v-h.y)*2.5)<30||Math.abs(x-l.x)<m*1.1&&v<l.y+2&&v>l.y-m*2;Et(r,0,a+3,o,t+2,Math.round(o*(t-a)*.03),n,y);let L=Array.from({length:6},(x,v)=>({x:Math.round(o*(.08+.84*((v*.618+n()*.2)%1))),y:Math.round(a-6-n()*t*.12),z:E(a)-4}));return{w:o,h:t,still:r,lights:s,edge:a,fire:h,chimney:c.chimney,pond:g,moon:u,eyes:L,fox:{x:h.x+17,y:h.y-3},doors:[{x:l.x-Math.round(m*.25),y:l.y+1},{x:b,y:p+1}]}}var z=`#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`,q=z+`
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2. - 1., 0., 1.);
}`,Ut=`
layout(location = 0) out vec4 oAlb;
layout(location = 1) out vec4 oNrm;
layout(location = 2) out vec4 oDat;
layout(location = 3) out vec4 oEmi;
uniform float uZMax;
`,Nt=z+Ut+`
uniform sampler2D sAlb, sNrm, sDat, sEmi;
uniform float uTime, uWind;
uniform ivec2 uSize;

// How many pixels a swaying pixel leans in the wind now: -1, 0 or 1.
int lean(ivec2 p, vec4 d) {
  if (d.a <= 0.) return 0;
  float w = sin(uTime * 1.3 + float(p.x) * 0.045 + float(p.y) * 0.02) * 0.6 + sin(uTime * 0.47 + float(p.x) * 0.017) * 0.4;
  return clamp(int(floor(w * uWind * d.a * 1.7 + 0.5)), -1, 1);
}
vec4 dat(ivec2 p) { return texelFetch(sDat, clamp(p, ivec2(0), uSize - 1), 0); }

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy), l = p - ivec2(1, 0), r = p + ivec2(1, 0);
  vec4 d0 = dat(p), dl = dat(l), dr = dat(r);
  int o0 = lean(p, d0), ol = lean(l, dl), or_ = lean(r, dr);
  ivec2 src = p;
  // A neighbour leaning onto this pixel shows here if this one leant away, or is behind it.
  bool fromL = ol == 1 && (o0 != 0 || dl.g >= d0.g);
  bool fromR = or_ == -1 && (o0 != 0 || dr.g >= d0.g);
  if (fromL && (!fromR || dl.g >= dr.g)) src = l;
  else if (fromR) src = r;
  // A pixel that leant away shows what is beside it: the ground or sky it stood against.
  else if (o0 != 0) { ivec2 f = p + ivec2(o0, 0); src = dat(f).a > 0. ? p + ivec2(2 * o0, 0) : f; }
  src = clamp(src, ivec2(0), uSize - 1);
  oAlb = texelFetch(sAlb, src, 0);
  oNrm = texelFetch(sNrm, src, 0);
  oDat = texelFetch(sDat, src, 0);
  oEmi = texelFetch(sEmi, src, 0);
  gl_FragDepth = 1. - clamp(oDat.g / uZMax, 0., 1.);
}`,Vt=z+`
layout(location = 0) in vec4 iDst;   // left, top, width, height in art pixels
layout(location = 1) in vec4 iSrc;   // atlas left, top; the foot row it stands on; a depth nudge
layout(location = 2) in vec4 iFx;    // mirrored (0/1), glow, how much of it shows (0 to 1), lift
layout(location = 3) in vec4 iTint;  // a colour it is tinted, and how much of its colour is the tint
uniform vec2 uSize;
out vec2 vLocal;
flat out vec4 vDst, vSrc, vFx, vTint;
void main() {
  // Two triangles a quad: vertices 0 to 5.
  int v = gl_VertexID % 6;
  vec2 c = vec2(v == 1 || v == 2 || v == 4 ? 1. : 0., v == 2 || v == 4 || v == 5 ? 1. : 0.);
  vec2 px = iDst.xy + c * iDst.zw;
  gl_Position = vec4(px / uSize * 2. - 1., 0., 1.);
  vLocal = c * iDst.zw;
  vDst = iDst; vSrc = iSrc; vFx = iFx; vTint = iTint;
}`,qt=z+Ut+`
uniform sampler2D aAlb, aNrm, aDat, aEmi;
in vec2 vLocal;
flat in vec4 vDst, vSrc, vFx, vTint;
float bayer(ivec2 p) {
  int i = (p.y & 3) * 4 + (p.x & 3);
  int b[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(b[i]) + 0.5) / 16.;
}
void main() {
  ivec2 l = ivec2(floor(vLocal));
  int w = int(vDst.z);
  ivec2 t = ivec2(int(vSrc.x) + (vFx.x > 0.5 ? w - 1 - l.x : l.x), int(vSrc.y) + l.y);
  vec4 a = texelFetch(aAlb, t, 0);
  if (a.a < 0.5 || vFx.z <= bayer(ivec2(gl_FragCoord.xy))) discard;
  vec4 n = texelFetch(aNrm, t, 0), d = texelFetch(aDat, t, 0), e = texelFetch(aEmi, t, 0);
  if (vFx.x > 0.5) n.x = 1. - n.x;
  oAlb = vec4(mix(a.rgb, vTint.rgb, vTint.a), 1.);
  oNrm = n;
  float z = vSrc.z * 2. + d.g + vSrc.w;
  oDat = vec4(d.r + vFx.w, z, 0., 0.);
  oEmi = vec4(e.rgb * vTint.rgb * vFx.y, 0.5);
  gl_FragDepth = 1. - clamp(z / uZMax, 0., 1.);
}`,I=32,Xt=z+`
uniform sampler2D gAlb, gNrm, gDat, gEmi;
uniform int uLights;
uniform vec4 uLightPos[${I}];  // x, height, depth, reach
uniform vec4 uLightCol[${I}];  // linear colour times power
uniform vec3 uMoonDir, uMoon, uSkyAmb, uGroundAmb, uFog;
uniform float uFogK, uFogMax, uMist, uTime, uZFront, uSkyLift, uStars, uWet, uStillGlow;
uniform vec3 uSkyTop, uSkyBottom;
uniform float uSkyMix;
uniform int uRows;
out vec4 oCol;

vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 a = texelFetch(gAlb, p, 0), nm = texelFetch(gNrm, p, 0), d = texelFetch(gDat, p, 0), em = texelFetch(gEmi, p, 0);
  int mat = int(nm.a * 255. + 0.5);
  // The still lamps' glow (marked 1) is the look's to dim by day; a sprite's (marked a half) its own.
  vec3 alb = lin(a.rgb), emi = lin(em.rgb) * (em.a > 0.75 ? uStillGlow : 1.);
  float row = float(p.y), x = float(p.x) + 0.5;
  if (mat == 4) {
    // The sky: its own colour (or, by day, the day's), its stars twinkling, the moon.
    float t = row / float(uRows);
    vec3 day = mix(uSkyTop, uSkyBottom, clamp(t * 1.6, 0., 1.));
    vec3 c = mix(alb * uSkyLift, day, uSkyMix);
    float tw = 0.55 + 0.45 * sin(uTime * (1.5 + hash(vec2(p)) * 3.) + hash(vec2(p) + 7.) * 6.283);
    c += emi * uStars * (em.r < 0.9 ? tw : 1.);
    c = mix(c, uFog, clamp(t * t * 0.6 * uFogMax, 0., 1.));
    oCol = vec4(c, float(mat) / 255.);
    return;
  }
  vec3 n = normalize(nm.xyz * 2. - 1.);
  vec3 P = vec3(x, d.r, d.g);
  // Moonlight and the sky's own light from above; the ground's from below.
  vec3 light = mix(uGroundAmb, uSkyAmb, n.y * 0.5 + 0.5) + uMoon * max(0., dot(n, uMoonDir));
  vec3 glowFog = vec3(0.);
  for (int i = 0; i < ${I}; i++) {
    if (i >= uLights) break;
    vec3 L = uLightPos[i].xyz - P;
    float dist = length(L), reach = uLightPos[i].w;
    float att = clamp(1. - dist / reach, 0., 1.);
    att *= att;
    float nl = max(0., dot(n, L / max(dist, 0.001)));
    // Leaves let the light through a little from behind.
    if (mat == 2) nl = 0.3 + 0.7 * nl;
    light += uLightCol[i].rgb * att * nl;
    glowFog += uLightCol[i].rgb * exp(-dist * dist / (reach * reach * 0.12));
  }
  vec3 c = alb * light;
  // Wet ground after rain shines where a light is low behind it.
  if (mat == 1 && n.y > 0.9) c += glowFog * uWet * 0.05;
  // Fog by distance; ground mist low down, drifting.
  // Fog begins past the clearing's near half: the camp stands clear, the far forest grey.
  float far = max(0., uZFront - d.g - 120.);
  // Fog lies thickest low down: the crowns stand dark against the sky above it.
  float fog = (1. - exp(-far * uFogK)) * uFogMax * mix(1., 0.22, smoothstep(10., 90., d.r));
  float mist = exp(-d.r / 7.) * uMist * (0.55 + 0.45 * vnoise(vec2(x * 0.03 - uTime * 0.25, d.g * 0.05 + uTime * 0.04)));
  fog = clamp(max(fog, mist), 0., 0.97);
  vec3 fogCol = uFog + glowFog * 0.08;
  c = mix(c, fogCol, fog);
  c += emi * (1. - fog * 0.65);
  oCol = vec4(c, float(mat) / 255.);
}`,Kt=z+`
uniform sampler2D tLit, gDat;
uniform float uTime, uRain;
uniform vec4 uRipples[4];  // x, row, start time, strength
uniform ivec2 uSize;
uniform vec3 uRainCol;
uniform vec4 uSheen;  // the sky's colour on the water, and how much the moon glints
out vec4 oCol;
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 lit(ivec2 q) { return texelFetch(tLit, clamp(q, ivec2(0), uSize - 1), 0).rgb; }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 me = texelFetch(tLit, p, 0);
  int mat = int(me.a * 255. + 0.5);
  vec3 c = me.rgb;
  float x = float(p.x), row = float(p.y);
  if (mat == 3) {
    // The pond mirrors what stands beyond it, about its far bank, wavering; rings where it was touched.
    float m = texelFetch(gDat, p, 0).b;
    float ring = 0.;
    for (int i = 0; i < 4; i++) {
      vec4 r = uRipples[i];
      float age = uTime - r.z;
      if (r.z < 0. || age > 3.) continue;
      float dd = length(vec2(x - r.x, (row - r.y) * 2.6));
      ring += r.w * exp(-age * 1.2) * smoothstep(1.2, 0., abs(dd - age * 14.)) ;
    }
    // Rain on the water: little rings at random, coming and going.
    vec2 cell = floor(vec2(x / 5., row / 3.));
    float rt = fract(uTime * 0.9 + hash(cell) * 7.);
    float rr = length(vec2(x - (cell.x + 0.5) * 5., (row - (cell.y + 0.5) * 3.) * 2.));
    ring += uRain * step(hash(cell + 3.), uRain * 0.6) * smoothstep(1., 0., abs(rr - rt * 4.)) * (1. - rt);
    float wob = sin(row * 1.7 - uTime * 2.2) * 0.6 + sin(row * 0.6 + uTime * 1.3) * 0.5;
    int dx = int(floor(wob + ring * 2. + 0.5));
    // Seen from above, the water shows what stands far beyond it: the mirror is stretched.
    int src = int(m - (row - m) * 3.2);
    vec3 refl = lit(ivec2(p.x + dx, src));
    int below = int(texelFetch(tLit, clamp(ivec2(p.x + dx, src), ivec2(0), uSize - 1), 0).a * 255. + 0.5);
    if (below == 3) refl = vec3(0.);
    // Toward the far bank it shows more of the sky's sheen; moonlight glints dance on it.
    float far = clamp(1. - (row - m) / 14., 0., 1.);
    vec2 gc = floor(vec2(x / 3. + sin(row * 0.9 + uTime * 0.7) * 1.5, row));
    float glint = step(0.955, hash(gc + floor(uTime * 1.5) * 0.37)) * uSheen.a;
    c = c * 0.6 + refl * vec3(0.55, 0.62, 0.72) + uSheen.rgb * (0.4 + far * 0.6) + vec3(0.03, 0.04, 0.05) * ring + vec3(0.5, 0.55, 0.65) * glint * (0.3 + ring);
  }
  // Rain: streaks falling on a slant, in whole pixels, lit by what they fall in front of.
  if (uRain > 0.01) {
    float col = floor(x + row * 0.25);
    float speed = 90. + hash(vec2(col, 1.)) * 50.;
    float ph = fract((row + uTime * speed) / 23. + hash(vec2(col, 2.)));
    float on = step(ph, 0.12) * step(hash(vec2(col, floor((row + uTime * speed) / 23.))), uRain * 0.55);
    c = mix(c, uRainCol + c * 0.9, on * 0.55);
  }
  oCol = vec4(c, me.a);
}`,Zt=z+`
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold;
in vec2 vUv;
out vec4 oCol;
void main() {
  vec3 c = vec3(0.);
  for (int i = 0; i < 4; i++) {
    vec2 o = vec2(i & 1, i >> 1) - 0.5;
    vec3 s = texture(tSrc, vUv + o * uTexel).rgb;
    float l = dot(s, vec3(0.2126, 0.7152, 0.0722));
    c += s * smoothstep(uThreshold, uThreshold * 2.5, l);
  }
  oCol = vec4(c * 0.25, 1.);
}`,$t=z+`
uniform sampler2D tSrc;
uniform vec2 uStep;
in vec2 vUv;
out vec4 oCol;
void main() {
  float w[5] = float[5](0.227, 0.194, 0.122, 0.054, 0.016);
  vec3 c = texture(tSrc, vUv).rgb * w[0];
  for (int i = 1; i < 5; i++) {
    c += texture(tSrc, vUv + uStep * float(i)).rgb * w[i];
    c += texture(tSrc, vUv - uStep * float(i)).rgb * w[i];
  }
  oCol = vec4(c, 1.);
}`,Jt=z+`
uniform sampler2D tArt, tGlow1, tGlow2;
uniform vec2 uArt;          // the art's size
uniform float uExposure, uGlow, uTheme, uDarkTheme, uVignette, uLo, uHi, uChroma;
uniform vec3 uPage, uText, uPaper;
out vec4 oCol;
float bayer(ivec2 p) {
  int i = (p.y & 3) * 4 + (p.x & 3);
  int b[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(b[i]) + 0.5) / 16.;
}
void main() {
  ivec2 ap = ivec2(gl_FragCoord.xy);
  vec3 c = texelFetch(tArt, ap, 0).rgb;
  vec2 uv = (vec2(ap) + 0.5) / uArt;
  c += (texture(tGlow1, uv).rgb * 0.6 + texture(tGlow2, uv).rgb * 0.9) * uGlow;
  c *= uExposure;
  // Darker toward the corners, a little.
  vec2 v = uv - 0.5;
  c *= 1. - uVignette * dot(v, v) * 1.6;
  // Tone: a soft shoulder, so the fire's heart is white without the rest going grey.
  c = c / (1. + c * 0.35);
  vec3 sc = pow(clamp(c, 0., 1.), vec3(1. / 2.2));
  // A light theme's picture: its lightness pressed into the top of the range, its colours kept in
  // part, tinted toward the paper, so a frosted panel's text reads over all of it.
  float Ls = dot(sc, vec3(0.299, 0.587, 0.114));
  sc = clamp(vec3(mix(uLo, uHi, Ls)) + (sc - Ls) * uChroma, 0., 1.) * mix(vec3(1.), uPaper, step(0.01, uLo));
  if (uTheme > 0.5) {
    // The theme's two colours: each pixel a step from the page to the text by how bright it is.
    float L = dot(sc, vec3(0.299, 0.587, 0.114));
    float k = uDarkTheme > 0.5 ? clamp(0.04 + L * 0.95, 0., 0.9) : clamp(1.05 - L * 1.1, 0.06, 0.85);
    sc = mix(uPage, uText, k);
  }
  // Steps of colour in a pixel artist's dither, one pattern cell an art pixel.
  sc = floor(sc * 40. + bayer(ap)) / 40.;
  oCol = vec4(sc, 1.);
}`;var j=16,tt=class{constructor(t,e=!1){this.canvas=t;let r=t.getContext("webgl2",{antialias:!1,alpha:!1,depth:!1,powerPreference:"low-power",preserveDrawingBuffer:e});if(!r)throw new Error("WebGL2 is not available");if(!r.getExtension("EXT_color_buffer_float"))throw new Error("float render targets are not available");this.gl=r,this.prog("still",q,Nt),this.prog("sprite",Vt,qt),this.prog("light",q,Xt),this.prog("water",q,Kt),this.prog("bright",q,Zt),this.prog("blur",q,$t),this.prog("show",q,Jt),this.vao=r.createVertexArray(),this.spriteBuf=r.createBuffer(),r.bindVertexArray(this.vao),r.bindBuffer(r.ARRAY_BUFFER,this.spriteBuf);for(let n=0;n<4;n++)r.enableVertexAttribArray(n),r.vertexAttribPointer(n,4,r.FLOAT,!1,j*4,n*16),r.vertexAttribDivisor(n,1);r.bindVertexArray(null)}canvas;gl;progs={};still=[];atlas=[];layers;lit;water;glow=[];shown;vao;spriteBuf;art={w:1,h:1};lightPos=new Float32Array(I*4);lightCol=new Float32Array(I*4);screen={w:1,h:1};prog(t,e,r){let n=this.gl,a=(s,i)=>{let h=n.createShader(s);if(n.shaderSource(h,i),n.compileShader(h),!n.getShaderParameter(h,n.COMPILE_STATUS))throw new Error(`${t}: ${n.getShaderInfoLog(h)}`);return h},u=n.createProgram();if(n.attachShader(u,a(n.VERTEX_SHADER,e)),n.attachShader(u,a(n.FRAGMENT_SHADER,r)),n.linkProgram(u),!n.getProgramParameter(u,n.LINK_STATUS))throw new Error(`${t}: ${n.getProgramInfoLog(u)}`);this.progs[t]={p:u,u:new Map}}use(t){let e=this.progs[t];return this.gl.useProgram(e.p),r=>(e.u.has(r)||e.u.set(r,this.gl.getUniformLocation(e.p,r)),e.u.get(r))}texture(t,e,r,n,a,u,s){let i=this.gl,h=i.createTexture();return i.bindTexture(i.TEXTURE_2D,h),i.texImage2D(i.TEXTURE_2D,0,r,t,e,0,n,a,u),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_MIN_FILTER,s),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_MAG_FILTER,s),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_WRAP_S,i.CLAMP_TO_EDGE),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_WRAP_T,i.CLAMP_TO_EDGE),h}upload(t,e){let r=this.gl;for(let n of e)r.deleteTexture(n);return[this.texture(t.w,t.h,r.RGBA8,r.RGBA,r.UNSIGNED_BYTE,t.alb,r.NEAREST),this.texture(t.w,t.h,r.RGBA8,r.RGBA,r.UNSIGNED_BYTE,t.nrm,r.NEAREST),this.texture(t.w,t.h,r.RGBA32F,r.RGBA,r.FLOAT,t.dat,r.NEAREST),this.texture(t.w,t.h,r.RGBA8,r.RGBA,r.UNSIGNED_BYTE,t.emi,r.NEAREST)]}target(t,e,r,n,a){let u=this.gl;if(a){u.deleteFramebuffer(a.fb);for(let h of a.tex)u.deleteTexture(h)}let s=u.createFramebuffer();u.bindFramebuffer(u.FRAMEBUFFER,s);let i=r.map(([h,l,m],c)=>{let b=this.texture(t,e,h,l,m,null,n);return u.framebufferTexture2D(u.FRAMEBUFFER,u.COLOR_ATTACHMENT0+c,u.TEXTURE_2D,b,0),b});return u.drawBuffers(r.map((h,l)=>u.COLOR_ATTACHMENT0+l)),{fb:s,tex:i,w:t,h:e}}setArt(t,e){let r=this.gl;if(this.still=this.upload(t,this.still),this.atlas.length||(this.atlas=this.upload(e,[])),this.art.w!==t.w||this.art.h!==t.h||!this.layers){this.art={w:t.w,h:t.h};let{w:n,h:a}=this.art,u=this.layers;u&&r.deleteRenderbuffer(u.depth);let s=this.target(n,a,[[r.RGBA8,r.RGBA,r.UNSIGNED_BYTE],[r.RGBA8,r.RGBA,r.UNSIGNED_BYTE],[r.RGBA16F,r.RGBA,r.HALF_FLOAT],[r.RGBA16F,r.RGBA,r.HALF_FLOAT]],r.NEAREST,u),i=r.createRenderbuffer();r.bindRenderbuffer(r.RENDERBUFFER,i),r.renderbufferStorage(r.RENDERBUFFER,r.DEPTH_COMPONENT24,n,a),r.framebufferRenderbuffer(r.FRAMEBUFFER,r.DEPTH_ATTACHMENT,r.RENDERBUFFER,i),this.layers={...s,depth:i},this.lit=this.target(n,a,[[r.RGBA16F,r.RGBA,r.HALF_FLOAT]],r.NEAREST,this.lit),this.water=this.target(n,a,[[r.RGBA16F,r.RGBA,r.HALF_FLOAT]],r.NEAREST,this.water),this.shown=this.target(n,a,[[r.RGBA8,r.RGBA,r.UNSIGNED_BYTE]],r.NEAREST,this.shown);let h=[Math.ceil(n/2),Math.ceil(a/2)],l=[Math.ceil(n/4),Math.ceil(a/4)],m=this.glow;this.glow=[h,h,l,l].map(([c,b],p)=>this.target(c,b,[[r.RGBA16F,r.RGBA,r.HALF_FLOAT]],r.LINEAR,m[p])),r.bindFramebuffer(r.FRAMEBUFFER,null)}}resize(t,e){this.canvas.width=t,this.canvas.height=e,this.screen={w:t,h:e}}quad(){this.gl.drawArrays(this.gl.TRIANGLES,0,3)}bind(t,e,r){let n=this.gl;t.forEach((a,u)=>{n.activeTexture(n.TEXTURE0+u),n.bindTexture(n.TEXTURE_2D,a),n.uniform1i(r(e[u]),u)})}finish(){let t=new Uint8Array(4);this.gl.readPixels(0,0,1,1,this.gl.RGBA,this.gl.UNSIGNED_BYTE,t)}draw(t){let e=this.gl,r=this.layers,{w:n,h:a}=this.art,u=a*2+64;e.bindFramebuffer(e.FRAMEBUFFER,r.fb),e.viewport(0,0,n,a),e.enable(e.DEPTH_TEST),e.depthFunc(e.ALWAYS),e.depthMask(!0);let s=this.use("still");this.bind(this.still,["sAlb","sNrm","sDat","sEmi"],s),e.uniform1f(s("uTime"),t.time),e.uniform1f(s("uWind"),t.wind),e.uniform2i(s("uSize"),n,a),e.uniform1f(s("uZMax"),u),this.quad(),t.spriteCount&&(e.depthFunc(e.LEQUAL),s=this.use("sprite"),this.bind(this.atlas,["aAlb","aNrm","aDat","aEmi"],s),e.uniform2f(s("uSize"),n,a),e.uniform1f(s("uZMax"),u),e.bindVertexArray(this.vao),e.bindBuffer(e.ARRAY_BUFFER,this.spriteBuf),e.bufferData(e.ARRAY_BUFFER,t.sprites.subarray(0,t.spriteCount*j),e.DYNAMIC_DRAW),e.drawArraysInstanced(e.TRIANGLES,0,6,t.spriteCount),e.bindVertexArray(null)),e.disable(e.DEPTH_TEST),e.bindFramebuffer(e.FRAMEBUFFER,this.lit.fb),s=this.use("light"),this.bind(r.tex,["gAlb","gNrm","gDat","gEmi"],s);let i=this.lightPos,h=this.lightCol;for(let f=0;f<t.lightCount;f++)i.set(t.lights.subarray(f*8,f*8+4),f*4),h.set(t.lights.subarray(f*8+4,f*8+8),f*4);e.uniform1i(s("uLights"),t.lightCount),e.uniform4fv(s("uLightPos"),i),e.uniform4fv(s("uLightCol"),h),e.uniform3fv(s("uMoonDir"),t.moonDir),e.uniform3fv(s("uMoon"),t.moon),e.uniform3fv(s("uSkyAmb"),t.skyAmb),e.uniform3fv(s("uGroundAmb"),t.groundAmb),e.uniform3fv(s("uFog"),t.fog),e.uniform3fv(s("uSkyTop"),t.skyTop),e.uniform3fv(s("uSkyBottom"),t.skyBottom),e.uniform1f(s("uFogK"),t.fogK),e.uniform1f(s("uFogMax"),t.fogMax),e.uniform1f(s("uMist"),t.mist),e.uniform1f(s("uWet"),t.wet),e.uniform1f(s("uStillGlow"),t.stillGlow),e.uniform1f(s("uTime"),t.time),e.uniform1f(s("uZFront"),a*2),e.uniform1f(s("uSkyLift"),t.skyLift),e.uniform1f(s("uStars"),t.stars),e.uniform1f(s("uSkyMix"),t.skyMix),e.uniform1i(s("uRows"),a),this.quad(),e.bindFramebuffer(e.FRAMEBUFFER,this.water.fb),s=this.use("water"),this.bind([this.lit.tex[0],r.tex[2]],["tLit","gDat"],s),e.uniform1f(s("uTime"),t.time),e.uniform1f(s("uRain"),t.rain),e.uniform4fv(s("uRipples"),t.ripples),e.uniform2i(s("uSize"),n,a),e.uniform3fv(s("uRainCol"),t.rainCol),e.uniform4fv(s("uSheen"),t.sheen),this.quad();let[l,m,c,b]=this.glow,p=(f,g,d,M)=>{e.bindFramebuffer(e.FRAMEBUFFER,f.fb),e.viewport(0,0,f.w,f.h);let y=this.use(g);this.bind([d],["tSrc"],y),M(y),this.quad()};p(l,"bright",this.water.tex[0],f=>{e.uniform2f(f("uTexel"),1/n,1/a),e.uniform1f(f("uThreshold"),.22)}),p(m,"blur",l.tex[0],f=>e.uniform2f(f("uStep"),1/l.w,0)),p(l,"blur",m.tex[0],f=>e.uniform2f(f("uStep"),0,1/l.h)),p(c,"blur",l.tex[0],f=>e.uniform2f(f("uStep"),1/l.w,0)),p(b,"blur",c.tex[0],f=>e.uniform2f(f("uStep"),1.5/c.w,0)),p(c,"blur",b.tex[0],f=>e.uniform2f(f("uStep"),0,1.5/c.h)),e.bindFramebuffer(e.FRAMEBUFFER,this.shown.fb),e.viewport(0,0,n,a),s=this.use("show"),this.bind([this.water.tex[0],l.tex[0],c.tex[0]],["tArt","tGlow1","tGlow2"],s),e.uniform2f(s("uArt"),n,a),e.uniform1f(s("uExposure"),t.exposure),e.uniform1f(s("uGlow"),t.glow),e.uniform1f(s("uLo"),t.lo),e.uniform1f(s("uHi"),t.hi),e.uniform1f(s("uChroma"),t.chroma),e.uniform1f(s("uVignette"),t.vignette),e.uniform3fv(s("uPaper"),t.paper),e.uniform1f(s("uTheme"),t.theme?1:0),e.uniform1f(s("uDarkTheme"),t.darkTheme?1:0),e.uniform3fv(s("uPage"),t.page),e.uniform3fv(s("uText"),t.text),this.quad(),e.bindFramebuffer(e.READ_FRAMEBUFFER,this.shown.fb),e.bindFramebuffer(e.DRAW_FRAMEBUFFER,null),e.blitFramebuffer(0,0,n,a,0,this.screen.h,this.screen.w,0,e.COLOR_BUFFER_BIT,e.NEAREST),e.bindFramebuffer(e.READ_FRAMEBUFFER,null)}};var et=48,rt=20,J=26,Qt=220,dt=420;function nt(o){let t=(o%dt+dt)%dt,e=(u,s,i)=>Math.max(0,Math.min(1,(i-u)/(s-u))),r=e(230,260,t)*(1-e(330,360,t)),n=Math.max(e(190,230,t)*(1-e(350,400,t)),.15),a=e(240,280,t)*(1-e(370,420,t));return{rain:r,mist:n,wet:a}}var ot=class{constructor(t,e){this.g=t;this.atlas=e;this.placeFlies()}g;atlas;t=0;flare=0;sparks=new Float32Array(et*6);puffs=new Float32Array(rt*6);flies=new Float32Array(J*8);ripples=new Float32Array(16).fill(-1);ripple=0;deer={on:!1,x:0,row:0,dir:1,state:0,until:0,next:50,goal:0,step:0};eyes={at:-1,from:0,until:0,next:12};sparkAcc=0;puffAcc=0;nextJump=18;rand=Q(97);sprites=new Float32Array(Qt*j);lights=new Float32Array(I*8);spriteCount=0;lightCount=0;night=!0;setGlade(t){let e=t.w/this.g.w,r=t.h/this.g.h;this.g=t;for(let n=0;n<J;n++)this.flies[n*8]=this.flies[n*8]*e,this.flies[n*8+1]=this.flies[n*8+1]*r;this.sparks.fill(0),this.puffs.fill(0),this.deer.on=!1}placeFlies(){let t=this.g,e=Q(5);for(let r=0;r<J;r++){let n=r*8,a=r%3;this.flies[n]=e()*t.w,this.flies[n+1]=a===0?t.edge+2+e()*20:t.edge+20+e()*(t.h-t.edge-20),this.flies[n+2]=3+e()*16,this.flies[n+6]=e()*100,this.flies[n+7]=a}}fireStrength(){let t=this.t;return 1+.1*Math.sin(t*9.3)+.07*Math.sin(t*14.1+1.3)+.14*(R(t*3.1,.5,3)-.5)+this.flare*.8}step(t,e,r){this.t=(this.t+t)%14400;let n=this.t,a=this.g;this.flare=Math.max(0,this.flare-t*.6);let u=nt(n);for(this.sparkAcc+=t*(5+this.flare*30)*(1-u.rain*.6);this.sparkAcc>1;)this.sparkAcc-=1,this.spark();for(let l=0;l<et;l++){let m=l*6;this.sparks[m+5]<=0||(this.sparks[m+5]=this.sparks[m+5]-t,this.sparks[m]=this.sparks[m]+(this.sparks[m+3]+Math.sin(n*3+l)*4)*t,this.sparks[m+2]=this.sparks[m+2]+this.sparks[m+4]*t,this.sparks[m+4]=this.sparks[m+4]*1-t*.6)}for(this.puffAcc+=t*1.6;this.puffAcc>1;)this.puffAcc-=1,this.puff(this.rand()<.7?0:1);for(let l=0;l<rt;l++){let m=l*6;if(!(this.puffs[m+3]<=0)){if(this.puffs[m+2]=this.puffs[m+2]+t,this.puffs[m+2]>this.puffs[m+3]){this.puffs[m+3]=0;continue}this.puffs[m+1]=this.puffs[m+1]+t*(5+this.puffs[m+2]*.8),this.puffs[m]=this.puffs[m]+t*(2.5+this.puffs[m+5]+Math.sin(n*.7+l)*1.5)}}let s=r&&e.over;for(let l=0;l<J;l++){let m=l*8,c=this.flies,b=c[m+6],p=(R(n*.25,b,1)-.5)*30,f=(R(n*.25,b,2)-.5)*12,g=(R(n*.3,b,3)-.5)*16,d=c[m+7],M=d===0?a.edge-4:a.edge+16,y=d===0?a.edge+26:a.h-2;c[m+1]<M&&(f+=12),c[m+1]>y&&(f-=12),c[m+2]<3&&(g+=14),c[m+2]>26&&(g-=14),c[m]<4&&(p+=20),c[m]>a.w-4&&(p-=20);let L=c[m]-a.fire.x,x=(c[m+1]-a.fire.y)*2.5;if(Math.hypot(L,x)<30&&(p+=Math.sign(L||1)*25,f+=Math.sign(x||1)*8),s){let v=e.x-c[m],T=e.y+c[m+2]*0-(c[m+1]-c[m+2]),k=Math.hypot(v,T);k<90&&k>3&&(p+=v/k*40,f+=T/k*20)}c[m+3]=(c[m+3]+p*t)*(1-t*1.2),c[m+4]=(c[m+4]+f*t)*(1-t*1.2),c[m+5]=(c[m+5]+g*t)*(1-t*1.2),c[m]=c[m]+c[m+3]*t,c[m+1]=c[m+1]+c[m+4]*t,c[m+2]=c[m+2]+c[m+5]*t}let i=this.deer;if(!i.on&&n>i.next&&this.night!==void 0&&(i.on=!0,i.dir=this.rand()<.5?1:-1,i.x=i.dir>0?-14:a.w+14,i.row=a.edge+8+this.rand()*16,i.goal=i.dir>0?a.w*(.12+this.rand()*.25):a.w*(.62+this.rand()*.26),i.state=0,i.step=0),i.on)if(i.state===0||i.state===2){let l=8*i.dir*t;i.x+=l,i.step+=Math.abs(l),i.state===0&&(i.x-i.goal)*i.dir>0&&(i.state=1,i.until=n+7+this.rand()*8),i.state===2&&(i.x<-20||i.x>a.w+20)&&(i.on=!1,i.next=n+80+this.rand()*90)}else n>i.until&&(i.state=2);let h=this.eyes;if(h.at<0&&n>h.next&&(h.at=Math.floor(this.rand()*a.eyes.length),h.from=n,h.until=n+3+this.rand()*4),h.at>=0&&n>h.until&&(h.at=-1,h.next=n+9+this.rand()*14),n>this.nextJump){this.nextJump=n+12+this.rand()*20;let l=a.pond,m=this.rand()*Math.PI*2;this.addRipple(l.cx+Math.cos(m)*l.rx*.5,l.cy+Math.sin(m)*l.ry*.4,.6)}}spark(){for(let t=0;t<et;t++){let e=t*6;if(!(this.sparks[e+5]>0)){this.sparks[e]=this.g.fire.x+(this.rand()-.5)*6,this.sparks[e+1]=this.g.fire.y,this.sparks[e+2]=8+this.rand()*6,this.sparks[e+3]=(this.rand()-.5)*8,this.sparks[e+4]=18+this.rand()*22+this.flare*20,this.sparks[e+5]=.7+this.rand()*1.1;return}}}puff(t){for(let e=0;e<rt;e++){let r=e*6;if(!(this.puffs[r+3]>0)){this.puffs[r]=t?this.g.fire.x+(this.rand()-.5)*3:this.g.chimney.x,this.puffs[r+1]=t?18:0,this.puffs[r+2]=0,this.puffs[r+3]=t?2.2:5+this.rand()*2,this.puffs[r+4]=t,this.puffs[r+5]=this.rand()*2;return}}}addRipple(t,e,r){let n=this.ripple++%4*4;this.ripples[n]=t,this.ripples[n+1]=e,this.ripples[n+2]=this.t,this.ripples[n+3]=r}get rippleData(){return this.ripples}click(t,e){let r=this.g;if(Math.hypot(t-r.fire.x,(e-r.fire.y)*1.5)<26){this.flare=1;for(let a=0;a<24;a++)this.spark();return}let n=r.pond;if(((t-n.cx)/n.rx)**2+((e-n.cy)/n.ry)**2<1){this.addRipple(t,e,1);return}for(let a=0;a<J;a++){let u=a*8,s=this.flies[u]-t,i=this.flies[u+1]-this.flies[u+2]-e,h=Math.hypot(s,i);h<60&&(this.flies[u+3]=this.flies[u+3]+s/(h||1)*60,this.flies[u+4]=this.flies[u+4]+i/(h||1)*25,this.flies[u+5]=this.flies[u+5]+10)}}settle(){this.t=48,this.flare=0,this.sparks.fill(0),this.puffs.fill(0),this.deer.on=!1,this.eyes.at=-1,this.placeFlies();let t=this.g;for(let e=0;e<6;e++){let r=e*6;this.sparks[r]=t.fire.x+(G(e,1)-.5)*8,this.sparks[r+1]=t.fire.y,this.sparks[r+2]=12+e*6,this.sparks[r+5]=.5}for(let e=0;e<5;e++){let r=e*6;this.puffs[r]=t.chimney.x+e*3,this.puffs[r+1]=e*5,this.puffs[r+2]=e,this.puffs[r+3]=6,this.puffs[r+4]=0}}sprite(t,e,r,n,a={}){if(this.spriteCount>=Qt)return;let u=this.sprites,s=this.spriteCount++*j;u[s]=Math.round(e-t.w/2),u[s+1]=Math.round(r-n-t.h+1),u[s+2]=t.w,u[s+3]=t.h,u[s+4]=t.x,u[s+5]=t.y,u[s+6]=r,u[s+7]=a.z??0,u[s+8]=a.flip?1:0,u[s+9]=a.glow??1,u[s+10]=a.alpha??1,u[s+11]=n;let i=a.tint??[1,1,1];u[s+12]=i[0],u[s+13]=i[1],u[s+14]=i[2],u[s+15]=a.tintMix??0}light(t,e,r,n,a,u,s){if(this.lightCount>=I)return;let i=this.lights,h=this.lightCount++*8;i[h]=t,i[h+1]=e,i[h+2]=r,i[h+3]=n,i[h+4]=a,i[h+5]=u,i[h+6]=s,i[h+7]=0}collect(t,e){this.spriteCount=0,this.lightCount=0;let r=this.g,n=this.atlas,a=this.t,u=nt(a),s=this.fireStrength()*(1-u.rain*.25),i=Math.floor(a*14)%n.flame.length,h=n.flame.length;this.sprite(n.flame[(i+5)%h],r.fire.x-4,r.fire.y+1,0,{glow:.85*s,z:.4,flip:!0}),this.sprite(n.flame[(i+11)%h],r.fire.x+4,r.fire.y+1,-1,{glow:.8*s,z:.3}),this.sprite(n.flame[i],r.fire.x,r.fire.y+2,2,{glow:1.1*s,z:1});for(let f=0;f<9;f++){let g=f*2.4,d=3+f%3*2,M=.5+.5*Math.sin(a*(1.3+f%4*.4)+f*1.7);this.sprite(n.dot,r.fire.x+Math.cos(g)*d,r.fire.y+Math.sin(g)*d*.4,.5,{glow:.35+M*.5,tint:[1,.3+M*.25,.08],tintMix:1,z:.2})}this.light(r.fire.x,9,r.fire.y*2+2,125*Math.sqrt(s),1*t*s,.42*t*s,.13*t*s);for(let f=0;f<et;f++){let g=f*6,d=this.sparks[g+5];if(d<=0)continue;let M=Math.min(1,d*1.5);this.sprite(n.dot,this.sparks[g],this.sparks[g+1],this.sparks[g+2],{glow:1.2*M,tint:[1,.55+.3*M,.2*M],tintMix:1,z:2})}for(let f=0;f<rt;f++){let g=f*6,d=this.puffs[g+3];if(d<=0)continue;let M=this.puffs[g+2]/d,y=this.puffs[g+4],L=n.smoke[Math.min(n.smoke.length-1,Math.floor(M*n.smoke.length))],x=y?{x:r.fire.x,foot:r.fire.y}:{x:r.chimney.x,foot:r.chimney.y+r.chimney.h},v=y?this.puffs[g+1]:r.chimney.h+this.puffs[g+1];this.sprite(L,this.puffs[g],x.foot,v,{alpha:(1-M)*(y?.35:.6)*(M<.1?M*10:1),z:y?-2:40})}let l=Math.sin(a/3.4*Math.PI*2)>.2?1:0,m=a%11<.35?2:l;this.sprite(n.fox[m],r.fox.x,r.fox.y,0,{});let c=this.deer;if(c.on){let g=c.state===1?n.deerGraze[Math.floor(a*.8)%2]:n.deerWalk[Math.floor(c.step/2.5)%4];this.sprite(g,c.x,c.row,0,{flip:c.dir<0,glow:this.night?1:0})}for(let f of r.lights){let g=f.flicker===1?1+.08*Math.sin(a*11+f.x)+.06*(R(a*4,f.x,1)-.5):f.flicker===2?1+.04*Math.sin(a*3+f.x):1,d=f.power*g*(f.lamp?e:this.night?1:.2);if(d<=.01)continue;let M=f.colour.map(y=>Math.pow(y/255,2.2)*d);this.light(f.x,f.h,f.z,f.reach,M[0],M[1],M[2])}if(!this.night)return;let b=[];for(let f=0;f<J;f++){let g=f*8,d=this.flies[g+6],M=Math.max(0,Math.sin(a*(.9+d%1*.6)+d))**3*(1-u.rain*.8);if(M<.05)continue;let y=this.flies[g],L=this.flies[g+1],x=this.flies[g+2];this.sprite(n.dot,y,L,x,{glow:.4+M*1.1,tint:[.75,1,.35],tintMix:1,z:3}),M>.6&&b.length<8&&(b.push(f),this.light(y,x,L*2,16,.12*M,.2*M,.04*M))}let p=this.eyes;if(p.at>=0){let f=r.eyes[p.at],g=Math.min(1,(a-p.from)*2,(p.until-a)*2),d=(a-p.from)%2.3<.12?0:1;if(g>0&&d)for(let M of[0,3])this.sprite(n.dot,f.x+M,f.z/2,f.z/2-f.y,{glow:.55*g,tint:[.8,.9,.45],tintMix:1,z:1})}}};var Wt=o=>{let t=Math.hypot(...o);return[o[0]/t,o[1]/t,o[2]/t]},jt=o=>[parseInt(o.slice(1,3),16)/255,parseInt(o.slice(3,5),16)/255,parseInt(o.slice(5,7),16)/255],he={night:!0,fire:2.7,lamps:1,mist:[.12,.5],base:{moonDir:Wt([-.35,.75,.55]),moon:[.1,.125,.22],skyAmb:[.03,.037,.066],groundAmb:[.008,.009,.013],fog:[.014,.018,.032],fogK:1/190,fogMax:.92,rainCol:[.06,.07,.09],stillGlow:1,sheen:[.006,.009,.018,.5],skyLift:1,stars:1,skyMix:0,skyTop:[0,0,0],skyBottom:[0,0,0],exposure:1.05,glow:1,vignette:.55,paper:[1,1,1],lo:0,hi:1,chroma:1}},le={night:!1,fire:.7,lamps:0,mist:[.05,.35],base:{moonDir:Wt([-.55,.7,.45]),moon:[.95,.86,.7],skyAmb:[.42,.46,.52],groundAmb:[.16,.16,.14],fog:[.72,.75,.76],fogK:1/190,fogMax:.4,rainCol:[.5,.55,.6],stillGlow:.25,sheen:[.25,.3,.36,.6],skyLift:0,stars:0,skyMix:1,skyTop:[.5,.6,.72],skyBottom:[.8,.8,.76],exposure:1.1,glow:.4,vignette:0,paper:[1,.985,.955],lo:.74,hi:1,chroma:.75}};function xt(o){let t=o.dark?he:le;return{...t,base:{...t.base,theme:!o.colour,darkTheme:o.dark,page:jt(o.page),text:jt(o.text)}}}function Ht(o,t){t.night=o.night,t.collect(o.fire,o.lamps);let e=nt(t.t);return{...o.base,time:t.t,wind:.55+.3*Math.sin(t.t*.05)+e.rain*.5,lights:t.lights,lightCount:t.lightCount,sprites:t.sprites,spriteCount:t.spriteCount,ripples:t.rippleData,mist:o.mist[0]+(e.mist-.15)*o.mist[1],wet:e.wet,rain:e.rain,stars:o.base.stars*(1-e.rain*.85)}}var te=256,ee=128;function me(){let o=0,t=0,e=0;return(r,n)=>{o+r>te&&(o=0,t+=e+1,e=0);let a={x:o,y:t,w:r,h:n};if(o+=r+1,e=Math.max(e,n),t+n>ee)throw new Error("the sprite atlas is full");return a}}function W(o,t){let e=t.y+t.h-1;for(let r=t.y;r<t.y+t.h;r++)for(let n=t.x;n<t.x+t.w;n++){let a=(r*o.w+n)*4;o.alb[a+3]&&(o.dat[a+1]=o.dat[a+1]-e*2)}}function Mt(o,t,e){let r=(a,u)=>a>=t.x&&u>=t.y&&a<t.x+t.w&&u<t.y+t.h&&o.alb[(u*o.w+a)*4+3]>0,n=[];for(let a=t.y;a<t.y+t.h;a++)for(let u=t.x;u<t.x+t.w;u++){if(r(u,a))continue;let s=[[1,0],[-1,0],[0,1],[0,-1]].map(([i,h])=>r(u+i,a+h)?(a+h)*o.w+u+i:-1).find(i=>i>=0);s!==void 0&&n.push([u,a,o.dat[s*4],o.dat[s*4+1]])}for(let[a,u,s,i]of n)o.put(a,u,e,[0,0,1],s,i-.5,A.SOLID)}var vt=["#6e1c10","#b8321a","#ec6420","#ffa23a","#ffd76a","#fff3c4"].map(w);function ce(o,t,e,r){let n=t.x+t.w/2,a=t.y+t.h-1,u=e/r*Math.PI*2;for(let s=t.y;s<t.y+t.h;s++){let i=(a-s)/t.h;for(let h=t.x;h<t.x+t.w;h++){let l=h+.5-n,m=e/r*10,c=R(l*.42+Math.cos(u)*.6,(s-t.y)*.3+m,11),b=R(l*.42+Math.cos(u)*.6,(s-t.y)*.3+m-10,11),p=c*(1-e/r)+b*(e/r),f=Math.sin(i*5-u)*i*1.6,g=(t.w*.5-.5)*Math.pow(1-i,.75)*(.85+.15*Math.sin(u+i*3)),d=1-Math.abs(l-f)/Math.max(.6,g)-i*.55+(p-.5)*.9;if(d<.04)continue;let M=vt[Math.min(vt.length-1,Math.floor(O(d*1.25+(1-i)*.35)*vt.length))],y=K(M,[255,255,255],.1);o.put(h,s,M,[0,0,1],a-s,a*2+4,A.SOLID,y)}}}function fe(o,t,e){let r=t.y+t.h-1,n=t.x+t.w/2,a=e===1?.5:0,u=["#7a3a1a","#9a4a20","#b85e2a","#cf7a3c"].map(w),s=w("#e8d6bc");D(o,n+1,r-3.2-a*.6,6.5,3.4+a*.4,r,{colour:(h,l,m,c,b)=>l>.45&&h>-.4?s:F(u,.35-l*.45+R(c*.8,b*.8,3)*.3,c,b)}),D(o,n-4.5,r-2.6,2.8,2.3,r,{colour:(h,l,m,c,b)=>h<-.55&&l>-.1?w("#2a1a12"):F(u,.55-l*.3,c,b),bulge:4});let i=e===2?1:0;for(let h of[-5.5,-3.8])for(let l=0;l<2+(h===-3.8?i:0);l++)o.put(n+h,r-5-l,l===0?w("#9a4a20"):w("#3a2014"),[0,.3,1],5+l,r*2+4,A.SOLID);D(o,n+1.5,r-1.3,5.5,1.5,r,{colour:(h,l,m,c,b)=>h<-.55?s:F(u,.6+R(c,b,5)*.3,c,b),bulge:5})}function Yt(o,t,e,r){let n=t.y+t.h-1,a=t.x+t.w/2-1,u=["#4a3324","#5e422e","#735239","#866246"].map(w),s=w("#b39a7e"),i=(b,p)=>{let f=r?0:Math.sin(p)*1.6;for(let g=0;g<7;g++){let d=b+f*(g/6)*(g/6);o.put(d,n-6+g,g>5?w("#221812"):F(u,.3,Math.round(d),n-6+g),[0,0,1],6-g,n*2+3,A.SOLID)}},h=e/4*Math.PI*2;i(a-4,h+Math.PI),i(a+3,h),D(o,a,n-8,5.6,2.6,n,{colour:(b,p,f,g,d)=>p>.4?s:F(u,.45-p*.4+R(g,d,9)*.25,g,d)}),i(a-3,h),i(a+4,h+Math.PI);let l=r?a+7:a+6.5,m=r?n-3+(e===1?.5:0):n-13+(Math.sin(h*2)>.5?.5:0),c=6;for(let b=0;b<=c;b++){let p=b/c,f=a+4+(l-a-4)*p,g=n-9+(m-n+9)*p;D(o,f,g,1.4,1.4,n,{colour:(d,M,y,L,x)=>F(u,.5+R(L,x,10)*.3,L,x),bulge:3})}D(o,l+1,m,2.2,1.5,n,{colour:(b,p,f,g,d)=>b>.7?w("#1a120e"):F(u,.55-p*.3,g,d),bulge:3.5}),o.put(l-.5,m-2,u[2],[0,.3,1],n-m+2,n*2+4,A.SOLID),o.put(l+.5,m-2.5,u[1],[0,.3,1],n-m+2.5,n*2+4,A.SOLID),o.put(l+1,m-.5,w("#202a20"),[0,0,1],n-m+.5,n*2+5,A.SOLID,[70,110,80]),o.put(a-6,n-9,w("#e8e0d0"),[0,0,1],9,n*2+3.5,A.SOLID)}function be(o,t){let e=t.w/2;D(o,t.x+e,t.y+e,e-.3,e-.3,t.y+t.h-1,{colour:(r,n,a,u,s)=>K(w("#4c4a4c"),w("#6a6668"),O(-n*.5+.5)),ragged:.5,seed:t.x})}function re(){let o=new X(te,ee),t=me(),e=Array.from({length:16},(h,l)=>{let m=t(15,26);return ce(o,m,l,16),W(o,m),m}),r=Array.from({length:3},(h,l)=>{let m=t(20,10);return fe(o,m,l),Mt(o,m,w("#1a0e08")),W(o,m),m}),n=Array.from({length:4},(h,l)=>{let m=t(24,18);return Yt(o,m,l,!1),Mt(o,m,w("#120c08")),W(o,m),m}),a=Array.from({length:2},(h,l)=>{let m=t(24,18);return Yt(o,m,l,!0),Mt(o,m,w("#120c08")),W(o,m),m}),u=[5,7,9].map(h=>{let l=t(h,h);return be(o,l),W(o,l),l}),s=t(1,1);o.put(s.x,s.y,[255,255,255],[0,0,1],0,0,A.SOLID,[255,255,255]);let i=t(1,3);for(let h=0;h<3;h++)o.put(i.x,i.y+h,[150,165,185],P([0,.2,1]),2-h,0,A.SOLID);return{p:o,flame:e,fox:r,deerWalk:n,deerGraze:a,smoke:u,dot:s,drop:i}}var N=await pe(),oe=document.body.appendChild(document.createElement("canvas"));Object.assign(oe.style,{position:"fixed",inset:"0",width:"100vw",height:"100vh",display:"block",imageRendering:"pixelated"});var wt=new tt(oe),ne=re(),U={px:4,w:1,h:1},H,_,yt=xt(N.look),it={x:0,y:0,over:!1};N.on("viewport",({w:o,h:t,dpr:e})=>{let r=Ct(o,t);if(wt.resize(Math.round(o*e),Math.round(t*e)),r.w===U.w&&r.h===U.h&&H){U=r;return}U=r,H=Ot(r.w,r.h),wt.setArt(H.still,ne.p),_?_.setGlade(H):_=new ot(H,ne)});N.on("look",o=>{yt=xt(o),_&&(_.night=yt.night)});N.on("pointer",({x:o,y:t,over:e})=>{it.x=o/U.px,it.y=t/U.px,it.over=e});N.on("click",({x:o,y:t})=>{N.mode==="run"&&_?.click(o/U.px,t/U.px)});function ge(){_&&wt.draw(Ht(yt,_))}N.animate({step:o=>_?.step(o,it,N.mode==="run"),draw:ge,settle:()=>_?.settle()});
