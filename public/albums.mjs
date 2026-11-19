const esc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let selected='', bound=false, currentData, explore;
function showAlbum(id, focus=true) {
  selected=id;
  const album=currentData.albums.find(a=>a.id===id), pane=document.getElementById('album-detail');
  if(!album){pane.hidden=true;return;}
  const observed=new Map(currentData.songs.map(s=>[s.id,s]));
  pane.innerHTML=`<div class="album-detail-heading"><div><p class="eyebrow">${album.year} · ${esc(album.artist)} · ${esc(album.kind)}</p><h4 id="album-detail-title" tabindex="-1"><a href="${esc(album.wikipedia)}" target="_blank" rel="noopener">${esc(album.title)} ↗</a></h4></div><button type="button" data-close-album aria-label="Close album tracklist">Close ×</button></div><p class="small-note">${esc(album.edition)}</p><ol class="album-tracks">${album.tracks.map(t=>{
    const links=t.song_ids.filter(id=>observed.has(id)).map(id=>{const s=observed.get(id);return `<a href="?song=${encodeURIComponent(id)}#timeline" data-album-song="${esc(id)}">${t.song_ids.length===1?esc(t.title):esc(s.title)} <span>↗ ${s.date_count.toLocaleString()} observed dates</span></a>`;});
    return `<li>${t.song_ids.length>1?`<strong>${esc(t.title)}</strong>`:''}${links.length?links.join(''): `<span>${esc(t.title)}</span><small>No linked observations in this archive</small>`}${t.note?`<small>${esc(t.note)}</small>`:''}</li>`;
  }).join('')}</ol><p class="small-note">Links show imported recording evidence across all years, not a verified census of performances. Album release is not a song’s live debut. <a href="${esc(album.wikipedia)}" target="_blank" rel="noopener">Album information on Wikipedia ↗</a></p>`;
  pane.hidden=false;
  if(focus)document.getElementById('album-detail-title').focus({preventScroll:true});
  document.querySelectorAll('[data-album]').forEach(b=>b.setAttribute('aria-expanded',String(b.dataset.album===id)));
}
export function renderAlbums(data,state,onExplore) {
  currentData=data;explore=onExplore;
  const rail=document.getElementById('album-chronology'), saved=rail.scrollLeft;
  const years=(data.albums||[]).map(a=>a.year);
  document.getElementById('album-scope').textContent='Selected studio, live & solo releases'+(years.length?` · ${Math.min(...years)}–${Math.max(...years)}`:'');
  const groups=new Map();
  for(const album of data.albums||[]){if(!groups.has(album.year))groups.set(album.year,[]);groups.get(album.year).push(album);}
  rail.innerHTML=[...groups].map(([year,albums])=>`<div class="album-year ${year<state.from||year>state.to?'outside-album-range':''}" style="--album-count:${albums.length}"><span class="album-year-label">${year}</span>${albums.map((a,i)=>`<article class="album-card"><div class="album-tile" style="--tile-hue:${(year*13+i*63)%360}" aria-hidden="true"><span>${year}</span><i></i><b>${a.artist==='Grateful Dead'?'GD':a.artist==='Bob Weir'?'BW':'JG'}</b></div><a class="album-title" href="${esc(a.wikipedia)}" target="_blank" rel="noopener">${esc(a.title)} ↗</a><small>${esc(a.artist)} · ${esc(a.kind)}</small><button type="button" data-album="${a.id}" aria-expanded="${selected===a.id}" aria-controls="album-detail">Tracklist <span>↗</span></button></article>`).join('')}</div>`).join('');
  rail.scrollLeft=saved;
  if(selected)showAlbum(selected,false);
  if(!bound){
    bound=true;
    document.getElementById('albums').addEventListener('click',event=>{
      const album=event.target.closest('[data-album]');if(album){showAlbum(album.dataset.album);return;}
      const song=event.target.closest('[data-album-song]');
      if(song&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();explore(song.dataset.albumSong);}
      if(event.target.closest('[data-close-album]')){const id=selected;selected='';document.getElementById('album-detail').hidden=true;const button=document.querySelector(`[data-album="${id}"]`);button?.setAttribute('aria-expanded','false');button?.focus({preventScroll:true});}
    });
  }
}
