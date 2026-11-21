export function searchShow(show, q, songs) {
  const scopes=[...new Set(show.sets.map(b=>b.performance||'unspecified'))];
  if(scopes.length>1){for(const scope of scopes){const hit=searchShow({...show,sets:show.sets.filter(b=>(b.performance||'unspecified')===scope)},q,songs);if(hit)return hit;}return null;}
  const scopeLabel=scopes[0]&&scopes[0]!=='unspecified'?scopes[0][0].toUpperCase()+scopes[0].slice(1)+' show · ':'';
  const evidence=[];
  const main=n=>show.sets.find(b=>b.kind==='main'&&b.ordinal===n);
  const usable=e=>e.type==='performance'&&!e.flags.includes('possible_cut_or_gap');
  for(const [n,id] of [[1,q.opener1],[2,q.opener2]]) {
    if(!id)continue;
    const b=main(n), e=b?.entries.find(e=>e.type!=='non_music');
    if(!b?.start_boundary_explicit||!e||(e.flags.includes('possible_cut_or_gap')&&e.type!=='reported_missing')||!['song',undefined].includes(songs[e.song_id]?.kind)||e.song_id!==id)return null;
    evidence.push({label:`Set ${n} opener`,entries:[e],reportedOnly:e.type==='reported_missing'});
  }
  if(q.encore){
    const e=show.sets.filter(b=>b.kind==='encore').flatMap(b=>b.entries).find(e=>e.song_id===q.encore);
    if(!e)return null;
    evidence.push({label:'Encore',entries:[e],reportedOnly:e.type==='reported_missing'});
  }
  if(q.sequence?.length){
    let hit=null;
    for(const b of show.sets){
      if(q.scope==='1'&&!(b.kind==='main'&&b.ordinal===1)||q.scope==='2'&&!(b.kind==='main'&&b.ordinal===2)||q.scope==='encore'&&b.kind!=='encore')continue;
      const entries=b.entries.filter(e=>e.type!=='non_music');
      for(let start=0;start<entries.length;start++){
        if(entries[start].song_id!==q.sequence[0]||!usable(entries[start]))continue;
        const matched=[entries[start]];let end=start,failed=false;
        for(const id of q.sequence.slice(1)){
          let i=end+1;
          while(q.mode==='ordered'&&i<entries.length&&usable(entries[i])&&entries[i].song_id!==id)i++;
          if(i>=entries.length||!usable(entries[i])||entries[i].song_id!==id){failed=true;break;}
          matched.push(entries[i]);end=i;
        }
        if(!failed&&(!(q.segue||b.kind==='unknown')||entries.slice(start,end).every(e=>e.transition_to_next==='documented_arrow'))){hit={label:b.kind==='unknown'?'Documented passage · set unknown':b.kind==='encore'?'Encore sequence':`Set ${b.ordinal} sequence`,entries:matched};break;}
      }
      if(hit)break;
    }
    if(!hit)return null;
    evidence.push(hit);
  }
  return evidence.map(f=>({...f,label:scopeLabel+f.label}));
}
