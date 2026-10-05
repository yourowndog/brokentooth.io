/* Brokentooth: one unbroken push from a city-sized machine into a lit window,
   over a shoulder, into the page being written. Raw WebGL2, no dependencies.
   World units are metres. The facade sits at depth DF; the room is behind it. */
(() => {
'use strict';

const DF = 1000.0;
const MON = [0.05, -0.32];
const MON_D = DF + 3.85;
const F = 1.6;                       // focal length (screen half-height = 1)

let needsFrame = true;
const params = new URLSearchParams(location.search);
const STILL_T = params.has('t') ? parseFloat(params.get('t')) : null;
const STILL_TIME = params.has('time') ? parseFloat(params.get('time')) : null;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const canvas = document.getElementById('world');
const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: STILL_T !== null });
if (!gl) { document.documentElement.classList.add('nogl'); return; }
// if the GPU is reset, fall back to the plain page rather than a dead canvas
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); document.documentElement.classList.add('nogl'); });

/* ------------------------------------------------------------------ shaders */

const VERT = `#version 300 es
void main(){ vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2); gl_Position = vec4(p*2.0-1.0,0.0,1.0); }`;

const SCENE = `#version 300 es
precision highp float;
out vec4 o;
uniform vec2 uRes;
uniform vec3 uCam;
uniform float uF, uTime, uFocus, uAp, uRain, uLit;
uniform sampler2D uName, uScreen;
uniform vec2 uCursor;

#define DF 1000.0
const vec2 MON = vec2(0.05,-0.32);
const vec2 MONH = vec2(0.29,0.17);
const vec3 WARM = vec3(1.0,0.60,0.30);
const vec3 COLD = vec3(0.62,0.74,0.80);

float PXS;

float h11(float p){p=fract(p*.1031);p*=p+33.33;p*=p+p;return fract(p);}
float h21(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
vec2 h22(vec2 p){vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));p3+=dot(p3,p3.yzx+33.33);return fract((p3.xx+p3.yz)*p3.zy);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<5;i++){s+=a*vn(p);p=p*2.03+vec2(17.1,9.3);a*=.5;}return s;}
float fbm3(vec2 p){float a=.5,s=0.;for(int i=0;i<3;i++){s+=a*vn(p);p=p*2.03+vec2(17.1,9.3);a*=.5;}return s;}

float sdBox(vec2 p, vec2 b){vec2 d=abs(p)-b;return length(max(d,0.))+min(max(d.x,d.y),0.);}
float sdRBox(vec2 p, vec2 b, float r){return sdBox(p,b-r)-r;}
float sdSeg(vec2 p, vec2 a, vec2 b){vec2 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.);return length(pa-ba*h);}
float smin(float a,float b,float k){float h=clamp(.5+.5*(b-a)/k,0.,1.);return mix(b,a,h)-k*h*(1.-h);}
mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
// coverage of an sdf with blur width w (world units)
float cov(float d, float w){return clamp(.5-d/w,0.,1.);}
// thin line that keeps its energy when blurred wider than itself
float line(float d, float ht, float w){float he=max(ht,w*.5);return clamp(.5-(d-he)/w,0.,1.)*(ht/he);}

vec2 proj(vec2 s, float depth, out float dist, out float px, out float w){
  dist = depth - uCam.z;
  px = PXS*dist/uF;
  float c = min(uAp*abs(1.0-uFocus/max(dist,1e-4)), 70.0);
  w = px*(1.3+c);
  return uCam.xy + s*dist/uF;
}
float nearFade(float dist, float a, float b){return smoothstep(a,b,dist);}

/* ---------------------------------------------------------------- sky */
vec3 fogc(float y){
  vec3 c=mix(vec3(.022,.028,.033), vec3(.008,.011,.014), smoothstep(-.3,1.0,y));
  return c*mix(.18,1.,smoothstep(-1.05,-.15,y));
}
vec3 sky(vec2 s){
  float y=s.y;
  vec3 c=mix(vec3(.060,.072,.080),vec3(.008,.011,.015),smoothstep(-.45,1.15,y));
  c+=vec3(.030,.036,.040)*exp(-pow(y+.25,2.)*6.);
  vec2 q=vec2(s.x*.55+uTime*.0035, y*1.9);
  float n=fbm(q*1.5+vec2(0.,3.));
  float n2=fbm(q*4.0+vec2(5.,uTime*.002));
  float cl=smoothstep(.46,.74,n*.8+n2*.25)*smoothstep(1.35,-.1,y);
  vec3 cc=mix(vec3(.016,.020,.024),vec3(.095,.105,.110),smoothstep(.7,-.3,y));
  cc*=.75+.5*smoothstep(.55,.8,n2);
  c=mix(c,cc,cl*.9);
  return c;
}

/* ------------------------------------------------------------ skyline */
float skyl(float x, float W, float seed, float hmin, float hmax, out float sid, out float stk, out float scx){
  float id=floor(x/W); float f=fract(x/W); sid=id;
  float h=h11(id*1.37+seed);
  float top=mix(hmin,hmax,h*h);
  float ins=.06+.16*h11(id+seed*3.1);
  if(f<ins||f>1.-ins) top=mix(hmin,top,.5+.3*h11(id+seed*7.7));
  if(h11(id+seed*11.3)<.12) top=hmin*.35;
  stk=0.; scx=(id+.5)*W;
  if(h11(id+seed*5.9)<.24){
    float cx=.5+.3*(h11(id+seed*2.3)-.5); scx=(id+cx)*W;
    float sw=.045*(1.-.4*clamp((x-scx)/W,0.,1.));
    if(abs(f-cx)<.045){ stk=1.; top=top+(hmax-hmin)*(.45+.4*h11(id+seed*8.1)); }
  }
  return top;
}

vec4 farLayer(vec2 s, float depth, float W, float seed, float hmin, float hmax, float fogK, out vec3 e){
  e=vec3(0);
  float dist,px,w; vec2 p=proj(s,depth,dist,px,w);
  float sid,stk,scx; float top=skyl(p.x,W,seed,hmin,hmax,sid,stk,scx);
  float a=cov(p.y-top,w);
  float f=clamp(1.-exp(-dist*fogK),0.,1.);
  f=clamp(f+smoothstep(hmin*.3,-420.,p.y)*.55,0.,.97);
  vec3 fc=fogc(s.y);
  // beacon on the tallest
  float bt=hmin+(hmax-hmin)*.62;
  if(top>bt){
    vec2 b=vec2(scx,top+2.);
    float dpx=length(p-b)/px;
    float blink=step(.55,fract(uTime*.45+h11(sid+seed)));
    e+=vec3(1.,.10,.04)*exp(-dpx*dpx*.25)*blink*2.2*(1.-f*.6);
  }
  if(a<=0.) return vec4(0);
  vec3 c=vec3(.006,.008,.010);
  c*=.8+.5*step(.5,fract(p.y/(W*.05)+h11(sid)));
  if(stk>.5) c*=1.3+.4*step(.5,fract(p.y/(W*.12)));
  vec2 bc=vec2(W*.085,W*.028);
  vec2 bi=floor(p/bc); vec2 bf=fract(p/bc);
  float lit=step(h21(bi+seed*3.7),.03)*step(p.y,top-bc.y)*(1.-stk);
  float lm=lit*a*cov(abs(bf.y-.5)-.16,w/bc.y*2.)*cov(abs(bf.x-.5)-.38,w/bc.x*2.);
  c=mix(c,fc,f);
  e+=COLD*lm*.30*(1.-f*.85);
  return vec4(c,a);
}

vec4 plume(vec2 s, float depth, vec2 base, float wd, out float dist){
  float px,w; vec2 p=proj(s,depth,dist,px,w);
  vec2 q=p-base; float h=q.y;
  if(h<0.) return vec4(0);
  float drift=h*.85+18.*sin(h*.006+uTime*.05);
  float spread=wd*.5+h*.32;
  float dx=q.x-drift;
  float m=smoothstep(spread,spread*.2,abs(dx));
  float n=fbm(vec2(dx,h)*.011-vec2(uTime*.03,uTime*.06));
  m*=smoothstep(.25,.65,n)*smoothstep(0.,25.,h)*exp(-h/650.);
  vec3 c=mix(vec3(.11,.12,.125),vec3(.04,.045,.05),smoothstep(0.,500.,h));
  return vec4(c,m*.75);
}

/* ------------------------------------------------------------ facade */
const vec4 TW[5] = vec4[5](
  vec4(-700.,900.,520.,1.),
  vec4(-1010.,-770.,300.,2.),
  vec4(960.,1210.,430.,3.),
  vec4(-1420.,-1090.,230.,4.),
  vec4(1270.,1520.,270.,5.)
);
#define CROWN 468.
// the megastructure steps back as it rises into the cloud
float megaRoof(float x){
  float r=520.;
  if(x>-520.&&x<720.) r=980.;
  if(x>-330.&&x<520.) r=1700.;
  return r;
}

// glass of an ordinary window (not ours)
vec3 darkGlass(float bi, float fl, float cy, float seed){
  float hb=h21(vec2(bi,fl)+seed*3.);
  vec3 g=vec3(.007,.009,.011)+.008*h21(vec2(bi,fl)+seed);
  g+=vec3(.008,.010,.012)*(cy+1.3)/2.5;
  if(hb<.32){
    float lvl=1.2-h21(vec2(bi,fl)+seed*5.)*2.3;
    if(cy>lvl) g=vec3(.018,.021,.023)*(.75+.25*step(.5,fract(cy*13.)));
  }
  return g;
}

vec4 facade(vec2 p, float px, float w, float dist, vec2 s, out vec3 e, out float ap){
  e=vec3(0); ap=0.;
  int ti=-1;
  for(int i=0;i<5;i++){ if(p.x>TW[i].x-1. && p.x<TW[i].y+1.) ti=i; }
  // mast + beacon on our tower
  float mastA=0.;
  {
    float mx=214.;
    float mw=1.1;
    mx=-640.;
    float lat=line(abs(p.x-mx),mw,w)*step(p.y,612.)*step(520.,p.y);
    float cross=line(abs(fract((p.y)/7.)-.5)*7.,.25,w)*step(abs(p.x-mx),3.)*step(p.y,608.)*step(520.,p.y);
    mastA=max(lat,cross*.8);
    vec2 b=vec2(mx,614.);
    float dpx=length(p-b)/px;
    float blink=smoothstep(.0,.08,fract(uTime*.33))*smoothstep(.5,.3,fract(uTime*.33));
    e+=vec3(1.,.10,.04)*(exp(-dpx*dpx*.2)*2.5+exp(-length(p-b)*.5)*.3)*blink;
  }
  if(ti<0){
    vec3 mc=vec3(.006,.007,.008);
    return vec4(mc,mastA);
  }
  vec3 eB=e; e=vec3(0);
  vec4 T=TW[ti];
  float seed=T.w;
  float rid=floor(p.x/11.);
  float roofBase=(ti==0)?megaRoof(p.x):T.z;
  float roof=roofBase+(h21(vec2(rid,seed))<.55 ? 2.5+9.*h21(vec2(rid,seed+1.)) : 0.);
  float edgeX=min(p.x-T.x,T.y-p.x);
  float a=cov(p.y-roof,w)*cov(-edgeX,w);
  a=max(a,mastA);

  float fl=floor((p.y+1.8)/3.6); float cy=p.y-fl*3.6;
  float bi=floor((p.x+1.2)/2.4); float cx=p.x-bi*2.4;
  float lod=smoothstep(.25,1.2,px);

  vec3 wall=vec3(.017,.020,.022);
  wall+=vec3(.006,.007,.008)*smoothstep(-1.8,1.8,p.y-floor((p.y+1.8)/3.6)*3.6);
  float st=fbm3(p*vec2(.045,.011)+seed*7.);
  float streak=vn(vec2(p.x*1.9,p.y*.025+seed*13.));
  wall*=.65+.6*st; wall*=.75+.4*streak;
  wall*=.75+.25*smoothstep(-200.,200.,p.y);

  bool mech=abs(mod(fl,12.)-5.)<.5;
  bool riser=abs(mod(bi,9.)-4.)<.5;
  bool crown=(ti==0 && p.y>CROWN-1. && p.y<CROWN+52.);
  bool podium=(p.y<-150.);
  vec3 c=wall;
  float ours=(ti==0 && bi==0. && fl==0.)?1.:0.;

  if(crown){
    vec3 cc=vec3(.040,.044,.047)*(.75+.45*st);
    float lx=(fract(p.x/78.+.5)-.5)*78.; float hy=p.y-CROWN;
    float cone=exp(-lx*lx/(2.*pow(4.+hy*.7,2.)))*exp(-hy*.028);
    float light=.30+1.9*cone;
    c=cc*light;
    // painted name
    vec2 uv=vec2((p.x+655.)/840.,(p.y-(CROWN+7.))/40.);
    if(uv.x>0.&&uv.x<1.&&uv.y>0.&&uv.y<1.){
      float n=texture(uName,vec2(uv.x,1.-uv.y)).a;
      float chip=.55+.45*smoothstep(.25,.6,fbm3(p*.5+3.));
      c=mix(c,vec3(.50,.52,.52)*(light*.8+.35),n*chip);
    }
    c*=1.-.6*line(abs(p.y-(CROWN+.6)),.5,w);
    e+=COLD*exp(-(lx*lx+hy*hy)/max(px*px*3.,.5))*.45;
  } else if(podium){
    c=wall*.7*(.85+.15*step(.5,fract(p.y/9.)));
  } else if(mech){
    c=wall*.55*mix(.75+.35*step(.5,fract(cy*5.)),1.,lod);
  } else if(riser){
    float pc=0.;
    for(int k=0;k<3;k++){
      float x0=-.62+.62*float(k); float r=.24;
      float dd=abs(cx-x0);
      float sh=sqrt(max(1.-pow(dd/r,2.),0.));
      pc=max(pc,cov(dd-r,w)*(.35+.9*sh));
    }
    c=mix(wall*.5,vec3(.030,.033,.036)*(1.+.3*step(abs(cy),.12)),pc*(1.-lod)+lod*.4);
  } else {
    float wm=cov(sdBox(vec2(cx,cy+.05),vec2(1.,1.3)),w);
    vec3 g=darkGlass(bi,fl,cy,seed);
    float run=h21(vec2(fl,seed*3.))<.04?24.:5.;
    vec2 blk=vec2(floor(bi/run),fl);
    float lit=step(h21(blk+seed*13.),run>6.?.05:.0065)*step(.14,h21(vec2(bi,fl)+9.));
    float flick=1.-.5*step(.97,h21(vec2(bi+fl,floor(uTime*9.))))*step(.85,h21(vec2(bi,fl)+2.));
    if(ours>.5){
      float near=smoothstep(.10,.035,px);
      ap=wm*near;
      c=mix(wall,g,wm*(1.-near));
      e+=WARM*4.5*wm*(1.-near)*uLit;
      // frame + mullion when near
      float fr=abs(sdBox(vec2(cx,cy+.05),vec2(1.,1.3)));
      float frame=line(fr,.045,w);
      float mull=line(abs(cx-.42),.028,w)*step(abs(cy+.05),1.3);
      float fm=max(frame,mull)*near;
      vec3 fcol=vec3(.020,.023,.026)+COLD*.05*smoothstep(.04,.0,abs(cy+.05-1.3+.02));
      c=mix(c,fcol,fm); ap*=1.-fm;
    } else {
      c=mix(wall,g,wm);
      float ly=(cy+.05+1.3)/2.6;           // 0 at sill, 1 at head
      float strip=line(abs(cy-1.05),.035,w);
      float part=cov(cy+.62,w)*(.35+.65*step(.5,fract(cx*1.7+h21(vec2(bi,fl))*3.)));
      float occ=1.-.7*part*(1.-lod)-.25*(1.-ly)*(1.-lod);
      vec3 office=COLD*vec3(.92,1.,.96)*(.55+.45*ly)*occ+COLD*strip*1.4*(1.-lod);
      e+=office*lit*wm*.20*flick*(.6+.4*h21(blk+2.));
    }
    float joint=line(1.8-abs(cy),.012,w)+line(1.2-abs(cx),.010,w)*step(cy,-1.35);
    c*=1.-.45*clamp(joint,0.,1.)*(1.-lod);
  }
  // the megastructure's own skeleton, readable from a kilometre out
  if(ti==0 && !crown && p.y>-150.){
    // sky lobbies: a recessed void band every 36 floors
    float lob=mod(fl+25.,36.);
    if(lob<2.){
      vec3 vc=vec3(.004,.005,.006);
      float col=cov(abs(fract(p.x/9.6+.5)-.5)*9.6-.5,w);
      vc=mix(vc,vec3(.012,.014,.016),col);
      vc+=COLD*.10*step(.93,h21(vec2(floor(p.x/9.6),fl)))*(1.-col)*smoothstep(-1.8,.5,cy);
      c=vc; ap=0.;
    }
    // stair cores every 160 m: blank concrete with a lit landing per floor
    float cx2=fract((p.x+64.)/160.+.5)-.5; cx2*=160.;
    float core=cov(abs(cx2)-9.,w);
    if(core>0.){
      vec3 cc=wall*1.25;
      float land=cov(sdBox(vec2(cx2-3.,cy-.3),vec2(.5,.45)),w)*step(.25,h21(vec2(floor((p.x+64.)/160.),fl)));
      cc+=COLD*.22*land;
      c=mix(c,cc,core); ap*=1.-core;
    }
    // X-braced exoskeleton: 144 m by 129.6 m modules
    vec2 mq=vec2(mod(p.x+100.,144.),mod(p.y+25.,129.6));
    float k=129.6/144.;
    float d1=abs(mq.y-k*mq.x)/sqrt(1.+k*k);
    float d2=abs(mq.y-(129.6-k*mq.x))/sqrt(1.+k*k);
    float edgeH=min(mq.y,129.6-mq.y);
    float edgeV=min(mq.x,144.-mq.x);
    float br=min(min(d1,d2),min(edgeH,edgeV));
    float brace=cov(br-1.7,w);
    if(brace>0.){
      vec3 bc=vec3(.010,.012,.013)+COLD*.022*smoothstep(1.7,.0,br)*step(.5,fract(br*.3));
      float node=cov(min(length(mq-vec2(72.,64.8)),min(min(length(mq),length(mq-vec2(144.,0.))),min(length(mq-vec2(0.,129.6)),length(mq-vec2(144.,129.6)))))-5.,w);
      bc=mix(bc,vec3(.016,.018,.020),node);
      c=mix(c,bc,brace); ap*=1.-brace;
    }
  }
  // structural relief: projecting fins every three bays, slab edges every floor
  if(!crown && !podium){
    float fx=fract((p.x+1.2)/7.2+.5)-.5; fx*=7.2;
    float fin=cov(abs(fx)-.22,w);
    vec3 finc=vec3(.012,.014,.016)+vec3(.022,.026,.029)*smoothstep(.0,-.22,fx)*(1.-lod*.6);
    c=mix(c,finc,fin);
    float slab=line(abs(cy-1.8+.06),.06,w)*(1.-fin);
    c=mix(c,vec3(.035,.040,.043),slab*(1.-lod*.5));
    if(ours>.5||ti!=0) ap*=1.-fin;
  }

  // our light, seen from far away
  {
    vec2 tc=p-vec2(0.,-.05);
    float dpx=length(tc)/px;
    e+=WARM*exp(-dpx*dpx/6.)*smoothstep(.12,.9,px)*3.2*uLit;
    // light caught in the rain around the window
    e+=WARM*.030*exp(-length(tc*vec2(1.,.8))/2.6)*uLit;
    // warm light on the sill and reveal
    float sill=step(abs(cx),1.05)*smoothstep(-1.62,-1.36,cy)*step(cy,-1.33)*ours;
    c+=WARM*.10*sill*uLit*(1.-lod);
  }

  float f=clamp(1.-exp(-dist*.00035),0.,1.);
  f=clamp(f+smoothstep(-80.,-380.,p.y)*.8,0.,.97);
  c=mix(c,fogc(s.y),f);
  e*=(1.-f*.7)*a;
  e+=eB;
  return vec4(c,a*(1.-ap));
}

/* ----------------------------------------------- planes in front */
vec4 cloudDeck(vec2 p, float w, vec2 s){
  float y=p.y;
  if(y<560.) return vec4(0);
  vec2 q=vec2(p.x*.0016+uTime*.004,y*.0042);
  float n=fbm(q*2.)*.7+fbm(q*7.+3.)*.3;
  float base=smoothstep(560.,760.,y+n*160.);
  float a=base*smoothstep(.30,.62,n+(y-720.)*.0006);
  vec3 c=mix(vec3(.030,.036,.040),vec3(.014,.017,.020),smoothstep(650.,1100.,y));
  c+=vec3(.010,.012,.013)*smoothstep(.5,.9,n);
  return vec4(c,clamp(a,0.,.94));
}

vec4 pylon(vec2 p, float w, float dist, vec2 s){
  float xc=-930.;
  float y=p.y;
  float hw=mix(34.,7.,clamp((y+520.)/640.,0.,1.));
  float a=0.;
  if(y<140.){
    float legs=min(abs(p.x-(xc-hw)),abs(p.x-(xc+hw)));
    a=max(a,line(legs,.9,w));
    float seg=24.; float v=fract((y+520.)/seg);
    float x1=xc-hw+2.*hw*v, x2=xc+hw-2.*hw*v;
    float inside=step(abs(p.x-xc),hw);
    a=max(a,line(min(abs(p.x-x1),abs(p.x-x2))*.55,.35,w)*inside);
    a=max(a,line(abs(v-.0)*seg,.35,w)*inside);
  }
  // peak
  a=max(a,line(sdSeg(p,vec2(xc-7.,120.),vec2(xc,150.)),.7,w));
  a=max(a,line(sdSeg(p,vec2(xc+7.,120.),vec2(xc,150.)),.7,w));
  // arms
  float arm1=sdSeg(p,vec2(xc-50.,70.),vec2(xc+50.,70.));
  float arm2=sdSeg(p,vec2(xc-40.,104.),vec2(xc+40.,104.));
  a=max(a,line(arm1,1.1,w)); a=max(a,line(arm2,1.0,w));
  a=max(a,line(sdSeg(p,vec2(xc-50.,70.),vec2(xc-hw*.6,90.)),.4,w));
  a=max(a,line(sdSeg(p,vec2(xc+50.,70.),vec2(xc+hw*.6,90.)),.4,w));
  // insulators + cables
  for(int i=0;i<4;i++){
    float side=(i<2)?-1.:1.;
    float ay=(i%2==0)?70.:104.;
    float ax=xc+side*((i%2==0)?48.:38.);
    a=max(a,line(sdSeg(p,vec2(ax,ay),vec2(ax,ay-5.5)),.35,w));
    float L=2600.; float u=(p.x-ax)/L;
    float sag=110.+10.*float(i);
    float cy=ay-5.5-sag*4.*u*(1.-u)+u*30.;
    float ul=(ax-p.x)/1800.;
    float cyl=ay-5.5-90.*4.*ul*(1.-ul)-ul*40.;
    if(u>0.&&u<1.) a=max(a,line(abs(p.y-cy),.05,w)*.9);
    if(ul>0.&&ul<1.) a=max(a,line(abs(p.y-cyl),.05,w)*.9);
  }
  vec3 c=vec3(.006,.008,.010);
  c=mix(c,fogc(s.y),clamp(1.-exp(-dist*.0005),0.,1.)*.25+smoothstep(-150.,-520.,y)*.5);
  return vec4(c,clamp(a,0.,1.));
}

vec4 truss(vec2 p, float px, float w, float dist, vec2 s, out vec3 e){
  e=vec3(0);
  float y0=-36.,y1=-24.;
  float a=0.;
  a=max(a,line(abs(p.y-y1),.5,w));
  a=max(a,line(abs(p.y-y0),.7,w));
  float inb=step(y0,p.y)*step(p.y,y1);
  float cxv=fract(p.x/6.); float vv=(p.y-y0)/(y1-y0);
  a=max(a,line(abs(cxv-.5)*6.,.25,w)*inb);
  float dg=(mod(floor(p.x/6.),2.)<1.)?abs(cxv-vv):abs(cxv-(1.-vv));
  a=max(a,line(dg*6.*.7,.18,w)*inb);
  // deck + rail
  a=max(a,line(abs(p.y-(y0+.6)),.35,w));
  a=max(a,line(abs(p.y-(y0+1.6)),.05,w)*.8);
  // piers
  float pier=min(abs(p.x+760.),abs(p.x-140.));
  a=max(a,cov(pier-3.5,w)*step(p.y,y0));
  vec3 c=vec3(.008,.010,.012);
  // walkway lamps
  float lx=(fract(p.x/42.+.5)-.5)*42.;
  vec2 lp=vec2(lx,p.y-(y1-1.6));
  float dpx=length(lp)/px;
  float on=step(.78,h11(floor(p.x/42.+.5)));
  e+=COLD*on*(exp(-dpx*dpx*.4)*.45+exp(-length(lp)*.45)*.04);
  float pool=exp(-lx*lx*.02)*smoothstep(y0-.2,y0+1.5,p.y)*step(p.y,y1-1.6)*.15;
  e+=COLD*pool*.25;
  c+=COLD*.05*exp(-lx*lx*.03)*step(abs(p.y-(y0+.6)),.6);
  // one person on the walkway
  vec2 q=p-vec2(26.4,y0+1.0);
  float body=sdRBox(q-vec2(0.,.62),vec2(.21,.5),.12);
  float head=length(q-vec2(.02,1.48))-.13;
  float legs=sdBox(q-vec2(0.,.2),vec2(.15,.25));
  float fig=min(min(body,head),legs);
  float fa=cov(fig,w);
  a=max(a,fa);
  float f=clamp(1.-exp(-dist*.00045),0.,1.)*.75;
  c=mix(c,fogc(s.y),f);
  e*=1.-f*.6;
  return vec4(c,clamp(a,0.,1.));
}

vec4 pipes(vec2 p, float w, float dist, vec2 s){
  float a=0.; vec3 c=vec3(0);
  const vec3 PIPES[3]=vec3[3](vec3(64.,1.7,0.),vec3(68.6,1.05,1.),vec3(70.9,.55,2.));
  for(int i=0;i<3;i++){
    vec3 P=PIPES[i];
    float dx=p.x-P.x;
    float flng=step(abs(fract((p.y+P.z*3.)/9.)-.5)*9.,.35);
    float r=P.y*(1.+.12*flng);
    float pa=cov(abs(dx)-r,w);
    if(pa>0.){
      float sh=sqrt(max(1.-pow(dx/r,2.),0.));
      float lit=.25+.75*smoothstep(-.6,1.,dx/r);
      float rust=fbm3(vec2(dx*2.,p.y*.4)+P.z*9.);
      vec3 pc=vec3(.014,.016,.018)*(.5+.8*sh)*lit*(.7+.5*rust);
      pc+=COLD*.035*pow(sh,8.)*step(0.,dx);
      c=mix(c,pc,pa); a=max(a,pa);
    }
  }
  // branch towards the facade, high up
  float br=sdBox(p-vec2(40.,21.),vec2(24.,1.1));
  float ba=cov(br,w);
  vec3 bc=vec3(.014,.016,.018)*(.6+.6*smoothstep(-1.1,1.1,p.y-21.));
  c=mix(c,bc,ba*(1.-a)); a=max(a,ba);
  c=mix(c,fogc(s.y),clamp(1.-exp(-dist*.0006),0.,1.));
  return vec4(c,a);
}

vec4 cables(vec2 p, float w, float dist, vec2 s){
  float a=0.;
  const vec4 C[5]=vec4[5](vec4(-5.2,70.,.035,0.),vec4(-4.6,62.,.05,1.),vec4(-4.15,80.,.03,2.),vec4(6.4,55.,.045,3.),vec4(-9.,40.,.06,4.));
  for(int i=0;i<5;i++){
    vec4 k=C[i];
    float x=p.x-3.+k.w*1.3;
    float y=k.x+(x*x)/(2.*k.y)+.03*sin(uTime*.6+k.w)*(1.-min(abs(x)/30.,1.));
    a=max(a,line(abs(p.y-y),k.z,w));
  }
  vec3 c=vec3(.006,.007,.008);
  return vec4(c,clamp(a,0.,1.));
}

/* --------------------------------------- props close to our window */
vec4 sunshade(vec2 p, float w){
  float a=0.;
  if(abs(p.x)<1.2){
    for(int i=0;i<4;i++){
      float y=1.42+.14*float(i);
      a=max(a,cov(sdBox(p-vec2(0.,y),vec2(1.15,.028)),w));
    }
  }
  float br=min(abs(p.x+1.12),abs(p.x-1.12));
  a=max(a,cov(sdBox(vec2(br,p.y-1.62),vec2(.025,.24)),w));
  vec3 c=vec3(.022,.025,.028)+WARM*.04*smoothstep(1.7,1.4,p.y)*uLit;
  return vec4(c,a);
}
vec4 acUnit(vec2 p, float w, out vec3 e){
  e=vec3(0);
  vec2 q=p-vec2(.58,-1.95);
  float box=sdRBox(q,vec2(.42,.33),.02);
  float a=cov(box,w);
  if(a<=0.) return vec4(0);
  vec3 c=vec3(.026,.029,.031)*(.8+.3*fbm3(q*14.));
  // louvres left
  if(q.x<-.06) c*=.7+.3*step(.5,fract(q.y*22.));
  // fan
  vec2 f=q-vec2(.15,0.);
  float r=length(f);
  float grille=line(abs(fract(r*28.)-.5)/28.,.002,w)*step(r,.25);
  float ang=atan(f.y,f.x)+uTime*7.;
  float blade=smoothstep(.2,.6,cos(ang*3.))*step(r,.23)*step(.04,r);
  c=mix(c,vec3(.012),cov(r-.25,w)*.85);
  c=mix(c,vec3(.04,.044,.046),blade*.6);
  c=mix(c,vec3(.08),grille*.6);
  // drip stain below
  c*=1.-.3*smoothstep(-.25,-.33,q.y);
  c+=WARM*.03*smoothstep(-.1,.33,q.y)*uLit;
  return vec4(c,a);
}
vec4 sill(vec2 p, float w){
  vec2 q=p-vec2(0.,-1.42);
  float s=sdBox(q,vec2(1.12,.07));
  float a=cov(s,w);
  vec3 c=vec3(.028,.031,.033)*(.7+.5*fbm3(p*9.));
  c+=WARM*.14*smoothstep(.02,.07,q.y)*uLit;
  // weeds in the crack at the end of the sill
  float wd=1e5;
  for(int i=0;i<7;i++){
    float fi=float(i);
    vec2 b=vec2(-.82+fi*.025,-1.35);
    vec2 t=b+vec2((h11(fi)-.5)*.16,.08+.12*h11(fi+3.));
    t.x+=.008*sin(uTime*1.3+fi);
    wd=min(wd,sdSeg(p,b,t)-.003);
  }
  float wa=cov(wd,w);
  c=mix(c,vec3(.035,.045,.03)+WARM*.06*uLit,wa);
  a=max(a,wa);
  // moss / water stain under the sill
  float st=smoothstep(.0,-.4,q.y+.07)*step(abs(q.x),1.1)*smoothstep(.35,.7,vn(vec2(p.x*12.,p.y*1.5)));
  return vec4(c,max(a,st*.0));
}
vec4 conduit(vec2 p, float w){
  float d=abs(p.x-1.15)-.032;
  float a=cov(d,w);
  float clamp_=step(abs(fract(p.y/1.2)-.5)*1.2,.03);
  a=max(a,cov(abs(p.x-1.15)-.05,w)*clamp_);
  vec3 c=vec3(.022,.025,.028)*(.7+.6*smoothstep(-.03,.03,p.x-1.15));
  return vec4(c,a);
}

/* -------------------------------------------------------- the room */
vec3 lampLight(vec3 P){
  vec3 L=vec3(-.70,-.29,3.5);
  vec3 d=P-L; float r2=dot(d,d);
  float down=.22+.78*smoothstep(.06,-.22,d.y);
  return WARM*(1.5*down/(1.+r2*16.))*uLit+vec3(.0045,.0034,.0026);
}
float monShadow(vec2 p, float w){
  // monitor (depth 3.85) shadow on wall (4.2) from lamp at 3.5
  vec2 L=vec2(-.70,-.29);
  vec2 q=L+(p-L)*(.35/.70);
  return cov(sdBox(q-MON,MONH+.012),w*.5+.07)*.45;
}

vec3 backWall(vec2 p, float w){
  vec3 alb=vec3(.60,.53,.45)*(.9+.12*fbm3(p*7.));
  if(p.y<-1.4){ // floor
    alb=vec3(.20,.15,.11)*(.8+.2*step(.5,fract(p.x*3.)));
    return alb*lampLight(vec3(p.x,-1.4,3.7))*.8;
  }
  // skirting
  alb*=1.-.4*cov(p.y+1.32,w);
  // shelf + books
  float shelf=cov(sdBox(p-vec2(-.75,.415),vec2(.6,.018)),w);
  if(p.x>-1.33&&p.x<-.17&&p.y>.433&&p.y<.75){
    float bw=.043; float id=floor((p.x+1.33)/bw); float fx=fract((p.x+1.33)/bw);
    float hh=.17+.11*h11(id*3.1);
    float gap=step(h11(id+7.),.1);
    float b=cov(p.y-(.433+hh),w)*(1.-gap)*cov(abs(fx-.5)*bw-bw*.46,w);
    float k=h11(id+11.);
    vec3 bc=k<.2?vec3(.33,.10,.07):k<.4?vec3(.48,.38,.20):k<.6?vec3(.17,.19,.22):k<.8?vec3(.58,.53,.43):vec3(.13,.13,.12);
    bc*=1.-.3*line(abs(p.y-(.433+hh*.75)),.004,w);
    alb=mix(alb,bc,b);
  }
  alb=mix(alb,vec3(.22,.14,.08),shelf);
  // the board of index cards
  vec2 bq=p-vec2(.70,.29);
  float board=cov(sdBox(bq,vec2(.33,.31)),w);
  if(board>0.){
    vec3 cork=vec3(.42,.30,.19)*(.8+.3*vn(p*90.));
    alb=mix(alb,cork,board);
    for(int col=0;col<3;col++){
      float cxp=.46+.24*float(col);
      float n=2.+floor(h11(float(col)*5.)*3.);
      for(int r=0;r<5;r++){
        if(float(r)>=n) break;
        vec2 cc=vec2(cxp+(h11(float(col*7+r))-.5)*.02,.52-.11*float(r));
        vec2 lq=rot((h11(float(col*3+r))-.5)*.12)*(p-cc);
        float card=cov(sdBox(lq,vec2(.075,.042)),w);
        vec3 cdc=vec3(.80,.77,.68);
        if(h11(float(col*11+r))<.3) cdc=vec3(.80,.68,.42);
        cdc*=1.-.35*line(abs(fract((lq.y+.03)*55.)-.5)/55.,.0012,w)*step(abs(lq.x),.06)*step(lq.y,.02);
        alb=mix(alb,cdc,card);
        alb=mix(alb,vec3(.6,.1,.08),cov(length(lq-vec2(0.,.03))-.006,w));
      }
    }
  }
  vec3 L=lampLight(vec3(p,4.2));
  L*=1.-.75*monShadow(p,w);
  return alb*L;
}

vec4 rack(vec2 p, float w, out vec3 e){
  e=vec3(0);
  vec2 q=p-vec2(.84,-1.05);
  float a=cov(sdBox(q,vec2(.19,.36)),w);
  if(a<=0.) return vec4(0);
  vec3 c=vec3(.025,.025,.027);
  float u=floor((p.y+1.41)/.142); float fy=fract((p.y+1.41)/.142);
  if(u>=0.&&u<5.){
    float unit=cov(abs(fy-.5)*.142-.062,w)*cov(abs(q.x)-.175,w);
    vec3 uc=vec3(.06,.06,.064);
    uc*=.8+.2*step(.5,fract(p.x*70.))*step(.3,fy)*step(fy,.7)*step(.72,p.x);
    c=mix(c,uc,unit);
    // status led
    vec2 lp=vec2(p.x-.69,(fy-.5)*.142);
    float act;
    if(u==3.) act=.25+.75*smoothstep(.0,1.,sin(uTime*1.25)*.5+.5); // Sleeper breathes
    else act=step(.35,h21(vec2(u,floor(uTime*(5.+u*2.7)))));
    vec3 lc=(u==3.)?vec3(1.,.55,.15):vec3(.35,1.,.55);
    float d=length(lp);
    c=mix(c,lc*act*1.5,cov(d-.0045,w*.5));
    e+=lc*act*exp(-d*d/max(w*w*3.,1e-6))*.25;
    e+=lc*act*.02*exp(-d*40.);
  }
  vec3 Ll=lampLight(vec3(p,4.0));
  return vec4(c*(Ll*1.6+.02),a);
}

vec4 monitor(vec2 p, float w, out vec3 e){
  e=vec3(0);
  vec2 q=p-MON;
  float bez=sdBox(q,MONH+.013);
  float stand=min(sdBox(p-vec2(MON.x,-.565),vec2(.02,.06)),sdRBox(p-vec2(MON.x,-.628),vec2(.09,.008),.006));
  float a=max(cov(bez,w),cov(stand,w));
  if(a<=0.) return vec4(0);
  vec3 c=vec3(.012,.011,.010)*lampLight(vec3(p,3.85))*6.;
  float scr=cov(sdBox(q,MONH),w);
  if(scr>0.){
    vec2 uv=(q+MONH)/(2.*MONH);
    vec3 sc=texture(uScreen,vec2(uv.x,1.-uv.y)).rgb;
    sc=pow(sc,vec3(2.2));
    // cursor at the end of the lede
    float cur=step(abs(uv.x-uCursor.x),.0035)*step(abs(uv.y-uCursor.y),.022)*step(.5,fract(uTime*1.1));
    sc=mix(sc,vec3(.86,.62,.36),cur);
    sc*=uLit*.92+.08;
    c=mix(c,sc*1.15,scr);
    e+=vec3(.9,.7,.5)*.012*scr;
  }
  return vec4(c,a);
}

vec4 desk(vec2 p, float w, out vec3 e){
  e=vec3(0);
  float top=cov(sdBox(p-vec2(-.35,-.65),vec2(.97,.016)),w);
  float legs=cov(sdBox(vec2(min(abs(p.x+1.27),abs(p.x-.57)),p.y+1.03),vec2(.022,.37)),w);
  float a=max(top,legs);
  vec3 L=lampLight(vec3(p,3.6));
  vec3 c=vec3(.30,.22,.15)*L*mix(1.,1.6,step(-.65,p.y));
  // mug
  vec2 mq=p-vec2(-.98,-.59);
  float mug=sdRBox(mq,vec2(.036,.045),.006);
  float handle=abs(length(mq-vec2(-.045,0.))-.022)-.006;
  float ma=cov(min(mug,max(handle,-(mq.x+.035)+.0)),w);
  vec3 mc=vec3(.55,.52,.47)*L*(1.+.5*smoothstep(-.03,.03,mq.x));
  c=mix(c,mc,ma*(1.-top*.0)); a=max(a,ma);
  // steam
  vec2 sq=mq-vec2(0.,.05);
  if(sq.y>0.&&sq.y<.32){
    float sx=sq.x-.02*sin(sq.y*18.-uTime*1.2)-sq.y*.08;
    float n=fbm3(vec2(sx*30.,sq.y*9.-uTime*.5));
    float st=smoothstep(.03,.0,abs(sx))*smoothstep(.45,.75,n)*smoothstep(.32,.02,sq.y);
    e+=WARM*st*.12*uLit;
  }
  // keyboard edge + notebook
  float kb=cov(sdBox(p-vec2(.04,-.630),vec2(.20,.007)),w);
  c=mix(c,vec3(.02)*L*4.,kb); a=max(a,kb);
  float nb=cov(sdBox(p-vec2(-.50,-.631),vec2(.11,.006)),w);
  c=mix(c,vec3(.75,.72,.64)*L,nb); a=max(a,nb);
  return vec4(c,a);
}

vec4 lamp(vec2 p, float w, out vec3 e){
  e=vec3(0);
  float base=sdRBox(p-vec2(-.70,-.627),vec2(.065,.012),.008);
  float a1=sdSeg(p,vec2(-.70,-.62),vec2(-.58,-.38))-.008;
  float a2=sdSeg(p,vec2(-.58,-.38),vec2(-.66,-.215))-.007;
  vec2 sq=rot(.5)*(p-vec2(-.69,-.24));
  float shade=sdBox(sq,vec2(.055+(.03*clamp(-sq.y/.05+.5,0.,1.)),.042));
  float d=min(min(base,a1),min(a2,shade));
  float a=cov(d,w);
  vec3 c=vec3(.03,.026,.022)*(1.+3.*smoothstep(.02,-.04,sq.y)*step(shade,0.));
  c+=WARM*.15*smoothstep(-.2,.0,-abs(p.x+.62))*uLit*step(a1,0.0);
  // bulb
  vec2 bq=p-vec2(-.705,-.29);
  float r2=dot(bq,bq);
  e+=WARM*(exp(-r2/.0004)*7.+exp(-r2/.006)*.6)*uLit;
  return vec4(c,a);
}

float figureSD(vec2 p){
  // seated, back to us, head tipped toward the screen, right hand out on the mouse
  vec2 H=vec2(-.135,-.112);
  vec2 hq=rot(.16)*(p-H);
  float hair=.006*(vn(vec2(atan(hq.y,hq.x)*9.,1.))-.5);
  float head=(length(hq/vec2(.080,.100))-1.)*.080+hair;
  float ear=length(p-vec2(-.212,-.122))-.016;
  head=smin(head,ear,.012);
  float neck=sdBox(p-vec2(-.128,-.222),vec2(.036,.055));
  // hood bunched behind the neck
  float hood=sdRBox(p-vec2(-.132,-.252),vec2(.085,.034),.03);
  float cx=-.12; float x=p.x-cx; float ax=abs(x);
  // right shoulder lifts and leans in toward the mouse
  float lift=.018*smoothstep(.0,.2,x);
  float hw=mix(.17,.222,smoothstep(-.82,-.34,p.y))+.012*step(0.,x);
  float topY=-.262+lift-.09*pow(clamp(ax/.225,0.,1.),2.2);
  float torso=max(ax-hw-.012*step(0.,x),p.y-topY);
  torso=max(torso,-p.y-1.0);
  // arm reaching forward-right
  float arm=sdSeg(p,vec2(.075,-.30),vec2(.165,-.50))-.05;
  float d=smin(head,neck,.02);
  d=smin(d,hood,.025);
  d=smin(d,torso,.03);
  d=smin(d,arm,.03);
  return d;
}
vec4 figure(vec2 p, float w, out vec3 e){
  e=vec3(0);
  float d=figureSD(p);
  float a=cov(d,w);
  if(a<=0.&&d>.08) return vec4(0);
  vec2 ee=vec2(.003,0.);
  vec2 n=normalize(vec2(figureSD(p+ee.xy)-figureSD(p-ee.xy),figureSD(p+ee.yx)-figureSD(p-ee.yx))+1e-6);
  vec3 c=vec3(.016,.014,.013)*(lampLight(vec3(p,3.05))*1.6+.02);
  // fabric folds across the back
  c*=.85+.3*vn(vec2(p.x*30.,p.y*8.));
  float edge=smoothstep(.007,.0,-d);
  vec2 Ld=normalize(vec2(-.70,-.29)-p);
  float rimL=edge*max(dot(n,Ld),0.)*smoothstep(-.2,.0,-(p.x+.0));
  float behind=cov(sdBox(p-MON,MONH),.03);
  float rimM=smoothstep(.004,.0,-d)*behind;
  c+=WARM*rimL*.07*uLit+vec3(.85,.72,.55)*rimM*.03*uLit;
  return vec4(c,a);
}
vec4 chair(vec2 p, float w){
  vec2 q=p-vec2(-.11,-.74);
  float back=sdRBox(q,vec2(.235,.26),.09);
  float post=sdBox(q-vec2(0.,-.40),vec2(.025,.14));
  float d=min(back,post);
  float a=cov(d,w);
  if(a<=0.) return vec4(0);
  float mesh=step(.5,fract(q.x*90.))*step(.5,fract(q.y*90.));
  vec3 c=vec3(.016,.014,.013)*(1.+.25*mesh*step(back,-.02));
  float edge=smoothstep(.02,.0,-back);
  c+=WARM*.06*edge*smoothstep(.0,-.2,q.x)*uLit;
  c*=lampLight(vec3(p,2.8))*2.5;
  return vec4(c,a);
}
vec4 plant(vec2 p, float w){
  float pot=sdRBox(p-vec2(-.77,-1.255),vec2(.10-.02*smoothstep(-1.17,-1.34,p.y),.08),.01);
  float d=pot; float leaves=1e5;
  for(int i=0;i<11;i++){
    float fi=float(i);
    vec2 c=vec2(-.77,-1.10)+vec2((h11(fi*3.)-.5)*.30,(h11(fi*5.)-.4)*.26);
    if(i>7) c=vec2(-.62+.05*fi-.4,-1.20-.06*(fi-7.));
    vec2 q=rot(h11(fi*9.)*6.28+.08*sin(uTime*.7+fi))*(p-c);
    float s=.032+.022*h11(fi*7.);
    q.x=abs(q.x);
    float leaf=(length((q-vec2(s*.35,0.))/vec2(s,s*.7))-1.)*s*.7;
    leaves=min(leaves,leaf);
    leaves=min(leaves,sdSeg(p,vec2(-.77,-1.17),c)-.0025);
  }
  float a=max(cov(pot,w),cov(leaves,w));
  vec3 c=vec3(.26,.11,.06)*.35;
  float lf=cov(leaves,w);
  vec3 lc=mix(vec3(.008,.014,.008),vec3(.05,.07,.02)*uLit,smoothstep(-.006,0.,leaves));
  c=mix(c,lc,lf);
  return vec4(c,a);
}
vec4 blind(vec2 p, float w){
  float a=cov(sdBox(p-vec2(0.,1.12),vec2(1.,.14)),w);
  float bar=line(abs(p.y-.985),.008,w)*step(abs(p.x),1.);
  float cord=line(abs(p.x-.86),.0016,w)*step(.42,p.y)*step(p.y,.98);
  float bead=cov(length(p-vec2(.86,.42))-.007,w);
  vec3 c=WARM*.11*uLit*(.85+.15*vn(p*vec2(400.,40.)))*(.7+.3*smoothstep(.98,1.25,p.y));
  c=mix(c,vec3(.02),max(bar,max(cord,bead)));
  return vec4(c,max(a,max(bar,max(cord,bead))));
}

vec3 interior(vec2 s, float extraBlur){
  float dist,px,w; vec2 p; vec3 e; vec4 l;
  p=proj(s,DF+4.2,dist,px,w); w+=extraBlur;
  vec3 c=backWall(p,w);
  p=proj(s,DF+4.0,dist,px,w); w+=extraBlur;
  l=rack(p,w,e); c=mix(c,l.rgb,l.a)+e;
  p=proj(s,DF+3.85,dist,px,w); w+=extraBlur;
  l=monitor(p,w,e); c=mix(c,l.rgb,l.a)+e;
  p=proj(s,DF+3.6,dist,px,w); w+=extraBlur;
  l=desk(p,w,e); c=mix(c,l.rgb,l.a)+e;
  p=proj(s,DF+3.5,dist,px,w); w+=extraBlur;
  l=lamp(p,w,e); c=mix(c,l.rgb,l.a)+e;
  p=proj(s,DF+3.05,dist,px,w); w+=extraBlur;
  if(dist>.004){ l=figure(p,w,e); c=mix(c,l.rgb,l.a*nearFade(dist,.004,.05))+e; }
  p=proj(s,DF+2.8,dist,px,w); w+=extraBlur;
  if(dist>.004){ l=chair(p,w); c=mix(c,l.rgb,l.a*nearFade(dist,.004,.05)); }
  p=proj(s,DF+.18,dist,px,w); w+=extraBlur;
  if(dist>.004){ l=plant(p,w); c=mix(c,l.rgb,l.a*nearFade(dist,.004,.04)); }
  p=proj(s,DF+.12,dist,px,w); w+=extraBlur;
  if(dist>.004){ l=blind(p,w); c=mix(c,l.rgb,l.a*nearFade(dist,.004,.04)); }
  return c;
}

/* ----------------------------------------------------- the glass */
vec4 glass(vec2 p, float w, float dist, vec2 s, out vec2 sOff, out float blurAdd, out vec3 e){
  e=vec3(0); sOff=vec2(0); blurAdd=0.;
  float k=uF/dist;
  // sliding drops and their trails
  float colW=.07;
  float ci=floor(p.x/colW); float cx=fract(p.x/colW)-.5;
  float sp=.04+.06*h11(ci*3.7);
  float yy=1.3-mod(uTime*sp+h11(ci)*9.,3.2);
  float trail=step(h11(ci*1.3),.45)*smoothstep(.12,.0,abs(cx))*step(yy,p.y)*smoothstep(yy+1.2,yy,p.y);
  float clear=trail;
  // static drops at two scales
  float dropAmt=0.;
  for(int j=0;j<2;j++){
    float sc=j==0?40.:15.;
    vec2 q=p*sc+float(j)*7.3; vec2 id=floor(q); vec2 f=fract(q)-.5;
    vec2 r=h22(id);
    if(r.x<(j==0?.42:.16)){
      vec2 c=(r-.5)*.5;
      float rad=(.07+.17*h11(id.x*3.+id.y))*(j==0?1.:1.3);
      float d=length(f-c)/rad;
      if(d<1.){
        vec2 n=(f-c)/rad;
        float dm=smoothstep(1.,.8,d);
        dropAmt=max(dropAmt,dm);
        sOff=-(f-c)/sc*k*1.3*dm;
        e+=COLD*.22*smoothstep(.22,.0,length(n-vec2(-.38,.48)))*dm;
        e+=WARM*.035*smoothstep(.7,1.,d)*dm*uLit;
      }
    }
  }
  // running drop heads
  vec2 hq=vec2(cx*colW,p.y-yy);
  float head=length(hq/vec2(1.,1.3))-.009;
  float hm=cov(head,w)*step(h11(ci*1.3),.45);
  if(hm>0.){ sOff=-hq*k*2.*hm; dropAmt=max(dropAmt,hm); e+=COLD*.25*hm*smoothstep(.005,0.,length(hq-vec2(-.003,.004))); }
  float grime=smoothstep(.35,.85,fbm(p*3.)*.6+fbm(p*vec2(26.,2.2))*.4);
  grime=grime*(1.-clear*.8)*(1.-dropAmt);
  // condensation creeping up from the sill, wiped clear in places by the running drops
  float cond=smoothstep(-.55,-1.32,p.y+.18*fbm(p*2.2))*(.55+.45*fbm(p*9.));
  cond*=1.-clear;
  blurAdd=cond*.05+grime*.006;
  float alpha=.04+.14*grime+.42*cond;
  vec3 refl=vec3(.020,.025,.030)*(1.2+s.y*.6);
  vec3 gc=refl*.5+WARM*.05*grime*uLit+vec3(.075,.056,.042)*cond*uLit;
  return vec4(gc,clamp(alpha,0.,.9));
}

/* -------------------------------------------------------- rain */
vec3 rain(vec2 s, float glow){
  vec3 r=vec3(0);
  for(int i=0;i<3;i++){
    float fi=float(i);
    float sc=14.+fi*16.;
    vec2 q=vec2(s.x*sc+s.y*sc*.12,s.y*sc*.16+uTime*(2.4+fi*.9));
    vec2 id=floor(q); vec2 f=fract(q);
    float h=h21(id+fi*31.);
    float on=step(h,.10);
    float x=.2+.6*h21(id+fi*7.);
    float st=smoothstep(.022,.0,abs(f.x-x))*smoothstep(.0,.3,f.y)*smoothstep(1.,.75,f.y);
    r+=on*st*(.008+.009*fi)*(1.+glow*10.)*mix(COLD,WARM,clamp(glow*1.6,0.,1.));
  }
  return r;
}

void main(){
  PXS=2.0/uRes.y;
  vec2 s=(gl_FragCoord.xy-.5*uRes)*PXS;
  vec3 col;
  bool outside=uCam.z<DF-.002;
  vec3 e; vec4 l; float dist,px,w;

  if(!outside){
    col=interior(s,0.);
  } else {
    vec2 pF=proj(s,DF,dist,px,w);
    float dF=dist, pxF=px, wF=w;
    vec3 eF; float ap;
    vec4 fac=facade(pF,pxF,wF,dF,s,eF,ap);
    col=vec3(0);
    if(fac.a<.999){
      col=sky(s);
      l=farLayer(s,9000.,520.,7.,-100.,520.,.00011,e); col=mix(col,l.rgb,l.a)+e;
      l=farLayer(s,5200.,300.,3.,-120.,420.,.00016,e); col=mix(col,l.rgb,l.a)+e;
      float pd; l=plume(s,2600.,vec2(-260.,330.),40.,pd); col=mix(col,l.rgb,l.a);
      l=farLayer(s,2600.,170.,5.,-140.,330.,.00024,e); col=mix(col,l.rgb,l.a)+e;
      l=farLayer(s,1650.,110.,9.,-160.,180.,.00032,e); col=mix(col,l.rgb,l.a)+e;
    }
    if(ap>0.){
      vec2 sOff; float blurAdd; vec3 ge;
      vec4 g=glass(pF,wF,dF,s,sOff,blurAdd,ge);
      // the right pane is tilted open: no drops, and a warm seam along its top
      float openPane=step(.445,pF.x);
      vec3 inside=interior(s+sOff*(1.-openPane)+vec2(0.,-.002)*openPane*uF/dF,blurAdd*(1.-openPane));
      vec3 gcol=inside*(1.-g.a)+g.rgb+ge*(1.-openPane*.7);
      float seam=openPane*smoothstep(.04,.0,abs(pF.y-1.19))*step(pF.x,.975);
      gcol+=WARM*seam*.6*uLit;
      col=mix(col,gcol,ap);
    }
    col=mix(col,fac.rgb,fac.a)+eF;

    // things between us and the facade, far to near
    float d2;
    if(uCam.z<DF-.05){
      vec2 p2;
      p2=proj(s,DF-.06,dist,px,w); if(dist>0.&&px<.05){ l=conduit(p2,w); col=mix(col,l.rgb,l.a*nearFade(dist,.0,.03)); }
      p2=proj(s,DF-.12,dist,px,w); if(dist>0.&&px<.05){ l=sill(p2,w); col=mix(col,l.rgb,l.a*nearFade(dist,.0,.03)); }
      p2=proj(s,DF-.35,dist,px,w); if(dist>0.&&px<.05){ l=acUnit(p2,w,e); col=mix(col,l.rgb,l.a*nearFade(dist,.0,.05))+e; }
      p2=proj(s,DF-.45,dist,px,w); if(dist>0.&&px<.05){ l=sunshade(p2,w); col=mix(col,l.rgb,l.a*nearFade(dist,.0,.05)); }
    }
    vec2 p3;
    p3=proj(s,DF-40.,dist,px,w); if(dist>.1){ l=cloudDeck(p3,w,s); col=mix(col,l.rgb,l.a*nearFade(dist,1.,30.)); }
    p3=proj(s,DF-22.,dist,px,w); if(dist>.05){ l=cables(p3,w,dist,s); col=mix(col,l.rgb,l.a*nearFade(dist,.05,.6)); }
    p3=proj(s,DF-70.,dist,px,w); if(dist>.1){ l=pipes(p3,w,dist,s); col=mix(col,l.rgb,l.a*nearFade(dist,.1,2.)); }
    p3=proj(s,DF-200.,dist,px,w); if(dist>.2){ l=truss(p3,px,w,dist,s,e); col=mix(col,l.rgb,l.a*nearFade(dist,.2,4.))+e; }
    p3=proj(s,DF-600.,dist,px,w); if(dist>.5){ l=pylon(p3,w,dist,s); col=mix(col,l.rgb,l.a*nearFade(dist,.5,10.)); }

    // rain, warmed where it passes our light
    vec2 pr=proj(s,DF-1.5,dist,px,w);
    float glow=exp(-pow(length(pr-vec2(0.,-.05))/max(1.6,dist*.015),1.6))*uLit;
    col+=rain(s,glow)*uRain;
  }
  o=vec4(col,1.);
}`;

const BRIGHT = `#version 300 es
precision highp float;
out vec4 o; uniform sampler2D uTex; uniform vec2 uTexel;
void main(){
  vec2 uv=gl_FragCoord.xy*uTexel;
  vec3 c=vec3(0);
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++) c+=texture(uTex,uv+vec2(x,y)*uTexel*.5).rgb;
  c/=9.;
  float l=max(c.r,max(c.g,c.b));
  float k=smoothstep(.12,1.2,l);
  o=vec4(c*k,1.);
}`;

const BLUR = `#version 300 es
precision highp float;
out vec4 o; uniform sampler2D uTex; uniform vec2 uDir; uniform vec2 uTexel;
void main(){
  vec2 uv=gl_FragCoord.xy*uTexel;
  const float W[7]=float[7](.1964,.1748,.1216,.0656,.0274,.0088,.0022);
  vec3 c=texture(uTex,uv).rgb*W[0];
  for(int i=1;i<7;i++){ vec2 o2=uDir*float(i)*uTexel; c+=(texture(uTex,uv+o2).rgb+texture(uTex,uv-o2).rgb)*W[i]; }
  o=vec4(c,1.);
}`;

const COMP = `#version 300 es
precision highp float;
out vec4 o;
uniform sampler2D uScene, uBloomA, uBloomB;
uniform vec2 uRes; uniform float uTime, uExposure, uFade;
float h(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  vec2 cc=uv-.5;
  float r2=dot(cc,cc);
  vec2 ca=cc*r2*.004;
  vec3 c;
  c.r=texture(uScene,uv-ca).r;
  c.g=texture(uScene,uv).g;
  c.b=texture(uScene,uv+ca).b;
  vec3 b=texture(uBloomA,uv).rgb*.9+texture(uBloomB,uv).rgb*.7;
  c+=b;
  c*=uExposure;
  c=aces(c);
  c*=1.-smoothstep(.15,.85,r2*1.7)*.55;
  c=pow(c,vec3(1./2.2));
  float g=h(gl_FragCoord.xy+fract(uTime*7.31)*1000.)-.5;
  c+=g*.045*(1.-c*.6);
  c=mix(c,vec3(.0706,.051,.0353),uFade);
  o=vec4(c,1.);
}`;

/* ------------------------------------------------------------ GL plumbing */

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    console.error(log);
    (window.__errs ||= []).push(log);
    throw new Error('shader');
  }
  return s;
}
const vs = compile(gl.VERTEX_SHADER, VERT);
function program(fsrc) {
  const p = gl.createProgram();
  gl.attachShader(p, vs); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

let progScene, progBright, progBlur, progComp;
try {
  progScene = program(SCENE);
  progBright = program(BRIGHT);
  progBlur = program(BLUR);
  progComp = program(COMP);
} catch (err) {
  console.error(err);
  document.documentElement.classList.add('nogl');
  return;
}

const halfFloat = !!gl.getExtension('EXT_color_buffer_float');
gl.getExtension('OES_texture_float_linear');

function makeTarget(w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, halfFloat ? gl.RGBA16F : gl.RGBA8, w, h, 0, gl.RGBA, halfFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return { tex, fb, w, h };
}
function freeTarget(t) { if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); } }

/* the name painted on the crown of the building */
const nameTex = gl.createTexture();
function paintName(family) {
  const c = document.createElement('canvas');
  c.width = 4096; c.height = 80;
  const x = c.getContext('2d');
  x.fillStyle = '#fff';
  x.textBaseline = 'middle';
  x.font = `800 76px ${family}`;
  const word = 'BROKENTOOTH';
  // track the letters out to fill the band, like a painted industrial marking
  const widths = [...word].map((ch) => x.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0);
  const gap = (c.width - 40 - total) / (word.length - 1);
  let px = 20;
  [...word].forEach((ch, i) => { x.fillText(ch, px, 43); px += widths[i] + gap; });
  gl.bindTexture(gl.TEXTURE_2D, nameTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}
paintName('"Arial Narrow", sans-serif');
const stencil = '"Big Shoulders Stencil Display"';
Promise.race([
  document.fonts.load(`800 150px ${stencil}`),
  new Promise((r) => setTimeout(r, 2500)),
]).then(() => { if (document.fonts.check(`800 150px ${stencil}`)) { paintName(stencil); needsFrame = true; } });

/* the screen on the desk: the page itself, night mode */
const screenTex = gl.createTexture();
const cursor = [0.5, 0.5];
function paintScreen() {
  const c = document.createElement('canvas');
  c.width = 1600; c.height = 938;
  const x = c.getContext('2d');
  x.fillStyle = '#120d09'; x.fillRect(0, 0, c.width, c.height);
  const L = c.width * 0.085;
  x.textBaseline = 'alphabetic';
  x.fillStyle = '#f2c48c';
  x.font = `300 ${c.width * 0.026}px Literata, Georgia, serif`;
  const lede = ['You\u2019re at my desk. It\u2019s late;', 'it usually is. Everything below', 'was written here.'];
  let y = c.height * 0.33;
  const lh = c.width * 0.026 * 1.3;
  lede.forEach((ln) => { x.fillText(ln, L, y); y += lh; });
  const lastW = x.measureText(lede[lede.length - 1]).width;
  cursor[0] = (L + lastW + c.width * 0.008) / c.width;
  cursor[1] = 1 - (y - lh - c.width * 0.008) / c.height;
  x.fillStyle = '#a8977d';
  x.font = `700 ${c.width * 0.0135}px "Big Shoulders Text", sans-serif`;
  y = c.height * 0.72;
  x.fillText('Writing', L, y);
  x.fillStyle = '#eadcc4';
  x.font = `450 ${c.width * 0.0165}px Literata, Georgia, serif`;
  x.fillText('Memory is a lookup tool, not a boss', L, y + c.width * 0.03);
  x.fillStyle = '#a8977d';
  x.font = `400 ${c.width * 0.0118}px Literata, Georgia, serif`;
  x.fillText('On giving coding agents a shared past without letting it give the orders.', L, y + c.width * 0.048);
  gl.bindTexture(gl.TEXTURE_2D, screenTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  needsFrame = true;
}
paintScreen();
Promise.race([
  Promise.all([document.fonts.load('300 40px Literata'), document.fonts.load('450 40px Literata'), document.fonts.load('700 20px "Big Shoulders Text"')]),
  new Promise((r) => setTimeout(r, 2500)),
]).then(paintScreen);

/* ------------------------------------------------------------- sizing */

const isSmall = () => Math.min(innerWidth, innerHeight) < 600;
let scale = isSmall() ? 0.75 : 1.0;          // adaptive render scale
let W = 0, H = 0, sceneT, bloomA, bloomB, bloomC, bloomD;

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, isSmall() ? 1.5 : 1.25);
  const cw = Math.max(2, Math.round(canvas.clientWidth * dpr));
  const ch = Math.max(2, Math.round(canvas.clientHeight * dpr));
  canvas.width = cw; canvas.height = ch;
  const w = Math.max(2, Math.round(cw * scale)), h = Math.max(2, Math.round(ch * scale));
  if (w === W && h === H && sceneT) return;
  W = w; H = h;
  [sceneT, bloomA, bloomB, bloomC, bloomD].forEach(freeTarget);
  sceneT = makeTarget(W, H);
  const bw = Math.max(2, W >> 2), bh = Math.max(2, H >> 2);
  bloomA = makeTarget(bw, bh);
  bloomB = makeTarget(bw, bh);
  bloomC = makeTarget(Math.max(2, bw >> 1), Math.max(2, bh >> 1));
  bloomD = makeTarget(Math.max(2, bw >> 1), Math.max(2, bh >> 1));
  needsFrame = true;
}
addEventListener('resize', resize);

/* ------------------------------------------------------------- camera */

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// progress -> distance to the screen. Time is spent where the story is:
// the first sight of the window, the glass, the shoulder.
const KEYS = [[0, MON_D], [0.10, 330], [0.26, 70], [0.40, 18], [0.52, 8.5], [0.62, 5.4], [0.70, 3.7], [0.80, 1.5], [0.91, 0.55], [1, 0.256]];
const KX = KEYS.map((k) => k[0]);
let KY, KM, keyAspect = -1;
// narrow screens start further out so the whole structure and its sky still fit
function buildKeys(aspect) {
  keyAspect = aspect;
  const start = MON_D * Math.pow(Math.max(1, 1.45 / aspect), 0.85);
  KY = KEYS.map((k, i) => Math.log(i === 0 ? start : i === 1 ? k[1] * Math.sqrt(start / MON_D) : k[1]));
  KM = tangents();
}
function tangents() {   // Fritsch-Carlson monotone tangents
  const n = KX.length, d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((KY[i + 1] - KY[i]) / (KX[i + 1] - KX[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return m;
}
function logDist(t) {
  t = Math.min(1, Math.max(0, t));
  let i = 0; while (i < KX.length - 2 && t > KX[i + 1]) i++;
  const h = KX[i + 1] - KX[i], u = (t - KX[i]) / h;
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * KY[i] + (u3 - 2 * u2 + u) * h * KM[i] + (-2 * u3 + 3 * u2) * KY[i + 1] + (u3 - u2) * h * KM[i + 1];
}

function camera(t, aspect, ptr) {
  if (Math.abs(aspect - keyAspect) > 1e-3) buildKeys(aspect);
  const d0 = Math.exp(KY[0]);
  // landscape: the screen fills the view; portrait: the whole screen fits across it
  // landscape: the screen fills the view. portrait: stop just past the shoulder, framed on the text
  const fill = aspect >= 1.2 ? Math.min(0.17, 0.29 / aspect) * 0.94 * F : 0.72;
  let dist = Math.exp(logDist(t));
  // the last stretch eases onto the screen; on portrait it starts earlier so the camera never backs out
  const t0 = fill > 0.5 ? 0.80 : 0.91, d1 = Math.exp(logDist(t0));
  if (t > t0) dist = Math.exp(Math.log(d1) + (Math.log(fill) - Math.log(d1)) * smooth(t0, 1, t));
  const g = 1 - smooth(0.02, 0.5, t);
  // opening composition: the lit window sits right of centre, a little low
  const sx = aspect > 1 ? 0.5 * aspect : 0.16 * aspect;
  const sy = aspect > 1 ? -0.36 : -0.38;
  const offX = -sx * d0 / F, offY = -sy * d0 / F;
  const pAmt = 0.035 * (1 - smooth(0.9, 1.0, t));
  // slip past the right shoulder rather than through the head
  // rise over the right shoulder, then settle onto the screen
  const over = Math.sin(Math.PI * smooth(0.70, 0.99, t));
  const slip = over * (aspect < 1 ? 0.10 : 0.05);
  const halfW = fill / F * aspect;
  const endX = aspect >= 1.2 ? 0 : (-0.29 + halfW + 0.01) * smooth(0.85, 1, t);
  const x = MON[0] + offX * (dist / d0) * g + ptr.x * dist * pAmt + slip + endX;
  const y = MON[1] + offY * (dist / d0) * g + ptr.y * dist * pAmt * 0.6 + over * 0.13;
  const z = MON_D - dist;  // negative on narrow screens at the very start
  const dGlass = DF - z, dMon = MON_D - z;
  let focus;
  if (dGlass > 0) focus = dMon + (dGlass - dMon) * smooth(0.6, 1.6, dGlass);
  else focus = dMon;
  return { x, y, z, focus, dist, dGlass };
}

function project(cam, wx, wy, depth) {
  const d = depth - cam.z;
  if (d <= 0) return null;
  const sx = (wx - cam.x) * F / d, sy = (wy - cam.y) * F / d;
  const hh = innerHeight / 2;
  return { x: innerWidth / 2 + sx * hh, y: hh - sy * hh };
}

/* ------------------------------------------------------------- scroll */

const descent = document.getElementById('descent');
const pin = document.getElementById('pin');
const pinLine = document.querySelector('#pinLine line');
const beats = [...document.querySelectorAll('.beat')];
const hint = document.getElementById('hint');
const range = document.getElementById('range');
const rangeNum = document.getElementById('rangeNum');
const desk = document.getElementById('desk');

function progress() {
  if (STILL_T !== null) return STILL_T;
  const span = descent.offsetHeight - innerHeight;
  return Math.min(1, Math.max(0, scrollY / span));
}

const ptr = { x: 0, y: 0, tx: 0, ty: 0 };
addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  ptr.tx = (e.clientX / innerWidth - 0.5) * 2;
  ptr.ty = -(e.clientY / innerHeight - 0.5) * 2;
});

document.getElementById('leave').addEventListener('click', (e) => {
  e.preventDefault();
  scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
});

function fmtDist(m) {
  if (m >= 10) return Math.round(m).toLocaleString('en-GB') + ' m';
  if (m >= 1) return m.toFixed(1) + ' m';
  return Math.round(m * 100) + ' cm';
}

/* ------------------------------------------------------------- loop */

let tS = progress();
let drawnT = -1;
let last = performance.now();
let clock = STILL_TIME ?? 0;
let frameMs = 16, sampleN = 0, sampleSum = 0;

function draw(time, t, cam) {
  const aspect = W / H;
  // scene
  gl.bindFramebuffer(gl.FRAMEBUFFER, sceneT.fb);
  gl.viewport(0, 0, W, H);
  gl.useProgram(progScene.p);
  const u = progScene.u;
  gl.uniform2f(u.uRes, W, H);
  gl.uniform3f(u.uCam, cam.x, cam.y, cam.z);
  gl.uniform1f(u.uF, F);
  gl.uniform1f(u.uTime, time);
  gl.uniform1f(u.uFocus, cam.focus);
  gl.uniform1f(u.uAp, 5.0 * H / 900);
  gl.uniform1f(u.uRain, (1.0 - smooth(-1.2, -0.2, -cam.dGlass)) * (0.3 + 0.7 * smooth(0.12, 0.42, t)));
  gl.uniform1f(u.uLit, 1.0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, nameTex);
  gl.uniform1i(u.uName, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, screenTex);
  gl.uniform1i(u.uScreen, 1);
  gl.uniform2f(u.uCursor, cursor[0], cursor[1]);
  gl.activeTexture(gl.TEXTURE0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  // bloom
  gl.useProgram(progBright.p);
  gl.bindFramebuffer(gl.FRAMEBUFFER, bloomA.fb);
  gl.viewport(0, 0, bloomA.w, bloomA.h);
  gl.bindTexture(gl.TEXTURE_2D, sceneT.tex);
  gl.uniform1i(progBright.u.uTex, 0);
  gl.uniform2f(progBright.u.uTexel, 1 / bloomA.w, 1 / bloomA.h);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  gl.useProgram(progBlur.p);
  gl.uniform1i(progBlur.u.uTex, 0);
  const pass = (src, dst, dx, dy) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
    gl.viewport(0, 0, dst.w, dst.h);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform2f(progBlur.u.uTexel, 1 / dst.w, 1 / dst.h);
    gl.uniform2f(progBlur.u.uDir, dx, dy);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  pass(bloomA, bloomB, 1.4, 0);
  pass(bloomB, bloomA, 0, 1.4);
  pass(bloomA, bloomC, 2.5, 0);   // wide halo at half the bloom resolution
  pass(bloomC, bloomD, 0, 2.5);

  // composite
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(progComp.p);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sceneT.tex);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, bloomA.tex);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, bloomD.tex);
  gl.uniform1i(progComp.u.uScene, 0);
  gl.uniform1i(progComp.u.uBloomA, 1);
  gl.uniform1i(progComp.u.uBloomB, 2);
  gl.uniform2f(progComp.u.uRes, canvas.width, canvas.height);
  gl.uniform1f(progComp.u.uTime, time);
  gl.uniform1f(progComp.u.uExposure, 1.55);
  gl.uniform1f(progComp.u.uFade, smooth(0.965, 1.0, t));
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.activeTexture(gl.TEXTURE0);
}

function updateOverlay(t, cam) {
  // the pin: one sentence attached to one lit window
  const pinA = 1 - smooth(0.05, 0.11, t);
  const at = project(cam, 0, -0.05, DF);
  if (at && pinA > 0.001) {
    const lx = at.x + Math.min(90, innerWidth * 0.08), ly = at.y - Math.min(110, innerHeight * 0.13);
    pin.style.opacity = pinA;
    pin.style.transform = `translate(${lx + 8}px, ${ly - 22}px)`;
    pinLine.setAttribute('x1', at.x + 5); pinLine.setAttribute('y1', at.y - 5);
    pinLine.setAttribute('x2', lx); pinLine.setAttribute('y2', ly);
    pinLine.parentNode.style.opacity = pinA;
  } else {
    pin.style.opacity = 0;
    pinLine.parentNode.style.opacity = 0;
  }
  for (const b of beats) {
    const a = +b.dataset.in, z = +b.dataset.out;
    const fadeIn = smooth(a, a + 0.04, t), fadeOut = 1 - smooth(z - 0.04, z, t);
    const v = Math.min(fadeIn, fadeOut);
    const local = (t - a) / (z - a);
    b.style.opacity = v;
    b.style.transform = `translate3d(0, ${(0.5 - local) * 24}px, 0) scale(${0.98 + local * 0.04})`;
    b.style.filter = v < 0.999 ? `blur(${(1 - v) * 6}px)` : 'none';
  }
  hint.style.opacity = 1 - smooth(0.0, 0.03, t);
  const deskA = smooth(0.965, 1.0, t);
  desk.style.opacity = scrollY > descent.offsetHeight - innerHeight + 4 ? 1 : deskA;
  desk.style.visibility = desk.style.opacity > 0.001 ? 'visible' : 'hidden';
  range.style.opacity = 1 - smooth(0.95, 0.985, t);
  rangeNum.textContent = fmtDist(cam.dist);
}

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (STILL_TIME === null && !reduceMotion) clock += dt;
  const target = progress();
  const k = STILL_T !== null ? 1 : 1 - Math.exp(-dt * 4.5);
  tS += (target - tS) * k;
  if (Math.abs(target - tS) < 1e-5) tS = target;
  ptr.x += (ptr.tx - ptr.x) * (1 - Math.exp(-dt * 2.5));
  ptr.y += (ptr.ty - ptr.y) * (1 - Math.exp(-dt * 2.5));

  // park the renderer once the page has fully covered it, but only after the final frame is drawn
  const covered = scrollY > descent.offsetHeight + innerHeight * 0.4;
  const offscreen = covered && drawnT === tS;
  const aspect = (canvas.clientWidth || 1) / (canvas.clientHeight || 1);
  const cam = camera(tS, aspect, reduceMotion ? { x: 0, y: 0 } : ptr);
  updateOverlay(tS, cam);
  if (!offscreen && (needsFrame || !reduceMotion || Math.abs(target - tS) > 0)) {
    const t0 = performance.now();
    draw(clock, tS, cam);
    drawnT = tS;
    needsFrame = false;
    window.__ready = true;
    // adaptive resolution: hold ~45fps on whatever this is
    sampleSum += dt * 1000; sampleN++;
    if (sampleN >= 30 && STILL_T === null) {
      frameMs = sampleSum / sampleN; sampleSum = 0; sampleN = 0;
      const next = frameMs > 24 ? Math.max(0.5, scale - 0.1) : frameMs < 15 && scale < 1 ? Math.min(1, scale + 0.05) : scale;
      if (next !== scale) { scale = next; resize(); }
    }
  }
  requestAnimationFrame(frame);
}

resize();
if (STILL_T !== null && params.has('scroll')) scrollTo(0, STILL_T * (descent.offsetHeight - innerHeight));
requestAnimationFrame(frame);
})();
