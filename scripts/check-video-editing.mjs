import assert from 'node:assert/strict';
import {framePlan,gifFramePlan,cropGeometry} from '../video-render.js';
const base={start:2,end:4,fps:10,speed:1,playback:'forward',aspect:'original',zoom:1,panX:0,panY:0,edge:720};
const forward=framePlan(base),reverse=framePlan({...base,playback:'reverse'}),slow=framePlan({...base,speed:.5}),ping=framePlan({...base,speed:.5,playback:'pingpong'});
assert.deepEqual(reverse.times,[...forward.times].reverse());assert.equal(forward.duration,2);assert.equal(slow.duration,4);assert.equal(ping.times.length,78);assert.equal(ping.duration,7.800000000000001);assert.ok(ping.times[39]>ping.times[40]);assert.ok(ping.times.every(t=>t>=2&&t<4));
for(const aspect of ['original','1:1','4:5','9:16','16:9'])for(const zoom of [1,1.5,3])for(const panX of [-1,0,1])for(const panY of [-1,0,1]){const g=cropGeometry(1920,1080,{...base,aspect,zoom,panX,panY});assert.ok(g.x>=0&&g.y>=0&&g.x+g.cw<=1920+.001&&g.y+g.ch<=1080+.001);assert.equal(g.width%2,0);assert.equal(g.height%2,0);assert.ok(Math.max(g.width,g.height)<=720);}
assert.equal(cropGeometry(1920,1080,{...base,aspect:'1:1'}).width,720);assert.equal(cropGeometry(1280,720,{...base,zoom:1.05}).width,720);
console.log('PASS: frame order, speed, seamless ping-pong, crop bounds, pan, zoom, even MP4 dimensions.');

const variable=[{start:0,delay:.1},{start:.1,delay:.3},{start:.4,delay:.2}];
const timing=framePlan({...base,start:.05,end:.5,fps:0},variable);
assert.deepEqual(timing.times,[.05,.1,.4]);assert.ok(Math.abs(timing.duration-.45)<1e-9);assert.deepEqual(timing.delays.map(x=>Math.round(x*100)),[5,30,10]);
const reverseTiming=framePlan({...base,start:.05,end:.5,fps:0,playback:'reverse',speed:.5},variable);
assert.deepEqual(reverseTiming.times,[.4,.1,.05]);assert.deepEqual(reverseTiming.delays.map(x=>Math.round(x*100)),[20,60,10]);
console.log('PASS: variable GIF delays survive trims, reverse, and speed changes.');

const timed=framePlan({...base,start:0,end:2,fps:0,top:'FLASH',overlays:{top:{start:.4,end:.7}}},[{start:0,delay:1},{start:1,delay:1}]);
assert.deepEqual(timed.times,[0,.4,.7,1]);assert.equal(timed.duration,2);assert.ok(timed.times.some(t=>t>=.4&&t<.7),'Timed overlays inside a held GIF frame must appear in exported output.');

const fast=gifFramePlan(framePlan({...base,start:0,end:.6,fps:0,speed:2},Array.from({length:20},(_,i)=>({start:i*.03,delay:.03}))));
assert.equal(fast.duration,.3);assert.ok(fast.delays.every(delay=>delay>=.02));
assert.equal(fast.delays.reduce((sum,delay)=>sum+Math.round(delay*100),0),30);
assert.equal(gifFramePlan({times:[0],delay:.005,duration:.005}).duration,.02);
const remainder=gifFramePlan({times:[0,.02],delays:[.02,.01],delay:.015,duration:.03});
assert.deepEqual(remainder.delays,[.03]);
assert.deepEqual(gifFramePlan(timed).times,[0,.4,.7,1]);
console.log('PASS: held-frame caption boundaries and GIF cumulative timing quantization.');
