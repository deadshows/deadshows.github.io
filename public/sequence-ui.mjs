import {mountTimeline,inWindow} from './sequence-timeline.mjs';
import {searchShow} from './sequence-engine.mjs';
import {ratedSource,relistenUrl} from './analytics.mjs';
const root=document.getElementById('setlist-search'), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let setlists,catalog,loading,resultLimit=50;
const $=id=>document.getElementById(id);
let timeline=mountTimeline($('sequence-timeline'),()=>run(true));
async function load(){
  if(!loading)loading=Promise.all([fetch('data/setlists.json').then(r=>{if(!r.ok)throw Error('Setlist data unavailable');return r.json();}),fetch('data/catalog.json').then(r=>r.json())]).then(([p,c])=>{
    setlists=p;catalog=c;const options=opener=>'<option value="">Any song</option>'+Object.values(p.songs).filter(s=>opener?s.kind==='song':s.kind!=='unclassified_musical_label').sort((a,b)=>a.title.localeCompare(b.title)).map(s=>`<option value="${esc(s.id)}">${esc(s.title)}${s.kind!=='song'?' ['+esc(s.kind.replaceAll('_',' '))+']':''}</option>`).join('');
    root.querySelectorAll('select[data-song-picker]').forEach(el=>el.innerHTML=options(el.id.startsWith('sequence-opener')));
    timeline.update(p.shows,[]);
    $('sequence-coverage').innerHTML='<table><thead><tr><th>Year</th><th>Archive dates</th><th>Searchable</th><th>Set-labelled</th><th>Unresolved entries</th></tr></thead><tbody>'+Object.entries(p.coverage?.years??{}).map(([year,c])=>`<tr><th>${esc(year)}</th><td>${c.date_groups??0}</td><td>${c.searchable??c.with_sets??0}</td><td>${c.with_sets??0}</td><td>${c.unresolved??0}</td></tr>`).join('')+'</tbody></table>';
    $('sequence-status').textContent=`${p.shows.length} searchable source lists · ${p.coverage?.sources??p.shows.length} source dates processed · ${p.coverage?.date_groups??p.shows.length} archive date groups · Independent of the archive filters above. Source-listed evidence is not a verified complete concert catalog; missing and ambiguous evidence stays unknown.`;
  });
  return loading;
}
$('open-sequence-tool').addEventListener('click',async()=>{
  $('sequence-controls').hidden=false;$('open-sequence-tool').hidden=true;
  try{await load();$('sequence-opener1').focus();}catch(e){$('sequence-status').textContent=e.message;}
});
$('sequence-add').addEventListener('click',()=>{
  if(root.querySelectorAll('.sequence-song').length>=8)return;
  const label=document.createElement('label');label.className='sequence-slot';label.innerHTML=`Song ${root.querySelectorAll('.sequence-song').length+1}<select class="sequence-song" data-song-picker aria-label="Sequence song ${root.querySelectorAll('.sequence-song').length+1}">${$('sequence-song1').innerHTML}</select>`;$('sequence-slots').append(label);
});
$('sequence-reset').addEventListener('click',()=>{$('sequence-form').reset();$('sequence-slots').querySelectorAll('.sequence-slot').forEach((el,i)=>{if(i>2)el.remove();});timeline.reset();if(setlists)timeline.update(setlists.shows,[]);$('sequence-results').innerHTML='';$('sequence-readout').textContent='Choose an opener, encore song, or sequence, then search.';});
root.querySelectorAll('[data-sequence-preset]').forEach(button=>button.addEventListener('click',async()=>{
  try{await load();$('sequence-form').reset();const ids=button.dataset.sequencePreset.split(',');const slots=root.querySelectorAll('.sequence-song');slots.forEach((s,i)=>s.value=ids[i]||'');run();}catch(e){$('sequence-status').textContent=e.message;}
}));
$('sequence-sort').addEventListener('change',()=>{if($('sequence-results').children.length)run();});
$('sequence-form').addEventListener('submit',e=>{e.preventDefault();run();});
function run(keepWindow=false){
  if(!setlists)return;
  if(!keepWindow)resultLimit=50;
  const q={opener1:$('sequence-opener1').value,opener2:$('sequence-opener2').value,encore:$('sequence-encore').value,sequence:[...root.querySelectorAll('.sequence-song')].map(s=>s.value).filter(Boolean),mode:$('sequence-mode').value,scope:$('sequence-scope').value,segue:$('sequence-segue').checked};
  if(!q.opener1&&!q.opener2&&!q.encore&&!q.sequence.length){$('sequence-readout').textContent='Choose at least one song condition.';$('sequence-results').innerHTML='';return;}
  const matches=setlists.shows.map(s=>({s,evidence:searchShow(s,q,setlists.songs),show:catalog.shows.find(x=>x.id===s.id)})).filter(x=>x.evidence);
  for(const m of matches)m.rating=m.show?ratedSource(m.show,5):null;
  matches.sort($('sequence-sort').value==='date'?(a,b)=>a.s.date.localeCompare(b.s.date):(a,b)=>(b.rating?.adjusted??-1)-(a.rating?.adjusted??-1)||a.s.date.localeCompare(b.s.date));
  if(!keepWindow)timeline.update(setlists.shows,matches.map(m=>m.s));
  const window=timeline.window(),visibleMatches=window?matches.filter(m=>inWindow(m.s.date,window)):matches;
  $('sequence-readout').textContent=`${window?visibleMatches.length+' matches in the visible window · ':''}${matches.length} source-supported ${matches.length===1?'match':'matches'} · ${(setlists.coverage?.date_groups??setlists.shows.length)-matches.length} other archive dates not established by this evidence. All conditions must match. Recording ratings require ≥5 reviews.`;
  $('sequence-results').innerHTML=visibleMatches.slice(0,resultLimit).map(({s,evidence,show,rating})=>`<article class="sequence-result"><header><div><h3><button class="show-button" data-show="${esc(s.id)}">${esc(s.date)}</button></h3><p>${esc(s.venue)}${show?.location?' · '+esc(show.location):''}</p><small>${s.review_level==='source_format_reviewed'?'Source format reviewed':'Automatic extraction · awaits review'}</small></div><div>${rating?`<a href="https://archive.org/details/${encodeURIComponent(rating.id)}">★ ${rating.average.toFixed(2)}</a><small>${rating.count} reviews · adjusted ${rating.adjusted.toFixed(2)}</small>`:'<small>No eligible recording rating</small>'}</div></header>${evidence.map(f=>`<p class="sequence-passage"><small>${esc(f.label)}${f.reportedOnly?' · listed in source, missing from tape':''}</small>${f.entries.map(e=>`<mark>${esc(setlists.songs[e.song_id]?.title||'Unknown')}</mark>`).join(q.mode==='ordered'?' … ':' → ')}</p>`).join('')}<nav><button type="button" class="text-button" data-show="${esc(s.id)}">Show details ↗</button><a href="${esc(relistenUrl(s.date))}">Relisten ↗</a><a href="${esc(s.url)}">Setlist source ↗</a></nav><details><summary>Source setlist and evidence limits</summary><p>Source annotations, not audio verification. Missing titles and cuts block consecutive matches. Missing arrows mean unknown transitions. Unlabelled setlists match only passages connected by explicit source arrows. Main-song openers ignore stage talk; opening fragments remain uncertain.</p>${s.boundary_reference?`<p>Boundary check: <a href="${esc(s.boundary_reference)}">reference ↗</a></p>`:''}${s.sets.map(b=>`<p><strong>${b.performance?esc(b.performance[0].toUpperCase()+b.performance.slice(1))+' show · ':''}${b.kind==='unknown'?'Set unknown':b.kind==='encore'?'Encore':`Set ${b.ordinal}`}</strong> · ${b.entries.map(e=>`${esc(setlists.songs[e.song_id]?.title|| (e.type==='non_music'?'Stage talk / tuning':e.type==='unresolved_gap'?'Unresolved title':'Recording gap'))}${e.type==='reported_missing'?' [missing from tape]':e.flags.includes('possible_cut_or_gap')?' [cut / gap]':''}`).join(' · ')}</p>`).join('')}</details></article>`).join('')||(window?'<p>No matches established in this twelve-month window. Move the slider or choose All years above.</p>':'<p>No source-supported matches. Try a shorter sequence, change its set, or turn off the documented-segue requirement. An empty result does not prove the songs were never played together.</p>');
  if(visibleMatches.length>resultLimit){const more=document.createElement('button');more.type='button';more.className='primary-link';more.textContent=`Show 50 more (${visibleMatches.length-resultLimit} remaining)`;more.addEventListener('click',()=>{resultLimit+=50;run(true);});$('sequence-results').append(more);}
}
