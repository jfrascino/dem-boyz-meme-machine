export const sharePresets = {
  chat:{label:'Group chat',aspect:'1:1',format:'gif',edge:480,fps:10,safeInset:.06},
  x:{label:'X post',aspect:'16:9',format:'mp4',edge:720,fps:30,safeInset:.06},
  story:{label:'Story / vertical',aspect:'9:16',format:'mp4',edge:720,fps:30,safeInset:.12}
};
export function mountSharePresets(root,onSelect){root.innerHTML='<label class="field"><span>Share preset</span><select aria-label="Share preset"><option value="">Custom settings</option>'+Object.entries(sharePresets).map(([k,p])=>`<option value="${k}">${p.label}</option>`).join('')+'</select></label><p class="saved-note">Presets set crop, format and safe caption margins. Preview the crop before exporting. Source resolution is preserved.</p>';root.querySelector('select').onchange=e=>{const p=sharePresets[e.target.value];if(p)onSelect({...p});};return{reset(){root.querySelector('select').value='';}};}
