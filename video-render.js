import { drawOverlays } from './overlay-render.js';
export function framePlan(settings,frames) {
  if(settings.fps===0&&frames?.length){
    const boundaries=['top','bottom','sticker'].filter(key=>key==='sticker'?settings.overlays?.sticker?.value:settings[key]?.trim()).flatMap(key=>[settings.overlays?.[key]?.start,settings.overlays?.[key]?.end]).filter(Number.isFinite);
    let parts=frames.flatMap(f=>{const start=Math.max(settings.start,f.start),end=Math.min(settings.end,f.start+f.delay);if(end-start<=.00001)return[];const cuts=[...new Set([start,...boundaries.filter(t=>t>start&&t<end),end])].sort((a,b)=>a-b);return cuts.slice(0,-1).map((time,i)=>({time,delay:(cuts[i+1]-time)/settings.speed}));});
    if(settings.playback==='reverse')parts.reverse();else if(settings.playback==='pingpong')parts.push(...parts.slice(1,-1).reverse());
    const duration=parts.reduce((n,f)=>n+f.delay,0);
    return {times:parts.map(f=>f.time),delays:parts.map(f=>f.delay),delay:duration/Math.max(1,parts.length),duration};
  }

  const length = settings.end-settings.start, count = Math.max(1,Math.ceil(length/settings.speed*settings.fps-1e-7));
  const times=Array.from({length:count},(_,i)=>settings.start+i*length/count);
  if(settings.playback==='reverse')times.reverse();
  else if(settings.playback==='pingpong')times.push(...times.slice(1,-1).reverse());
  const delay=length/settings.speed/count;
  return {times,delay,duration:times.length*delay};
}
export function gifFramePlan(plan) {
  // GIF stores centiseconds. Merge sub-20ms frames to avoid browser delay clamping,
  // and round cumulative boundaries so speed changes do not accumulate drift.
  const times=[],ticks=[];let elapsed=0,emitted=0,pending=plan.times[0];
  for(let i=0;i<plan.times.length;i++){
    elapsed+=plan.delays?.[i]??plan.delay;
    const boundary=Math.round(elapsed*100+1e-7),duration=boundary-emitted;
    if(duration>=2){times.push(pending);ticks.push(duration);emitted=boundary;pending=plan.times[i+1];}
  }
  const remainder=Math.round(elapsed*100+1e-7)-emitted;
  if(!times.length){times.push(plan.times[0]);ticks.push(Math.max(2,remainder));}
  else if(remainder>0)ticks[ticks.length-1]+=remainder;
  const duration=ticks.reduce((sum,value)=>sum+value,0)/100;
  return {times,delays:ticks.map(value=>value/100),delay:duration/times.length,duration};
}
export function cropGeometry(width,height,s) {
  const ratio=s.aspect==='original'?width/height:s.aspect.split(':').reduce((a,b)=>Number(a)/Number(b));
  let cw=width,ch=width/ratio;if(ch>height){ch=height;cw=height*ratio;}
  cw/=s.zoom;ch/=s.zoom;
  const x=(width-cw)*(s.panX+1)/2,y=(height-ch)*(s.panY+1)/2;
  const scale=Math.min(1,s.edge/Math.max(cw,ch));
  return {x,y,cw,ch,width:Math.max(2,Math.floor((cw*scale+1e-7)/2)*2),height:Math.max(2,Math.floor((ch*scale+1e-7)/2)*2)};
}
export function renderVideoFrame(canvas,video,s) {
  const g=cropGeometry(video.videoWidth,video.videoHeight,s);
  if(canvas.width!==g.width)canvas.width=g.width;if(canvas.height!==g.height)canvas.height=g.height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.fillStyle='#061426';ctx.fillRect(0,0,g.width,g.height);
  ctx.drawImage(video.drawable||video,g.x,g.y,g.cw,g.ch,0,0,g.width,g.height);
  drawOverlays(ctx,g.width,g.height,s,video.currentTime||0);
  return g;
}
