import {renderAlbums} from './albums.mjs';
import {birthdaysOn, anniversaryShows, ratedSource, selectShows, songStatistics, yearCounts, timelineBins, normalizeState, rollingWindow, monthKey, showBins, yearDensity, relistenUrl} from './analytics.mjs';
const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = n => Number(n).toLocaleString('en-US');
const shortDate = date => new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric', timeZone:'UTC'});
const sourceLink = (url, label) => /^https:\/\//.test(url) ? `<a href="${escape(url)}">${escape(label)} ↗</a>` : escape(label);
const dataRevision = new URL(import.meta.url).searchParams.get('v');
const dataUrl = path => dataRevision ? `${path}?v=${encodeURIComponent(dataRevision)}` : path;
let data, state, page = 0, filtered = [], detailVersion = 0, lastFocus;
const pageSize = 25;
let yearAnchor = null, timelineRows = new Map();
const params = () => new URLSearchParams(location.search);
function currentUrl({show, omitShow = false} = {}) {
  const query = new URLSearchParams();
  if (state.from !== 1965) query.set('from', state.from);
  if (state.to !== 1995) query.set('to', state.to);
  for (const key of ['song','era']) if (state[key]) query.set(key, state[key]);
  for (const member of state.members) query.append('member',member);
  if (state.members.length && state.memberMode === 'any') query.set('member_match','any');
  if (state.granularity === 'month' && state.windowStart) query.set('window',state.windowStart);
  if (state.search) query.set('q', state.search);
  if (state.sort !== 'rating') query.set('sort', state.sort);
  if (state.minimum !== 5) query.set('min', state.minimum);
  if (state.month) query.set('month', state.month);
  if (state.granularity !== 'year') query.set('bins', state.granularity);
  if (state.metric !== 'count') query.set('metric', state.metric);
  const showId = show || (!omitShow && params().get('show'));
  if (showId) query.set('show', showId);
  return location.pathname + (query.size ? '?' + query : '') + location.hash;
}
function syncControls() {
  for (const id of ['from','to','song','sort']) $(id).value = state[id];
  for (const input of $('members').querySelectorAll('input')) input.checked = state.members.includes(input.value);
  $('member-summary').textContent = state.members.length ? state.members.length===1 ? chosenMembers()[0].name : `${state.members.length} selected` : 'All personnel';
  $('member-mode').value = state.memberMode;
  $('search').value = state.search;
  $('min-reviews').value = state.minimum;
  $('timeline-bins').value = state.granularity;
  $('timeline-metric').value = state.song ? state.metric : 'count';
  $('timeline-metric').disabled = !state.song;
  $('timeline-metric').title = state.song ? 'Count dates played or compare their share of imported dates' : 'Choose a song to compare its share of imported dates';
}
function change(update) {
  if (('from' in update || 'to' in update) && !('windowStart' in update)) {
    state.month = ''; state.windowStart = ''; state.granularity = 'year';
  }
  Object.assign(state, update);
  if (state.from > state.to) [state.from, state.to] = [state.to, state.from];
  page = 0;
  history.replaceState(null, '', currentUrl({omitShow:true}));
  syncControls(); render();
}
function chosenMembers() {return data.history.members.filter(m=>state.members.includes(m.id));}
function toggleMember(id) {change({members:state.members.includes(id)?state.members.filter(value=>value!==id):[...state.members,id]});}
function zoomYear(year) {yearAnchor=year;change({from:year,to:year,granularity:'month',windowStart:`${year}-01`,month:''});}
function moveWindow(index) {
  const window=rollingWindow(monthKey(Math.max(0,Math.min(360,index))));
  change({from:window.from,to:window.to,windowStart:window.start,granularity:'month',month:''});
}
function notableFor(id) {return data?.notable_shows?.shows.find(n=>n.show_id===id);}
function notableMarker(id) {
  const note=notableFor(id);
  return note?`<button type="button" class="notable-marker" data-notable="${escape(id)}" aria-label="Historical note: ${escape(note.title)}" title="${escape(note.title)}">✦</button>`:'';
}
function openNotable(id) {
  const note=notableFor(id);if(!note)return;
  $('notable-content').innerHTML=`<p class="eyebrow">✦ ${escape(note.category)} · ${shortDate(note.date)}</p><h2 id="notable-title">${escape(note.title)}</h2><p>${escape(note.blurb)}</p><p>${sourceLink(note.source,'Historical source')}</p><p><button type="button" id="notable-open-show" class="primary-link">Open show ↗</button></p><p class="small-note">Historical context, separate from recording ratings. ${escape(data.notable_shows.note)}</p>`;
  $('notable-open-show').addEventListener('click',()=>{$('notable-dialog').close();openShow(id);});
  $('notable-dialog').showModal();
}
function render() {
  filtered = selectShows(data.shows, state, data.history);
  if($('notable-only').checked) filtered=filtered.filter(s=>notableFor(s.id));
  $('eras').innerHTML = `<button class="chip ${!state.era?'active':''}" type="button" data-era="" aria-pressed="${!state.era}">All eras</button>` + data.history.eras.map(e => `<button class="chip ${state.era===e.id?'active':''}" type="button" data-era="${escape(e.id)}" aria-pressed="${state.era===e.id}">${escape(e.title)}</button>`).join('');
  $('review-label').hidden = state.sort !== 'rating';
  renderActivity(); renderNotes(); renderTable(); renderSongs(); renderHistory(); renderAlbums(data,state,exploreAlbumSong);
}
function binLabel(key) {
  return key.length === 4 ? key : new Date(key + '-01T12:00:00Z').toLocaleDateString('en-US', {month:'short', year:'numeric', timeZone:'UTC'});
}
function timelineReadout(key) {
  const row = timelineRows.get(key);
  if (!row) return;
  const song = data.songs.find(s=>s.id===state.song);
  if(row.showId){
    const show=data.shows.find(s=>s.id===row.showId), rating=ratedSource(show,state.minimum);
    $('timeline-readout').textContent=`${shortDate(row.date)} · ${row.venue}${row.location?' · '+row.location:''}. ${!row.evidence?'No usable song evidence; song presence is unknown.':song?row.observed?`${song.title} played.`:`${song.title} not listed in this tracklist.`:`${row.value} listed song titles.`}${rating?` Recording rating: ${rating.average.toFixed(2)} / 5 (${rating.count} reviews).`:''} Open for tracklist, personnel context and recording sources.`;
    return;
  }
  $('timeline-readout').textContent = `${binLabel(key)} · ${song ? `${row.count} date${row.count===1?'':'s'} with ${song.title}. ` : `${row.total} reported date groups. `}${row.evidence} of ${row.total} date groups have imported track evidence.${song ? row.frequency===null ? ' No track evidence here; performance frequency is unknown.' : ` Present on ${Math.round(row.frequency*100)}% of imported dates. This is sample evidence.` : ''}`;
}
function renderActivity() {
  const song = data.songs.find(s=>s.id===state.song), member = chosenMembers().length ? {name:chosenMembers().map(m=>m.name).join(', ')} : null;
  const monthly = state.granularity === 'month', frequency = !monthly && !!song && state.metric === 'frequency';
  // The histogram keeps its context when rating thresholds or individual bins are selected.
  const base = selectShows(data.shows, state, data.history, {ignoreSong:true, ignoreYears:true, ignoreMonth:true, ignoreSort:true});
  const rows = timelineBins(base, state.song, {from:monthly?state.from:1965, to:monthly?state.to:1995, granularity:state.granularity,windowStart:state.windowStart});
  const window=monthly?rollingWindow(state.windowStart || `${state.from}-01`):null;
  $('timeline-window').hidden=!monthly;
  if(window){
    const label=`${binLabel(window.start)} – ${binLabel(window.end)}`;
    $('window-label').textContent=label;
    $('window-slider').value=window.index;
    $('window-slider').setAttribute('aria-valuetext',label);
    $('window-previous').disabled=window.index===0;
    $('window-next').disabled=window.index===360;
  }
  timelineRows = new Map(rows.map(r=>[r.key,r]));
  const density = yearDensity(base,state.song);
  const max = frequency ? 1 : Math.max(1, ...Object.values(density).flat().map(r => song ? r.evidence : r.total));
  $('timeline-max').textContent = frequency ? '100%' : max;
  $('activity-chart').classList.toggle('monthly', monthly);
  $('activity-chart').classList.toggle('song-timeline', !!song);
  $('activity-chart').classList.toggle('frequency-timeline', frequency);
  $('activity-chart').style.setProperty('--bin-count', rows.length);
  const focusIndex = Math.max(0, rows.findIndex(r=>state.month ? r.key===(monthly?state.month:state.month.slice(0,4)) : r.year===state.from));
  $('activity-chart').innerHTML = rows.map((r,index) => {
    const selected = state.month ? r.key===(monthly?state.month:state.month.slice(0,4)) : r.year>=state.from&&r.year<=state.to;
    const value = frequency ? r.frequency || 0 : r.count;
    const description = song ? `${r.count} dates played; ${r.evidence} imported of ${r.total} reported dates${r.frequency===null?'; frequency unknown':`; ${Math.round(r.frequency*100)} percent of imported dates`}` : `${r.total} reported dates; ${r.evidence} imported tracklists`;
    const label = monthly ? (r.key.endsWith('-01') && rows.length>12 ? binLabel(r.key) : rows.length<=24 ? binLabel(r.key).split(' ')[0] : '') : (index%5===0 || index===rows.length-1 ? r.key : '');
    if(!monthly) {
      const months=density[r.year]||[];
      const mini=months.map(m=>{
        const height=frequency?(m.frequency||0)*100:m.count/max*100;
        return `<span class="month-density ${!m.evidence?'unknown-month':''}" style="--month-height:${height}%;--month-coverage:${m.evidence/max*100}%"><span class="month-coverage"></span><span class="month-observed"></span></span>`;
      }).join('');
      return `<button class="year-bar density-year ${selected?'selected-range':'outside'} ${!r.evidence?'no-evidence':''}" type="button" data-bin="${r.key}" tabindex="${index===focusIndex?0:-1}" aria-pressed="${selected}" title="${r.key}: ${description}" aria-label="Select ${r.key}: ${description}; twelve monthly density bars"><span class="year-density" aria-hidden="true">${mini}</span><span class="bar-label">${escape(label)}</span></button>`;
    }
    return `<button class="year-bar ${selected?'selected-range':'outside'} ${!r.evidence?'no-evidence':''}" type="button" data-bin="${r.key}" tabindex="${index===focusIndex?0:-1}" aria-pressed="${selected}" style="--height:${value/max*100}%;--coverage-height:${r.evidence/max*100}%" title="${binLabel(r.key)}: ${description}" aria-label="Select ${binLabel(r.key)}: ${description}"><span class="coverage-fill"></span><span class="bar-fill"${!value?' hidden':''}></span><span class="bar-label">${escape(label)}</span></button>`;
  }).join('');
  if(monthly) {
    const groups=showBins(base,state.song,window.start), dates=groups.flatMap(group=>group.shows);
    timelineRows=new Map(dates.map(row=>[row.key,row]));
    const maxValue=song?1:Math.max(1,...dates.map(row=>row.value||0));
    $('timeline-max').textContent=maxValue;
    $('activity-chart').style.setProperty('--show-width',groups.reduce((total,group)=>total+Math.max(54,group.shows.length*16),0)+'px');
    $('activity-chart').innerHTML=groups.map(group=>`<div class="show-month" style="--dates:${Math.max(1,group.shows.length)}" role="group" aria-label="${binLabel(group.key)}: ${group.shows.length} reported show dates"><span class="show-month-label">${escape(binLabel(group.key))}</span>${group.shows.length?group.shows.map(row=>{
      const title=`${notableFor(row.showId)?'✦ Historical note available · ':''}${shortDate(row.date)} · ${row.venue} · ${!row.evidence?'song evidence unknown':song?row.observed?`${song.title} played`:`${song.title} not listed`:`${row.value} listed song titles`}`;
      return `<button type="button" class="year-bar show-bin ${!row.evidence?'no-evidence':''} ${row.value===0?'not-observed':''}" data-show-bin="${escape(row.key)}" data-show="${escape(row.showId)}" tabindex="${row===dates[0]?0:-1}" style="--height:${(row.value||0)/maxValue*100}%" title="${escape(title)}" aria-label="Open ${escape(title)}"><span class="bar-fill"${!row.value?' hidden':''}></span><span class="show-baseline"></span>${notableFor(row.showId)?'<span class="show-notable" aria-hidden="true">✦</span>':''}<span class="show-day">${escape(row.date.slice(8))}</span></button>`;
    }).join(''):'<span class="no-show-dates">—<span class="sr-only">No reported dates</span></span>'}</div>`).join('');
  }
  $('activity-chart').classList.toggle('show-timeline',monthly);
  $('timeline-metric').disabled=monthly||!song;
  $('timeline-metric').value=monthly?'count':song?state.metric:'count';
  $('timeline-metric').options[0].textContent=monthly?song?'Song presence':'Song titles':'Date count';
  $('timeline-metric').title=monthly?'Each bar is one reported show date; use the yearly overview to compare frequency.':song?'Count dates or compare frequency':'Choose a song to compare frequency';
  $('chart-title').textContent = song ? `When was ${song.title} played?` : member ? `Dates during ${member.name}’s membership` : 'Recording timeline';
  $('chart-caption').textContent = song ? `Songs played in indexed recordings${member?` during ${member.name}’s membership windows`:''}. ${frequency?'Bar height is the share of imported dates containing this song. Hatched periods have no track evidence; their frequency is unknown.':'Pale bars show how many dates have track evidence; unfilled periods can be unknown.'}` : member ? 'Reported recording dates inside documented membership windows. These are not confirmed appearances.' : 'Reported recording dates across the live years. Choose a song to reveal its performance history, or a member to explore their time with the band.';
  if(!monthly) $('chart-caption').textContent+=' Each year contains January–December bars. Heights compare monthly counts (or monthly shares when selected); click anywhere in a year to zoom.';
  if(monthly) $('chart-caption').textContent=`Each bar opens one reported show date.${song?' Full bars mark this song as played; baseline marks mean it is not listed in that tracklist.':' Height shows the number of listed song titles.'} Hatched marks indicate unknown song evidence. Months expand to fit their dates; empty months stay visible. Scroll sideways for individual dates.`;
  const selectedBase = selectShows(data.shows, state, data.history, {ignoreSong:true,ignoreSort:true});
  const matches = selectShows(data.shows, state, data.history, {ignoreSort:true});
  const eligible = selectedBase.filter(s=>s.song_ids.length).length;
  $('timeline-summary').innerHTML = [[number(matches.length),song?'Dates played':'Reported dates'],[matches[0]?.date||'—',song?'First listed in range':'First reported in range'],[matches.at(-1)?.date||'—',song?'Last listed in range':'Last reported in range'],[`${number(eligible)} / ${number(selectedBase.length)}`,'Dates with track evidence']].map(([value,label])=>`<div><strong>${escape(value)}</strong><span>${label}</span></div>`).join('');
  $('match-key').textContent = song ? 'Song played' : monthly ? 'Listed song titles' : 'Reported dates';
  $('coverage-key').hidden = frequency || monthly;
  $('coverage-key').lastChild.textContent = song ? 'Imported dates available' : 'Imported tracklists';
  $('timeline-range').textContent = `Selected: ${state.month?binLabel(state.month):window?`${binLabel(window.start)} – ${binLabel(window.end)}`:state.from===state.to?state.from:`${state.from}–${state.to}`}${state.era?' · era filter active':''}${state.search?' · search active':''}`;
  $('timeline-clear-month').hidden = !state.month;
  $('timeline-all-years').disabled = state.from===1965&&state.to===1995&&!state.month&&!monthly;
  $('timeline-readout').textContent = monthly?'Point to or focus a show bar for its date and venue. Select it to open the show-details pane.':'Point to a bar or focus it for counts. Select a year to zoom into individual show dates.';
  $('member-window').hidden = !member;
  if (member) {
    const start = window ? Date.parse(window.start+'-01T00:00:00Z') : Date.UTC(1965,0,1);
    const end = window ? Date.UTC(window.to,Number(window.end.slice(5)),1) : Date.UTC(1996,0,1);
    $('member-window').innerHTML = chosenMembers().map(person=>{
      const spans = person.intervals.map(i=>{
        const left=Math.max(start,Date.parse(i.start+'T00:00:00Z')), right=Math.min(end,Date.parse(i.end+'T00:00:00Z')+86400000);
        return right>left?`<span style="left:${(left-start)/(end-start)*100}%;width:${(right-left)/(end-start)*100}%" title="${escape(i.start)}–${escape(i.end)} (${escape(i.precision)} precision)"></span>`:'';
      }).join('');
      return `<p>${escape(person.name)}</p><div class="window-track" aria-label="${escape(person.name)} membership window">${spans}</div>`;
    }).join('')+'<small>Membership across the full calendar window; individual attendance is not confirmed.</small>';
  }
}
function renderNotes() {
  const era = data.history.eras.find(e => e.id===state.era);
  const notes = [];
  if (era) notes.push(`<p><strong>${escape(era.title)}</strong> · ${escape(era.description)} ${era.sources.map(u => sourceLink(u,'Source')).join(' ')}</p>`);
  for (const member of chosenMembers()) notes.push(`<p><strong>${escape(member.name)}</strong> · ${escape(member.note)} Membership-window filtering does not confirm appearance at a show. ${member.intervals.map(i => sourceLink(i.source,'Source')).join(' ')}</p>`);
  if (state.sort==='rating') notes.push(`<p>Ranking individual recordings with ≥${state.minimum} reviews, showing one source per date group. Adjusted score uses ${data.rating_prior_strength} prior reviews at ${data.rating_prior.toFixed(2)} stars. This is not a performance-quality score; review totals are not pooled across sources.</p>`);
  $('selection-note').hidden = !notes.length;
  $('selection-note').innerHTML = notes.join('');
}
function releaseCell(show) {
  const releases=(show.official_releases||[]);
  const labels={complete:'Complete show',selections:'Selections',bonus:'Bonus tracks',featured:'Featured'};
  return releases.length?releases.map(release=>`<div class="release-reference"><a href="${escape(release.source_url)}" target="_blank" rel="noopener" aria-label="${escape(release.title)}: ${labels[release.coverage]} from ${escape(show.date)}">${escape(release.title)}</a><small>${labels[release.coverage]}</small></div>`).join(''):'<span class="release-unknown" aria-label="Release status not documented here" title="Release status not documented here">—</span>';
}
function renderTable() {
  const pages = Math.max(1, Math.ceil(filtered.length/pageSize));
  page = Math.min(page, pages-1);
  const first = page*pageSize;
  const selectedSong = data.songs.find(s=>s.id===state.song), selectedMember = chosenMembers().length ? {name:chosenMembers().map(m=>m.name).join(', ')} : null;
  $('matching-title').textContent = `${selectedSong?selectedSong.title+' · ':''}${selectedMember?selectedMember.name+' · ':''}${state.sort==='rating'?'Ranked recording dates':'Matching recording dates'}`;
  $('rank-matches').textContent = state.sort==='rating' ? 'Show in date order ↔' : 'Highest rated recordings ↓';
  $('rank-matches').setAttribute('aria-pressed', String(state.sort==='rating'));
  $('result-count').textContent = `${number(filtered.length)} date groups · ${number(filtered.reduce((n,s)=>n+s.recording_count,0))} recordings`;
  $('shows').innerHTML = filtered.slice(first, first+pageSize).map(s => {
    const rated = ratedSource(s, state.minimum);
    return `<tr><td><button class="show-button" data-show="${escape(s.id)}">${shortDate(s.date)}</button>${notableMarker(s.id)}</td><td><button class="show-button" data-show="${escape(s.id)}">${escape(s.venue)}</button><small>${escape(s.location||'Location not documented')} · ${s.recording_count} sources${s.warnings.length?' · needs review':''}</small></td><td><a class="relisten-button" href="${escape(relistenUrl(s.date))}" aria-label="Open ${escape(s.date)} in Relisten">Relisten</a></td><td class="concert-release-cell">${releaseCell(s)}</td><td>${rated?`<a class="rating-source" href="https://archive.org/details/${encodeURIComponent(rated.id)}" aria-label="Listen to rated recording for ${escape(s.date)}">★ ${rated.average.toFixed(2)} ↗</a><small>${rated.count} reviews · adj. ${rated.adjusted.toFixed(2)}</small>`:'<span class="small-note">No eligible rating</span>'}</td><td><button class="open-arrow" data-show="${escape(s.id)}" aria-label="Open ${escape(s.date)} recording sources">↗</button></td></tr>`;
  }).join('') || '<tr><td colspan="6" class="empty-state">No matching date groups. Try widening the years or removing a filter. Song filters only match imported tracklists.</td></tr>';
  $('page-label').textContent = filtered.length ? `${first+1}–${Math.min(first+pageSize,filtered.length)} / ${number(filtered.length)}` : '0 results';
  $('previous').disabled = page===0;
  $('next').disabled = page>=pages-1;
}
function renderSongs() {
  // Rating sort does not redefine the repertoire sample denominator.
  const base = selectShows(data.shows, state, data.history, {ignoreSong:true, ignoreSort:true});
  const denominator = base.filter(s=>s.song_ids.length).length;
  if (state.song) {
    const song = data.songs.find(s=>s.id===state.song), stats = songStatistics(base, state.song);
    $('song-status').textContent = song.status==='curated'?'CURATED TITLE / RECORDING EVIDENCE':'UNREVIEWED SOURCE TITLE';
    $('song-title').textContent = song.title;
    $('song-description').textContent = 'A performance history from imported tracklists. The first date listed here is not a verified debut. Duplicate sources and reprises count once per date group.';
    $('song-facts').innerHTML = `<div><strong>${stats.count}</strong><span>DATES PLAYED</span></div><div><strong>${stats.frequency===null?'—':Math.round(stats.frequency*100)+'%'}</strong><span>OF ${denominator} IMPORTED DATES</span></div>`;
    $('song-permalink').hidden = false;
    $('song-permalink').href = `songs/${song.id}/`;
    $('frequency-title').textContent = 'Share of imported dates, by year';
    const rows = yearCounts(base).filter(r=>r.year>=state.from&&r.year<=state.to);
    $('song-chart').innerHTML = rows.map(r=>{
      const stat = songStatistics(base.filter(s=>s.date.startsWith(String(r.year))), state.song);
      const pct = stat.frequency===null?null:stat.frequency*100;
      return `<div class="song-row"><button type="button" data-year="${r.year}">${r.year}</button><span class="track"><span class="fill" style="width:${pct||0}%"></span></span><span class="song-count">${pct===null?'no data':`${stat.count}/${stat.denominator}`}</span></div>`;
    }).join('');
    $('frequency-note').textContent = `${stats.first?`First listed in this selection: ${stats.first}; last: ${stats.last}. `:''}Numerator: imported date groups containing this title. Denominator: date groups with track evidence. Partial tapes, missing imports and title mismatches can omit songs. Missing data is not zero plays.`;
  } else {
    $('song-status').textContent = 'SONGS PLAYED';
    $('song-title').textContent = 'Songs in this selection';
    $('song-description').textContent = 'Choose a song to see its dates and frequency in the imported recordings. Reviewed title aliases connect the repertoire. Unreviewed labels remain in track evidence and are excluded from these charts.';
    $('song-facts').innerHTML = `<div><strong>${number(denominator)}</strong><span>DATES WITH TRACK EVIDENCE</span></div><div><strong>${number(base.length-denominator)}</strong><span>DATES WITHOUT SONG EVIDENCE</span></div>`;
    $('song-permalink').hidden=true;
    $('frequency-title').textContent='Most played in this selection';
    const counts = new Map();
    for(const show of base) for(const id of show.song_ids) counts.set(id,(counts.get(id)||0)+1);
    const top = data.songs.filter(s=>counts.has(s.id)&&s.kind!=='improvisation').sort((a,b)=>counts.get(b.id)-counts.get(a.id)||a.title.localeCompare(b.title)).slice(0,9);
    $('song-chart').innerHTML=top.map(s=>`<div class="song-row"><button type="button" data-song="${escape(s.id)}">${escape(s.title)}${s.status==='candidate'?' *':''}</button><span class="track"><span class="fill" style="width:${counts.get(s.id)/Math.max(denominator,1)*100}%"></span></span><span class="song-count">${counts.get(s.id)} / ${denominator}</span></div>`).join('')||'<p class="small-note">No tracklists imported for this selection yet.</p>';
    $('frequency-note').textContent='Counts reflect indexed recordings; incomplete setlists may omit performances. Each date counts once per title. Unreviewed titles are excluded. Improvisation labels remain searchable but are omitted from this song ranking.';
  }
}
function renderHistory() {
  $('personnel').innerHTML=data.history.members.map(m=>`<button class="personnel-row ${state.members.includes(m.id)?'active':''}" type="button" data-member="${escape(m.id)}" aria-pressed="${state.members.includes(m.id)}" title="${escape(m.note)}"><span class="personnel-name">${escape(m.name)}<small>${m.intervals.map(i=>`${i.start.slice(0,4)}–${i.end.slice(0,4)}`).join(' · ')}</small></span><span class="personnel-track" aria-hidden="true">${m.intervals.map(i=>{
    const start = Math.max(0,(new Date(i.start+'T00:00Z')-new Date('1965-01-01T00:00Z'))/(new Date('1996-01-01T00:00Z')-new Date('1965-01-01T00:00Z'))*100);
    const end = Math.min(100,(new Date(i.end+'T00:00Z')-new Date('1965-01-01T00:00Z'))/(new Date('1996-01-01T00:00Z')-new Date('1965-01-01T00:00Z'))*100);
    return `<span class="personnel-span" style="left:${start}%;width:${end-start}%" title="${escape(i.start)}–${escape(i.end)} (${escape(i.precision)} precision)"></span>`;
  }).join('')}</span></button>`).join('')+'<div class="personnel-years"><span>1965</span><span>1975</span><span>1985</span><span>1995</span></div>';
  const era=data.history.eras.find(e=>e.id===state.era);
  const window=state.granularity==='month'&&state.windowStart?rollingWindow(state.windowStart):null;
  const events=data.history.events.filter(e=>(!window||(e.date.slice(0,7)>=window.start&&e.date.slice(0,7)<=window.end))&&Number(e.date.slice(0,4))>=state.from&&Number(e.date.slice(0,4))<=state.to&&(!era||e.date>=era.start&&e.date<=era.end));
  $('events').innerHTML=events.map(e=>`<article class="event"><time datetime="${e.date}">${escape(e.precision==='year'?e.date.slice(0,4):e.precision==='month'?e.date.slice(0,7):e.date)}</time><div><h4>${escape(e.title)}</h4><p>${escape(e.description)}</p>${sourceLink(e.source,'Historical source')}</div></article>`).join('')||'<p class="small-note">No historical annotations for this period yet.</p>';
}
async function openShow(id, {updateUrl=true}={}) {
  const show=data.shows.find(s=>s.id===id);
  if(!show) return;
  lastFocus=document.activeElement;
  const version=++detailVersion;
  $('show-detail').innerHTML='<h2 id="show-heading">Opening the recording record…</h2>';
  if(!$('show-dialog').open) $('show-dialog').showModal();
  if(updateUrl) history.replaceState(null,'',currentUrl({show:id}));
  try {
    const response=await fetch(dataUrl(`data/shows/${encodeURIComponent(id)}.json`), {cache:'no-cache'});
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    const detail=await response.json();
    if(version!==detailVersion) return;
    const rating=ratedSource(show,state.minimum);
    const lineup=data.history.members.filter(m=>show.member_ids.includes(m.id)).map(m=>m.name).join(' · ');
    $('show-detail').innerHTML=`<p class="detail-kicker">${shortDate(detail.date)} / ${detail.recordings.length} RECORDING SOURCES</p><h2 id="show-heading">${escape(detail.venue)} ${notableMarker(id)}</h2><p class="detail-meta">${escape(detail.location)}</p>${rating?`<p class="show-rating"><a href="https://archive.org/details/${encodeURIComponent(rating.id)}">★ ${rating.average.toFixed(2)} / 5 ↗</a><small>${rating.count} reviews · adjusted ${rating.adjusted.toFixed(2)} · recording rating</small></p>`:''}<nav class="show-sections" aria-label="Show details sections"><button type="button" data-pane-section="show-tracks">Tracklist</button><button type="button" data-pane-section="show-personnel">Personnel</button><button type="button" data-pane-section="show-recordings">Recordings</button></nav><h3 id="show-personnel" tabindex="-1">Personnel context</h3><p class="detail-meta">${escape(lineup)||'Not documented'}</p><p class="detail-meta">Personnel are membership-window context, not confirmed attendance.</p><p><a href="shows/${escape(id)}/">Permanent archive record ↗</a> · <a href="${escape(relistenUrl(detail.date))}">Open in Relisten ↗</a></p><div class="detail-warning">${detail.status==='verified_event'?'Sourced event record.':'Provisional reported-date group. May combine early/late shows or mislabeled recordings.'} ${detail.warnings.map(escape).join(' ')}<br>Recording reviews may discuss performance, sound quality, or both. Ratings below belong to each recording.</div><h3 id="show-tracks" tabindex="-1">${detail.completeness==='complete'?'Verified setlist':'Setlist / recorded tracks'}</h3>${detail.tracks.length?`<p class="small-note">${detail.source_url?sourceLink(detail.source_url,'Setlist source'):sourceLink('https://archive.org/details/'+detail.evidence_recording,'Tracklist source')} · ${detail.completeness==='complete'?'Set divisions follow the cited source.':'Potentially incomplete. Order follows the source recording; sets and segues are not inferred.'}</p><ol class="track-list">${detail.tracks.map(t=>`<li>${t.song_id&&data.songs.some(s=>s.id===t.song_id)?`<button class="show-button" data-detail-song="${escape(t.song_id)}">${escape(t.title)}</button>`:escape(t.title)} ${t.status==='candidate'?'<small>unreviewed title</small>':t.status==='excluded_non_concert_or_other_artist'?'<small>excluded: other artist / non-concert</small>':!t.song_id?'<small>unresolved / non-song</small>':''}${t.set?` <small>${escape(t.set)}</small>`:''}</li>`).join('')}</ol>`:(detail.recordings.some(r=>r.enriched)?'<p class="small-note">Metadata is imported, but usable concert song evidence is unresolved or excluded. See the sources and review notes below.</p>':'<p class="small-note">Track metadata has not been imported for this date. Follow a recording source below to inspect its setlist.</p>')}<h3 id="show-recordings" tabindex="-1">Ratings & recording sources</h3>${detail.recordings.map(r=>`<article class="recording-card">${sourceLink(r.url,r.id)}${r.evidence_note?`<p>${escape(r.evidence_note)}</p>`:''}<p>${r.rating.average?`<span class="rating-star">★</span> ${r.rating.average.toFixed(2)} / 5 · ${r.rating.count} reviews · adjusted ${r.rating.adjusted.toFixed(2)}`:'No star rating available'}</p><small>Rating snapshot: ${escape(r.rating.retrieved_at.slice(0,10))} · ${r.enriched?'Track metadata imported':'Index metadata only'}</small></article>`).join('')}`;
  } catch(error) {
    if(version===detailVersion) $('show-detail').innerHTML=`<h2 id="show-heading">This record could not be opened.</h2><p>${escape(error.message)}</p><a href="shows/${escape(id)}/">Try the static archive page ↗</a>`;
  }
}
function closeShow() {
  ++detailVersion;
  $('show-dialog').close();
  history.replaceState(null,'',currentUrl({omitShow:true}));
  lastFocus?.focus();
}
function exploreAlbumSong(songId) {
  change({from:1965,to:1995,song:songId,members:[],era:'',search:'',month:'',windowStart:'',granularity:'year',metric:'count'});
  location.hash='timeline';
  $('timeline').scrollIntoView({behavior:'smooth',block:'start'});
  $('chart-title').tabIndex=-1;$('chart-title').focus({preventScroll:true});
}
function mountBirthdayCake(canvas) {
  const ctx=canvas.getContext('2d');
  if (!ctx) return;
  const nodes=[], edges=[];
  function line(points,color) {
    let previous=null;
    for(const [x,y] of points) {
      const index=nodes.length; nodes.push({x,y,px:x,py:y,vx:0,vy:0,color});
      if(previous!==null) edges.push([previous,index]); previous=index;
    }
  }
  // Elliptical layers form an original wire-and-point cake.
  for(let y=88;y<=151;y+=9) {
    const ring=[];
    for(let a=0;a<=64;a++) {const t=a/64*Math.PI*2;ring.push([120+76*Math.cos(t),y+19*Math.sin(t)]);}
    line(ring,y===88||y===151?'#c53c32':'#30758a');
  }
  for(let a=0;a<24;a++) {
    const t=a/24*Math.PI*2, side=[];
    for(let y=88;y<=151;y+=9) side.push([120+76*Math.cos(t),y+19*Math.sin(t)]);
    line(side,'#21382f');
  }
  const icing=[];
  for(let a=0;a<=96;a++) {const t=a/96*Math.PI*2;icing.push([120+77*Math.cos(t),94+19*Math.sin(t)+4*Math.sin(t*12)]);}
  line(icing,'#c53c32');
  for(const x of [92,120,148]) {
    for(const offset of [-3,3]) line(Array.from({length:10},(_,i)=>[x+offset,83-i*3]),'#21382f');
    line(Array.from({length:25},(_,i)=>{const t=i/24*Math.PI*2;return [x+5*Math.sin(t)*Math.sin(t/2),47+9*Math.cos(t)];}),'#c53c32');
  }
  let pointer=null, frame=0, previous=0, visible=false;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  function draw(now=0) {
    const step=previous?Math.min((now-previous)/16.67,2):1; previous=now;
    ctx.clearRect(0,0,240,200);
    for(const n of nodes) {
      const wave=reduced.matches?0:Math.sin(now*.0018+n.y*.035+n.x*.018)*1.2;
      let tx=n.x,ty=n.y+wave;
      if(pointer&&!reduced.matches) {const dx=n.x-pointer[0],dy=n.y-pointer[1],d=Math.hypot(dx,dy),force=Math.max(0,1-d/65)*24;tx+=dx/Math.max(1,d)*force;ty+=dy/Math.max(1,d)*force;}
      n.vx=(n.vx+(tx-n.px)*.08*step)*Math.pow(.78,step);
      n.vy=(n.vy+(ty-n.py)*.08*step)*Math.pow(.78,step);
      n.px+=n.vx*step;n.py+=n.vy*step;
    }
    ctx.lineWidth=.6;ctx.globalAlpha=.25;
    for(const [a,b] of edges) {ctx.strokeStyle=nodes[a].color;ctx.beginPath();ctx.moveTo(nodes[a].px,nodes[a].py);ctx.lineTo(nodes[b].px,nodes[b].py);ctx.stroke();}
    ctx.globalAlpha=.9;
    for(const n of nodes) {ctx.fillStyle=n.color;ctx.beginPath();ctx.arc(n.px,n.py,1.05,0,Math.PI*2);ctx.fill();}
    frame=visible&&!document.hidden&&!reduced.matches?requestAnimationFrame(draw):0;
  }
  function sync() {cancelAnimationFrame(frame);previous=0;draw();}
  canvas.addEventListener('pointermove',e=>{const r=canvas.getBoundingClientRect();pointer=[(e.clientX-r.left)/r.width*240,(e.clientY-r.top)/r.height*200];});
  canvas.addEventListener('pointerleave',()=>{pointer=null;});
  const observer=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;sync();}); observer.observe(canvas);
  document.addEventListener('visibilitychange',sync);reduced.addEventListener('change',sync);draw();
  return ()=>{visible=false;cancelAnimationFrame(frame);observer.disconnect();document.removeEventListener('visibilitychange',sync);reduced.removeEventListener('change',sync);};
}
let birthdayCleanups=[];
function setupDayPicker() {
  const month=$('this-day-month'), day=$('this-day-day');
  month.innerHTML=Array.from({length:12},(_,i)=>`<option value="${i+1}">${new Date(2000,i,1).toLocaleDateString('en-US',{month:'long'})}</option>`).join('');
  function updateDays(preferred) {
    const count=new Date(2000,Number(month.value),0).getDate();
    day.innerHTML=Array.from({length:count},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join('');
    day.value=String(Math.min(preferred,count));
  }
  function renderPick() {renderThisDay(`${month.value.padStart(2,'0')}-${day.value.padStart(2,'0')}`);}
  function today() {const now=new Date();month.value=String(now.getMonth()+1);updateDays(now.getDate());renderPick();}
  month.addEventListener('change',()=>{updateDays(Number(day.value));renderPick();});
  day.addEventListener('change',renderPick);
  $('this-day-today').addEventListener('click',today);
  today();
}
function renderThisDay(monthDay) {
  birthdayCleanups.forEach(dispose=>dispose?.());birthdayCleanups=[];
  const selectedDate = new Date(`2000-${monthDay}T12:00:00`);
  const matches = anniversaryShows(data.shows, monthDay);
  $('this-day-birthdays').innerHTML = birthdaysOn(data.history.members, monthDay).map(m => `<div class="birthday-note"><canvas class="birthday-cake" width="240" height="200" role="img" aria-label="Animated birthday cake point cloud"></canvas><p>Born on this day<br><strong>${escape(m.name)}</strong> · ${escape(m.birth_date.slice(0,4))} <a href="${escape(m.birth_source)}" aria-label="Birthday source for ${escape(m.name)}">↗</a></p></div>`).join('');
  birthdayCleanups=Array.from($('this-day-birthdays').querySelectorAll('canvas'),mountBirthdayCake);
  $('this-day-date').textContent = selectedDate.toLocaleDateString('en-US',{month:'long',day:'numeric'});
  if (!matches.length) {
    $('this-day-content').innerHTML = '<p>No shows are indexed for this day. Explore the timeline to find another date.</p>';
    return;
  }
  function showPick(id) {
    const {show, rating} = matches.find(m=>m.show.id===id) || matches[0];
    $('this-day-pick').innerHTML = `<h3>${shortDate(show.date)} · ${escape(show.venue)} ${notableMarker(show.id)}</h3><p>${escape(show.location || 'Location not documented')}</p>${rating ? `<p>★ ${rating.average.toFixed(2)} / 5 · ${rating.count} reviews · adjusted ${rating.adjusted.toFixed(2)}</p>` : '<p>No recording with at least 5 reviews is available for this date.</p>'}<p class="this-day-links"><button type="button" class="primary-link" id="this-day-open">Show details ↗</button><a href="${escape(relistenUrl(show.date))}">Relisten ↗</a>${rating ? `<a href="https://archive.org/details/${encodeURIComponent(rating.id)}">Internet Archive ↗</a>` : ''}</p>`;
    $('this-day-open').addEventListener('click',()=>openShow(show.id));
  }
  $('this-day-content').innerHTML = `<label class="field-label" for="this-day-select">${matches.length} indexed date${matches.length===1?'':'s'} · ranked recordings</label><select id="this-day-select">${matches.map(({show})=>`<option value="${escape(show.id)}">${shortDate(show.date)} · ${escape(show.venue)}</option>`).join('')}</select><div id="this-day-pick"></div>`;
  $('this-day-select').addEventListener('change',e=>showPick(e.target.value));
  showPick(matches[0].show.id);
}
async function start() {
  try {
    const response=await fetch(dataUrl('data/catalog.json'), {cache:'no-cache'});
    if(!response.ok) throw new Error(`Catalog request failed (${response.status})`);
    data=await response.json();
    state=normalizeState(params(),data);
    setupDayPicker();
    $('notable-only').addEventListener('change',()=>{page=0;render();});
    $('notable-close').addEventListener('click',()=>$('notable-dialog').close());
    $('notable-dialog').addEventListener('click',e=>{if(e.target===$('notable-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
    const c=data.coverage;
    $('stats').innerHTML=[['1965—95','Years on the road'],[number(c.date_groups),'Reported dates'],[number(c.recordings_in_scope),'Recording sources'],[number(c.dates_with_tracks),'Tracklists imported']].map(([v,l])=>`<div class="stat"><strong>${v}</strong><span>${l}</span></div>`).join('');
    $('song').innerHTML+=[...data.songs].sort((a,b)=>a.title.localeCompare(b.title)).map(s=>`<option value="${escape(s.id)}">${escape(s.title)}${s.status==='candidate'?' *':''}</option>`).join('');
    $('members').innerHTML=data.history.members.map(m=>`<label><input type="checkbox" value="${escape(m.id)}" aria-label="${escape(m.name)}"> ${escape(m.name)}</label>`).join('');
    $('coverage-summary').innerHTML=[[`${number(c.dates_with_metadata)} / ${number(c.date_groups)}`,'Dates with metadata imported'],[number(c.dates_awaiting_metadata),'Dates awaiting metadata'],[number(c.dates_with_tracks),'Dates with song evidence'],[number(c.dates_imported_without_song_evidence),'Imported dates needing evidence review']].map(([n,l])=>`<div><strong>${n}</strong><span>${l}</span></div>`).join('');
    syncControls();render();
    $('filters').addEventListener('submit',e=>e.preventDefault());
    for(const id of ['from','to']) $(id).addEventListener('change',()=>{
      const n=Number($(id).value);
      if(!Number.isInteger(n)||n<1965||n>1995){syncControls();return;}
      change({[id]:n});
    });
    for(const id of ['song','sort']) $(id).addEventListener('change',()=>change({[id]:$(id).value}));
    $('members').addEventListener('change',e=>{if(e.target.matches('input')) toggleMember(e.target.value);});
    $('member-mode').addEventListener('change',()=>change({memberMode:$('member-mode').value}));
    $('clear-members').addEventListener('click',()=>change({members:[]}));
    $('window-slider').addEventListener('input',()=>moveWindow(Number($('window-slider').value)));
    $('window-previous').addEventListener('click',()=>moveWindow(rollingWindow(state.windowStart).index-1));
    $('window-next').addEventListener('click',()=>moveWindow(rollingWindow(state.windowStart).index+1));
    $('timeline-bins').addEventListener('change',()=>{
      if($('timeline-bins').value==='month') zoomYear(state.from);
      else change({granularity:'year',windowStart:'',month:''});
    });
    $('timeline-metric').addEventListener('change',()=>change({metric:$('timeline-metric').value}));
    $('timeline-all-years').addEventListener('click',()=>{yearAnchor=null;change({from:1965,to:1995,month:'',granularity:'year',windowStart:''});});
    $('timeline-clear-month').addEventListener('click',()=>change({month:''}));
    $('rank-matches').addEventListener('click',()=>change({sort:state.sort==='rating'?'date':'rating'}));
    for (const event of ['pointerover','focusin']) $('activity-chart').addEventListener(event,e=>{
      const bar=e.target.closest('[data-bin],[data-show-bin]');if(!bar)return;
      timelineReadout(bar.dataset.showBin||bar.dataset.bin);
      if(event==='focusin') for(const node of $('activity-chart').querySelectorAll('button')) node.tabIndex=node===bar?0:-1;
    });
    $('activity-chart').addEventListener('keydown',e=>{
      const bar=e.target.closest('[data-bin],[data-show-bin]');if(!bar)return;
      const bars=[...$('activity-chart').querySelectorAll('button')], index=bars.indexOf(bar);
      const next=e.key==='ArrowRight'?bars[index+1]:e.key==='ArrowLeft'?bars[index-1]:e.key==='Home'?bars[0]:e.key==='End'?bars.at(-1):null;
      if(next){e.preventDefault();next.focus();}
    });
    $('min-reviews').addEventListener('change',()=>change({minimum:Number($('min-reviews').value)}));
    let searchTimer;
    $('search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>change({search:$('search').value.slice(0,200)}),150);});
    $('reset').addEventListener('click',()=>{$('notable-only').checked=false;clearTimeout(searchTimer);change(normalizeState(new URLSearchParams(),data));});
    $('member-picker').addEventListener('keydown',e=>{if(e.key==='Escape'){$('member-picker').open=false;$('member-picker').querySelector('summary').focus();}});
    document.addEventListener('click',e=>{
      if(!$('member-picker').contains(e.target)) $('member-picker').open=false;
      const button=e.target.closest('button');if(!button) return;
      if(button.dataset.notable){openNotable(button.dataset.notable);return;}
      if(button.dataset.paneSection){const section=$(button.dataset.paneSection);section?.scrollIntoView({block:'start'});section?.focus({preventScroll:true});}
      if(button.hasAttribute('data-era')) change({era:button.dataset.era});
      if(button.dataset.year) zoomYear(Number(button.dataset.year));
      if(button.dataset.bin) {
        const key=button.dataset.bin, year=Number(key.slice(0,4));
        if(key.length===7) change({month:key});
        else if(e.shiftKey) change({from:Math.min(yearAnchor??state.from,year),to:Math.max(yearAnchor??state.from,year)});
        else {zoomYear(year);}
        const focusKey=key.length===4 && state.granularity==='month'?[...timelineRows.keys()][0]:key;
        const replacement=$('activity-chart').querySelector(`[data-bin="${focusKey}"],[data-show-bin="${focusKey}"]`);
        replacement?.focus({preventScroll:true});
        timelineReadout(focusKey);
      }
      if(button.dataset.song) change({song:button.dataset.song});
      if(button.dataset.member) toggleMember(button.dataset.member);
      if(button.dataset.show) openShow(button.dataset.show);
      if(button.dataset.detailSong){closeShow();change({song:button.dataset.detailSong});$('timeline').scrollIntoView({behavior:'smooth',block:'start'});}
    });
    $('previous').addEventListener('click',()=>{page--;renderTable();});
    $('next').addEventListener('click',()=>{page++;renderTable();});
    $('close-dialog').addEventListener('click',closeShow);
    $('show-dialog').addEventListener('cancel',e=>{e.preventDefault();closeShow();});
    $('show-dialog').addEventListener('click',e=>{if(e.target===$('show-dialog')){const rect=e.target.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)closeShow();}});
    window.addEventListener('popstate',()=>{state=normalizeState(params(),data);page=0;syncControls();render();const show=params().get('show');if(show)openShow(show,{updateUrl:false});else if($('show-dialog').open)$('show-dialog').close();});
    const initialShow=params().get('show');
    if(initialShow) await openShow(initialShow,{updateUrl:false});
    else if(['#explore','#timeline','#repertoire','#history'].includes(location.hash)) requestAnimationFrame(()=>$(location.hash.slice(1)).scrollIntoView({behavior:'instant',block:'start'}));
  } catch(error) {
    $('error').hidden=false;
    $('error').textContent=`The archive could not load: ${error.message}. Serve the built dist directory over HTTP (see README), then reload.`;
    $('stats').innerHTML='<p>Archive data unavailable</p>';
  }
}
start();
