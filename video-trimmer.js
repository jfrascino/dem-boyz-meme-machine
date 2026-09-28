const MIN_CLIP = .2;
const MAX_CLIP = 8;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const clock = seconds => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;

// One decoder owns the preview; a separate, disposable decoder builds the filmstrip.
export function createVideoTrimmer(root, video, { onChange, onFrame = () => {} }) {
  root.innerHTML = `<fieldset class="trim-studio" id="video-timeline-controls" disabled>
    <div class="trim-heading"><strong>Trim & loop</strong><span id="trim-duration">Select up to 8 seconds</span></div>
    <div class="trim-scroll" id="trim-scroll"><div class="trim-track" id="trim-track">
      <div class="trim-filmstrip" id="trim-filmstrip" aria-hidden="true"></div>
      <div class="trim-shade before" id="trim-before"></div><div class="trim-shade after" id="trim-after"></div>
      <div class="trim-selection" id="trim-selection" aria-hidden="true"></div>
      <button type="button" class="trim-handle start" id="trim-start-handle" role="slider" aria-label="Clip start" aria-orientation="horizontal" aria-describedby="trim-help"><span></span></button>
      <button type="button" class="trim-handle end" id="trim-end-handle" role="slider" aria-label="Clip end" aria-orientation="horizontal" aria-describedby="trim-help"><span></span></button>
      <button type="button" class="trim-playhead" id="trim-playhead" role="slider" aria-label="Video playhead" aria-orientation="horizontal" aria-describedby="trim-help"><span></span></button>
    </div></div>
    <div class="trim-ruler"><span>0:00</span><span id="trim-total"></span></div>
    <div class="trim-transport"><div class="trim-playback"><button type="button" id="video-play-clip" class="trim-play" aria-pressed="false">▶ Loop preview</button><output id="trim-current">0:00.00</output></div><label class="trim-zoom">Zoom <select id="trim-zoom" aria-label="Timeline zoom"><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option><option value="8">8×</option></select></label></div>
    <div class="trim-times"><label>Start <input id="video-start" type="number" value="0" min="0" step="0.01" aria-label="Start time in seconds"></label><span class="trim-time-divider">→</span><label>End <input id="video-end" type="number" value="4" min="0.2" step="0.01" aria-label="End time in seconds"></label><div class="trim-step"><button type="button" id="trim-back" aria-label="Scrub back 0.01 seconds" title="Back 0.01 seconds">‹</button><button type="button" id="trim-forward" aria-label="Scrub forward 0.01 seconds" title="Forward 0.01 seconds">›</button></div></div>
    <p class="trim-help" id="trim-help">Drag the yellow edges to trim. Drag inside to move the clip; drag the white line to scrub.</p><p class="saved-note" id="video-clip-info"></p>
  </fieldset>`;
  const $ = selector => root.querySelector(selector);
  const track = $('#trim-track'), scroller = $('#trim-scroll'), fieldset = $('#video-timeline-controls');
  const startInput = $('#video-start'), endInput = $('#video-end');
  let duration = 0, start = 0, end = 0, playing = false, raf = 0, generation = 0, drag, thumbnailController, disabled = true, speed = 1, playback = 'forward', playEpoch = 0;
  const getRange = () => ({ start: Number(startInput.value), end: Number(endInput.value) });
  const valid = () => startInput.value !== '' && endInput.value !== '' && Number.isFinite(getRange().start) && Number.isFinite(getRange().end) && getRange().start >= 0 && getRange().end <= duration + .001 && getRange().end - getRange().start >= MIN_CLIP - .001 && getRange().end - getRange().start <= MAX_CLIP + .001;

  function updatePlayhead() {
    const time = clamp(video.currentTime || 0, 0, duration);
    $('#trim-playhead').style.left = `${duration ? time / duration * 100 : 0}%`;
    $('#trim-playhead').setAttribute('aria-valuenow', time.toFixed(2));
    $('#trim-playhead').setAttribute('aria-valuetext', clock(time));
    $('#trim-current').textContent = clock(time); if(video.readyState>=2&&!video.seeking)onFrame();
  }
  function render() {
    const left = duration ? start / duration * 100 : 0, right = duration ? end / duration * 100 : 100;
    $('#trim-start-handle').style.left = `${left}%`;
    $('#trim-end-handle').style.left = `${right}%`;
    $('#trim-before').style.width = `${left}%`;
    $('#trim-after').style.left = `${right}%`;
    $('#trim-selection').style.left = `${left}%`;
    $('#trim-selection').style.width = `${right - left}%`;
    for (const [id, value, min, max] of [['trim-start-handle', start, 0, duration - MIN_CLIP], ['trim-end-handle', end, MIN_CLIP, duration], ['trim-playhead', video.currentTime || 0, 0, duration]]) {
      const handle = $('#' + id);
      handle.setAttribute('aria-valuemin', Math.max(0, min).toFixed(2)); handle.setAttribute('aria-valuemax', Math.max(0, max).toFixed(2));
      handle.setAttribute('aria-valuenow', value.toFixed(2)); handle.setAttribute('aria-valuetext', clock(value));
    }
    $('#trim-duration').textContent = `${(end - start).toFixed(2)} s selected`;
    $('#video-play-clip').textContent = playing ? 'Ⅱ Pause preview' : '▶ Loop preview';
    $('#video-play-clip').setAttribute('aria-pressed', String(playing));
    updatePlayhead();
  }
  function stop() {
    playing = false; generation++; cancelAnimationFrame(raf); video.pause();
    render();
  }
  function cancel() {
    if (drag) { const pointer = drag.pointer; drag = null; if (track.hasPointerCapture(pointer)) track.releasePointerCapture(pointer); }
    stop();
  }
  function seekPreview(time) {
    video.currentTime = clamp(time, 0, Math.max(0, duration - .001));
    updatePlayhead();
  }
  function tick() {
    if (!playing || disabled) return;
    // rAF catches the boundary more promptly than the sparse timeupdate event.
    if(playback==='forward'){if(!video.seeking&&(video.currentTime>=end||video.currentTime<start))seekPreview(start);}else if(!video.seeking){const length=end-start,elapsed=(performance.now()-playEpoch)/1000*speed,phase=elapsed%(playback==='pingpong'?length*2:length);const time=playback==='reverse'?end-phase:phase>length?end-(phase-length):start+phase;seekPreview(clamp(time,start,end-.001));}
    updatePlayhead(); raf = requestAnimationFrame(tick);
  }
  async function play() {
    if (disabled || !valid()) return;
    stop(); const currentGeneration = generation;
    playing = true; playEpoch=performance.now();video.playbackRate=speed;seekPreview(playback==='reverse'?end-.001:start);render();raf=requestAnimationFrame(tick);
    if(playback!=='forward')return;
    try { await video.play(); if (currentGeneration !== generation && !playing) video.pause(); }
    catch { if (currentGeneration === generation) stop(); }
  }
  const onEnded=() => { if (playing && !disabled && playback==='forward') { const currentGeneration = generation; seekPreview(start); const pending = video.play(); pending?.catch(() => { if (currentGeneration === generation) stop(); }); } };
  const listen=(source,add)=>{for(const [type,fn] of [['ended',onEnded],['timeupdate',updatePlayhead],['seeked',updatePlayhead]])source[add?'addEventListener':'removeEventListener'](type,fn);};
  listen(video,true);
  $('#video-play-clip').onclick = () => playing ? stop() : play();

  function writeRange(nextStart, nextEnd, previewTime) {
    start = nextStart; end = nextEnd;
    startInput.value = start.toFixed(2); endInput.value = end.toFixed(2);
    // Use the displayed hundredth-second values for both preview and export.
    start = Number(startInput.value); end = Number(endInput.value);
    render(); onChange(); if (previewTime !== undefined) seekPreview(previewTime);
  }
  function setBoundary(kind, value) {
    if (kind === 'start') {
      const nextStart = clamp(value, 0, duration - MIN_CLIP);
      writeRange(nextStart, clamp(end, nextStart + MIN_CLIP, Math.min(duration, nextStart + MAX_CLIP)), nextStart);
    } else {
      const nextEnd = clamp(value, MIN_CLIP, duration);
      writeRange(clamp(start, Math.max(0, nextEnd - MAX_CLIP), nextEnd - MIN_CLIP), nextEnd, Math.max(0, nextEnd - .01));
    }
  }
  const timeAt = x => clamp((x - track.getBoundingClientRect().left) / track.getBoundingClientRect().width * duration, 0, duration);
  track.addEventListener('pointerdown', event => {
    if (disabled || !duration || event.button !== 0) return;
    const kind = event.target.closest('#trim-start-handle') ? 'start' : event.target.closest('#trim-end-handle') ? 'end' : event.target.closest('#trim-playhead') ? 'scrub' : event.target.closest('#trim-selection') ? 'move' : 'scrub';
    const wasPlaying = playing; stop();
    drag = { kind, pointer: event.pointerId, start, end, origin: timeAt(event.clientX), resume: wasPlaying };
    track.setPointerCapture(event.pointerId); event.preventDefault();
    if (kind === 'scrub') seekPreview(timeAt(event.clientX));
    else if (kind === 'start' || kind === 'end') { $('#' + `trim-${kind}-handle`).focus({ preventScroll: true }); seekPreview(kind === 'start' ? start : end - .01); }
  });
  track.addEventListener('pointermove', event => {
    if (!drag || drag.pointer !== event.pointerId || disabled) return;
    const time = timeAt(event.clientX);
    if (drag.kind === 'move') {
      const length = drag.end - drag.start, nextStart = clamp(drag.start + time - drag.origin, 0, duration - length);
      writeRange(nextStart, nextStart + length, nextStart);
    } else if (drag.kind === 'scrub') seekPreview(time);
    else setBoundary(drag.kind, time);
  });
  function endDrag(event) {
    if (!drag || drag.pointer !== event.pointerId) return;
    const resume = drag.resume && event.type !== 'pointercancel'; drag = null;
    if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
    if (resume) play();
  }
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) track.addEventListener(event, endDrag);
  for (const kind of ['start', 'end', 'playhead']) {
    $('#' + (kind === 'playhead' ? 'trim-playhead' : `trim-${kind}-handle`)).addEventListener('keydown', event => {
      if (disabled) return;
      if (event.key === ' ') { event.preventDefault(); playing ? stop() : play(); return; }
      const delta = ({ArrowLeft:-1,ArrowDown:-1,ArrowRight:1,ArrowUp:1,PageDown:-100,PageUp:100})[event.key];
      if (delta === undefined && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault(); stop();
      const current = kind === 'start' ? start : kind === 'end' ? end : video.currentTime;
      const value = event.key === 'Home' ? 0 : event.key === 'End' ? duration : current + delta * (event.shiftKey ? .1 : .01);
      if (kind === 'playhead') seekPreview(value); else setBoundary(kind, value);
      event.currentTarget.scrollIntoView({ block:'nearest', inline:'nearest' });
    });
  }
  for (const [input, kind] of [[startInput, 'start'], [endInput, 'end']]) {
    input.addEventListener('input', () => { stop(); if (valid()) { start = getRange().start; end = getRange().end; render(); seekPreview(kind === 'start' ? start : end - .01); } onChange(); });
    input.addEventListener('change', () => { stop(); setBoundary(kind, Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : kind === 'start' ? start : end); });
  }
  $('#trim-back').onclick = () => { stop(); seekPreview(video.currentTime - .01); };
  $('#trim-forward').onclick = () => { stop(); seekPreview(video.currentTime + .01); };
  $('#trim-zoom').onchange = () => {
    track.style.width = `${Number($('#trim-zoom').value) * 100}%`;
    scroller.scrollLeft = ((start + end) / 2 / duration) * track.offsetWidth - scroller.clientWidth / 2;
  };

  async function thumbnails(url, signal) {
    const decoder = document.createElement('video'); decoder.muted = true; decoder.preload = 'auto'; decoder.playsInline = true;
    const wait = event => new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); decoder.removeEventListener(event, done); decoder.removeEventListener('error', failed); signal.removeEventListener('abort', failed); };
      const done = () => { cleanup(); resolve(); }, failed = () => { cleanup(); reject(new Error('Thumbnail decoding stopped')); };
      const timer = setTimeout(failed, 10000);
      decoder.addEventListener(event, done, { once:true }); decoder.addEventListener('error', failed, { once:true }); signal.addEventListener('abort', failed, { once:true }); if (signal.aborted) failed();
    });
    try {
      const loaded = wait('loadeddata'); decoder.src = url; decoder.load(); await loaded;
      const canvas = document.createElement('canvas'); canvas.width = 144; canvas.height = 90; const ctx = canvas.getContext('2d');
      for (let i = 0; i < 12; i++) {
        if (signal.aborted) return;
        const time = Math.min((i + .5) / 12 * decoder.duration, decoder.duration - .01);
        if (Math.abs(decoder.currentTime - time) > .001) { const sought = wait('seeked'); decoder.currentTime = time; await sought; }
        if (signal.aborted) return;
        const scale = Math.max(canvas.width / decoder.videoWidth, canvas.height / decoder.videoHeight);
        ctx.drawImage(decoder, (canvas.width - decoder.videoWidth * scale) / 2, (canvas.height - decoder.videoHeight * scale) / 2, decoder.videoWidth * scale, decoder.videoHeight * scale);
        const img = document.createElement('img'); img.alt = ''; img.src = canvas.toDataURL('image/jpeg', .65); $('#trim-filmstrip').append(img);
      }
    } catch { /* A filmstrip failure must not block trimming a decodable video. */ }
    finally { decoder.removeAttribute('src'); decoder.load(); }
  }
  function load(url, seconds, getThumbnail) {
    cancel(); thumbnailController?.abort(); thumbnailController = new AbortController();
    duration = Math.floor((seconds + 1e-7) * 100) / 100; start = 0; end = Math.min(4, duration);
    startInput.max = Math.max(0, duration - MIN_CLIP); endInput.max = duration;
    $('#trim-total').textContent = clock(duration); $('#trim-zoom').value = '1'; track.style.width = '100%'; scroller.scrollLeft = 0;
    $('#trim-filmstrip').replaceChildren(); writeRange(start, end); if(getThumbnail){for(let i=0;i<12;i++){const img=document.createElement('img');img.alt='';img.src=getThumbnail(Math.min((i+.5)/12*seconds,seconds-.001));$('#trim-filmstrip').append(img);}}else thumbnails(url, thumbnailController.signal);
  }
  return { load, getRange, valid, cancel, setSource(source){cancel();listen(video,false);video=source;listen(video,true);}, setRange(a,b){stop();const lo=clamp(a,0,duration-MIN_CLIP);writeRange(lo,clamp(b,lo+MIN_CLIP,Math.min(duration,lo+MAX_CLIP)),lo);},setPlaybackOptions(options){const resume=playing;stop();speed=options.speed;playback=options.playback;if(resume)play();}, setDisabled(value) { disabled = value; fieldset.disabled = value; if (value) cancel(); } };
}
