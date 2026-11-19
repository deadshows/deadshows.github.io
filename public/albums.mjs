const esc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let selected='', bound=false, currentData, explore;
function showAlbum(id, focus=true) {
  selected=id;
  const album=currentData.albums.find(a=>a.id===id), pane=document.getElementById('album-detail');
  if(!album){if(pane.open)pane.close();return;}
  const observed=new Map(currentData.songs.map(s=>[s.id,s]));
  pane.innerHTML=`<div class="album-detail-heading"><div><p class="eyebrow">${album.year} · ${esc(album.artist)} · ${esc(album.kind)}</p><h4 id="album-detail-title" tabindex="-1"><a href="${esc(album.wikipedia)}" target="_blank" rel="noopener">${esc(album.title)} ↗</a></h4></div><button type="button" data-close-album aria-label="Close album tracklist">Close ×</button></div><p class="small-note">${esc(album.edition)}</p><ol class="album-tracks">${album.tracks.map(t=>{
    const links=t.song_ids.filter(id=>observed.has(id)).map(id=>{const s=observed.get(id);return `<a href="?song=${encodeURIComponent(id)}#timeline" data-album-song="${esc(id)}">${t.song_ids.length===1?esc(t.title):esc(s.title)} <span>↗ ${s.date_count.toLocaleString()} observed dates</span></a>`;});
    return `<li>${t.song_ids.length>1?`<strong>${esc(t.title)}</strong>`:''}${links.length?links.join(''): `<span>${esc(t.title)}</span><small>No linked observations in this archive</small>`}${t.note?`<small>${esc(t.note)}</small>`:''}</li>`;
  }).join('')}</ol><p class="small-note">Links show imported recording evidence across all years, not a verified census of performances. Album release is not a song’s live debut. <a href="${esc(album.wikipedia)}" target="_blank" rel="noopener">Album information on Wikipedia ↗</a></p>`;
  if(!pane.open)pane.showModal();
  if(focus)document.getElementById('album-detail-title').focus({preventScroll:true});
  document.querySelectorAll('[data-album]').forEach(b=>b.setAttribute('aria-expanded',String(b.dataset.album===id)));
}
export function renderAlbums(data,state,onExplore) {
  currentData=data;explore=onExplore;lastState=state;
  observer.observe(document.getElementById('activity-chart'));
  const rail=document.getElementById('album-chronology');
  const monthly=state.granularity==='month';
  const bins=[...document.querySelectorAll(monthly?'#activity-chart .show-month':'#activity-chart [data-bin]')];
  const chart=document.getElementById('activity-chart');
  const chartRect=chart.getBoundingClientRect();
  const groups=new Map();
  for(const [i,bin] of bins.entries()) {
    const year=monthly?Number((state.windowStart||`${state.from}-01`).slice(0,4))+Math.floor((Number((state.windowStart||`${state.from}-01`).slice(5))-1+i)/12):Number(bin.dataset.bin);
    const rect=bin.getBoundingClientRect(), left=rect.left-chartRect.left;
    if(!groups.has(year))groups.set(year,{left,right:left+rect.width});
    else groups.get(year).right=left+rect.width;
  }
  document.getElementById('album-scope').textContent=monthly?'Releases in the visible years · year precision':'Selected studio, live & solo releases · 1969–1989';
  rail.style.width=chartRect.width+'px';
  rail.innerHTML=[...groups].map(([year,pos])=>{
    const albums=(data.albums||[]).filter(a=>a.year===year);
    return `<div class="album-year ${year<state.from||year>state.to?'outside-album-range':''}" style="left:${pos.left}px;width:${pos.right-pos.left}px">${albums.map((a,i)=>`<button type="button" class="album-card" data-album="${a.id}" aria-label="${esc(a.title)}, ${year}, ${esc(a.artist)}; open tracklist" aria-expanded="${selected===a.id}" aria-controls="album-detail"><span class="album-tile" style="--tile-hue:${(year*13+i*63)%360}" aria-hidden="true"><i></i><b>${a.artist==='Grateful Dead'?'GD':a.artist==='Bob Weir'?'BW':'JG'}</b></span><span class="album-tooltip">${esc(a.title)}<small>${year} · ${esc(a.artist)}</small></span></button>`).join('')}</div>`;
  }).join('');
  if(!rail.querySelector('[data-album]'))rail.innerHTML='<p class="small-note">No selected album releases in these years.</p>';
  if(!bound){
    bound=true;
    const closeAlbum=()=>{const id=selected;selected='';document.querySelector(`[data-album="${id}"]`)?.setAttribute('aria-expanded','false');};
    document.getElementById('album-detail').addEventListener('close',closeAlbum);
    document.addEventListener('click',event=>{
      const album=event.target.closest('[data-album]');if(album){showAlbum(album.dataset.album);return;}
      const song=event.target.closest('[data-album-song]');
      if(song&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();closeAlbum();document.getElementById('album-detail').close();explore(song.dataset.albumSong);}
      if(event.target.closest('[data-close-album]')||event.target===document.getElementById('album-detail')){closeAlbum();document.getElementById('album-detail').close();}

    });
  }
}

let resizeFrame;
const observer=new ResizeObserver(()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{if(currentData)renderAlbums(currentData,lastState,explore);});});
let lastState;
