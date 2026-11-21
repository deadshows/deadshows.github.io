/** Pure selection/statistics functions, shared by the explorer and regression tests. */
export function anniversaryShows(shows, monthDay) {
  return shows.filter(s => s.date.slice(5) === monthDay).map(show => ({show, rating: ratedSource(show, 5)}))
    .sort((a,b) => (b.rating?.adjusted ?? -1) - (a.rating?.adjusted ?? -1) || (b.rating?.count ?? 0) - (a.rating?.count ?? 0) || a.show.date.localeCompare(b.show.date));
}
export function ratedSource(show, minimum = 5) {
  return (show.rated_sources || []).filter(r => r.count >= minimum && Number.isFinite(r.adjusted))
    .sort((a, b) => b.adjusted - a.adjusted || b.count - a.count || a.id.localeCompare(b.id))[0] || null;
}
export function selectShows(shows, state, history, {ignoreSong = false, ignoreYears = false, ignoreSort = false, ignoreMonth = false} = {}) {
  const era = history.eras.find(e => e.id === state.era);
  const members = state.members ?? (state.member ? [state.member] : []);
  const window = state.granularity === 'month' && state.windowStart ? rollingWindow(state.windowStart) : null;
  const search = (state.search || '').trim().toLocaleLowerCase();
  const result = shows.filter(s => {
    const year = Number(s.date.slice(0, 4));
    return (ignoreYears || (year >= state.from && year <= state.to && (!window || (s.date.slice(0,7) >= window.start && s.date.slice(0,7) <= window.end)))) &&
      (ignoreMonth || !state.month || s.date.startsWith(state.month)) &&
      (!era || s.date >= era.start && s.date <= era.end) &&
      (!members.length || (state.memberMode === 'any' ? members.some(id => s.member_ids.includes(id)) : members.every(id => s.member_ids.includes(id)))) &&
      (!state.guest || (s.guest_ids || []).includes(state.guest)) &&
      (ignoreSong || !state.song || s.song_ids.includes(state.song)) &&
      (!search || `${s.date} ${s.venue} ${s.location}`.toLocaleLowerCase().includes(search)) &&
      (ignoreSort || state.sort !== 'rating' || ratedSource(s, state.minimum));
  });
  return result.sort((a, b) => {
    if (!ignoreSort && state.sort === 'rating') {
      return ratedSource(b, state.minimum).adjusted - ratedSource(a, state.minimum).adjusted || a.date.localeCompare(b.date);
    }
    if (!ignoreSort && state.sort === 'sources') return b.recording_count - a.recording_count || a.date.localeCompare(b.date);
    return a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
  });
}
export function songStatistics(shows, songId) {
  const eligible = shows.filter(s => s.song_ids.length > 0);
  const observed = eligible.filter(s => s.song_ids.includes(songId)).sort((a, b) => a.date.localeCompare(b.date));
  return {denominator: eligible.length, count: observed.length, frequency: eligible.length ? observed.length / eligible.length : null,
    first: observed[0]?.date || null, last: observed.at(-1)?.date || null};
}
export function yearCounts(shows) {
  return Array.from({length: 31}, (_, n) => {
    const year = 1965 + n;
    const matches = shows.filter(s => Number(s.date.slice(0, 4)) === year);
    return {year, count: matches.length, evidence: matches.filter(s => s.song_ids.length).length};
  });
}
/** One date counts once, even if a song is repeated or has multiple recordings. */
export function timelineBins(shows, songId = '', {from = 1965, to = 1995, granularity = 'year', windowStart = ''} = {}) {
  const bins = new Map();
  for (let year = from; year <= to; year++) {
    for (let month = 1; month <= (granularity === 'month' ? 12 : 1); month++) {
      const key = granularity === 'month' ? `${year}-${String(month).padStart(2, '0')}` : String(year);
      bins.set(key, {key, year, total: 0, evidence: 0, count: 0, frequency: null});
    }
  }
  if (granularity === 'month' && windowStart) {
    const window = rollingWindow(windowStart);
    bins.clear();
    for (let i = 0; i < 12; i++) {
      const key = monthKey(window.index + i);
      bins.set(key, {key, year:Number(key.slice(0,4)), total:0, evidence:0, count:0, frequency:null});
    }
  }
  for (const show of shows) {
    const bin = bins.get(show.date.slice(0, granularity === 'month' ? 7 : 4));
    if (!bin) continue;
    bin.total++;
    if (show.song_ids.length) bin.evidence++;
    if (!songId || show.song_ids.includes(songId)) bin.count++;
  }
  for (const bin of bins.values()) bin.frequency = bin.evidence && songId ? bin.count / bin.evidence : null;
  return [...bins.values()];
}
/** One bin per reported show/date group, grouped under twelve calendar months. */
export function showBins(shows, songId, windowStart) {
  const window = rollingWindow(windowStart);
  const groups = Array.from({length:12},(_,i)=>({key:monthKey(window.index+i),shows:[]}));
  const lookup = new Map(groups.map(group=>[group.key,group]));
  for (const show of [...shows].sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id))) {
    const group=lookup.get(show.date.slice(0,7));
    if(!group) continue;
    const evidence=show.song_ids.length>0, observed=!!songId&&show.song_ids.includes(songId);
    group.shows.push({key:show.id,showId:show.id,date:show.date,venue:show.venue,location:show.location,
      evidence,observed,value:evidence?(songId?Number(observed):new Set(show.song_ids).size):null});
  }
  return groups;
}
/** Month offsets avoid local-time and daylight-saving arithmetic. */
export function monthKey(index) {
  return `${1965 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}`;
}
export function rollingWindow(start) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(start));
  const index = match ? Math.max(0, Math.min(360, (Number(match[1]) - 1965) * 12 + Number(match[2]) - 1)) : 0;
  return {index, start:monthKey(index), end:monthKey(index + 11), from:1965 + Math.floor(index/12), to:1965 + Math.floor((index+11)/12)};
}
export function normalizeState(params, data) {
  let from = Number(params.get('from') || 1965), to = Number(params.get('to') || 1995);
  from = Number.isInteger(from) ? Math.max(1965, Math.min(1995, from)) : 1965;
  to = Number.isInteger(to) ? Math.max(1965, Math.min(1995, to)) : 1995;
  if (from > to) [from, to] = [to, from];
  const valid = (key, values) => values.includes(params.get(key)) ? params.get(key) : '';
  const granularity = valid('bins', ['year','month']) || 'year';
  const window = granularity === 'month' ? rollingWindow(params.get('window') || `${from}-01`) : null;
  if (window) ({from, to} = window);
  const monthParam = params.get('month') || '';
  const month = /^(19[6-9]\d)-(0[1-9]|1[0-2])$/.test(monthParam) && Number(monthParam.slice(0,4)) >= from && Number(monthParam.slice(0,4)) <= to && (!window || monthParam >= window.start && monthParam <= window.end) ? monthParam : '';
  const requested = new Set(params.getAll('member').flatMap(value => value.split(',')));
  const members = data.history.members.filter(m => requested.has(m.id)).map(m => m.id);
  return {from, to, month, granularity, windowStart:window?.start || '', metric:valid('metric',['count','frequency']) || 'count',
    guest:valid('guest',(data.guests?.people || []).map(p=>p.id)),
    song:valid('song',data.songs.map(s=>s.id)), members, member:members.length===1?members[0]:'', memberMode:params.get('member_match')==='any'?'any':'all',
    era:valid('era',data.history.eras.map(e=>e.id)), search:(params.get('q') || '').slice(0,200),
    sort:valid('sort',['date','rating','sources']) || 'rating', minimum:[5,10,25,50].includes(Number(params.get('min')))?Number(params.get('min')):5};
}

/** Twelve calendar bins per year, sharing the yearly selection semantics. */
export function yearDensity(shows, songId) {
  return timelineBins(shows, songId, {from:1965,to:1995,granularity:'month'})
    .reduce((groups,row)=>{(groups[row.year] ||= []).push(row);return groups;},{});
}

export function relistenUrl(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid show date');
  return `https://relisten.net/grateful-dead/${date.replaceAll('-','/')}`;
}

export function birthdaysOn(members, monthDay) {
  return members.filter(m => m.birth_date?.slice(5) === monthDay);
}
