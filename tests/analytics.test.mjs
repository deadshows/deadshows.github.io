import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeState, ratedSource, selectShows, songStatistics, timelineBins, showBins, yearDensity, relistenUrl} from '../public/analytics.mjs';
const history={eras:[{id:'wall',start:'1974-03-23',end:'1974-10-20'}],members:[{id:'keith'}]};
const shows=[
  {id:'a',date:'1974-06-23',venue:'Jai-Alai',location:'Miami',song_ids:['dark-star'],member_ids:['keith'],recording_count:5,rated_sources:[{id:'one',count:6,adjusted:4.9},{id:'two',count:60,adjusted:4.8}]},
  {id:'b',date:'1974-06-24',venue:'Jai-Alai',location:'Miami',song_ids:['bertha'],member_ids:['keith'],recording_count:3,rated_sources:[]},
  {id:'c',date:'1974-06-25',venue:'Other',location:'Miami',song_ids:[],member_ids:['keith'],recording_count:1,rated_sources:[]},
  {id:'d',date:'1977-05-08',venue:'Barton Hall',location:'Ithaca',song_ids:['bertha'],member_ids:['keith'],recording_count:9,rated_sources:[]}
];
const state={from:1965,to:1995,era:'',song:'',member:'',search:'',sort:'date',minimum:5};
test('frequency denominator omits index-only dates',()=>{
  const stats=songStatistics(shows.slice(0,3),'dark-star');
  assert.equal(stats.denominator,2);assert.equal(stats.count,1);assert.equal(stats.frequency,.5);
});
test('missing sample is null, not zero frequency',()=>assert.equal(songStatistics([shows[2]],'dark-star').frequency,null));
test('era, member and song filters intersect',()=>assert.deepEqual(selectShows(shows,{...state,era:'wall',member:'keith',song:'bertha'},history).map(s=>s.id),['b']));
test('venue and location search case insensitive',()=>assert.equal(selectShows(shows,{...state,search:'ITHACA'},history)[0].id,'d'));
test('rating threshold recomputes eligible recording, not just previous best',()=>assert.equal(ratedSource(shows[0],50).id,'two'));
test('rating ranking excludes unrated dates',()=>assert.deepEqual(selectShows(shows,{...state,sort:'rating'},history).map(s=>s.id),['a']));
test('rating sort does not alter repertoire denominator when ignored',()=>assert.equal(selectShows(shows,{...state,sort:'rating'},history,{ignoreSort:true}).length,4));
test('URL input clamped, ordered and validated',()=>{
  const s=normalizeState(new URLSearchParams('from=2000&to=1900&song=bad&min=3&era=wall'),{history,songs:[]});
  assert.equal(s.from,1965);assert.equal(s.to,1995);assert.equal(s.song,'');assert.equal(s.minimum,5);assert.equal(s.era,'wall');
});
test('date filtering includes both boundary dates',()=>assert.equal(selectShows(shows,{...state,from:1974,to:1974},history).length,3));
test('timeline keeps unknown periods distinct from observed zeroes',()=>{
  const bins=timelineBins(shows,'dark-star',{from:1974,to:1977});
  assert.deepEqual(bins.map(b=>[b.key,b.count,b.evidence,b.total,b.frequency]),[
    ['1974',1,2,3,.5],['1975',0,0,0,null],['1976',0,0,0,null],['1977',0,1,1,0]
  ]);
});
test('monthly bins include calendar boundaries and count dates once',()=>{
  const sample=[{...shows[0],date:'1974-01-01',song_ids:['dark-star','dark-star']},{...shows[1],date:'1974-12-31'}];
  const bins=timelineBins(sample,'dark-star',{from:1974,to:1974,granularity:'month'});
  assert.equal(bins.length,12);assert.equal(bins[0].key,'1974-01');assert.equal(bins[0].count,1);
  assert.equal(bins[11].key,'1974-12');assert.equal(bins[11].evidence,1);assert.equal(bins[11].count,0);
});
test('month selection intersects existing filters and can be ignored for context',()=>{
  const selected={...state,month:'1974-06',song:'bertha',era:'wall'};
  assert.deepEqual(selectShows(shows,selected,history).map(s=>s.id),['b']);
  assert.equal(selectShows(shows,{...state,month:'1974-07'},history).length,0);
  assert.equal(selectShows(shows,{...state,month:'1974-07'},history,{ignoreMonth:true}).length,4);
});
test('URL preserves timeline choices and rejects invalid or out-of-range months',()=>{
  const data={history,songs:[{id:'dark-star'}]};
  const valid=normalizeState(new URLSearchParams('from=1974&to=1974&month=1974-06&bins=month&metric=frequency&song=dark-star'),data);
  assert.equal(valid.month,'1974-06');assert.equal(valid.granularity,'month');assert.equal(valid.metric,'frequency');
  for(const month of ['1974-13','1974-00','1973-06','garbage']) assert.equal(normalizeState(new URLSearchParams(`from=1974&to=1974&month=${month}`),data).month,'');
});
test('timeline sample and coverage remain stable when ranking omits unrated matches',()=>{
  const selected={...state,song:'bertha',sort:'rating'};
  assert.equal(selectShows(shows,selected,history).length,0);
  const context=selectShows(shows,selected,history,{ignoreSong:true,ignoreSort:true});
  const year=timelineBins(context,'bertha').find(b=>b.key==='1974');
  assert.equal(year.count,1);assert.equal(year.evidence,2);assert.equal(year.frequency,.5);
});

test('multiple membership windows support intersection and union',()=>{
  const sample=[{...shows[0],member_ids:['keith','mickey']},{...shows[1],member_ids:['keith']},{...shows[2],member_ids:['mickey']}];
  assert.deepEqual(selectShows(sample,{...state,members:['keith','mickey'],memberMode:'all'},history).map(s=>s.id),['a']);
  assert.equal(selectShows(sample,{...state,members:['keith','mickey'],memberMode:'any'},history).length,3);
  assert.equal(selectShows(sample,{...state,members:[],memberMode:'all'},history).length,3);
});
test('personnel URL accepts repeated and comma-separated IDs without unknowns or duplicates',()=>{
  const data={history:{...history,members:[{id:'keith'},{id:'mickey'}]},songs:[]};
  const selected=normalizeState(new URLSearchParams('member=mickey&member=keith,mickey,bad&member_match=any'),data);
  assert.deepEqual(selected.members,['keith','mickey']);assert.equal(selected.memberMode,'any');
  assert.deepEqual(normalizeState(new URLSearchParams('member=keith'),data).members,['keith']);
});
test('a twelve-month window crosses years without including dates outside it',()=>{
  const data={history,songs:[]};
  const selected=normalizeState(new URLSearchParams('bins=month&window=1974-07'),data);
  assert.equal(selected.from,1974);assert.equal(selected.to,1975);
  const sample=['1974-06-30','1974-07-01','1975-06-30','1975-07-01'].map((date,i)=>({...shows[0],date,id:String(i)}));
  assert.deepEqual(selectShows(sample,selected,history).map(s=>s.id),['1','2']);
  const bins=timelineBins(sample,'dark-star',{granularity:'month',windowStart:selected.windowStart});
  assert.equal(bins.length,12);assert.equal(bins[0].key,'1974-07');assert.equal(bins.at(-1).key,'1975-06');
  assert.equal(bins.reduce((n,b)=>n+b.count,0),2);
  assert.equal(selectShows(sample,selected,history,{ignoreYears:true}).length,4);
});
test('rolling windows clamp to archive boundaries and reject months outside the window',()=>{
  const data={history,songs:[]};
  assert.equal(normalizeState(new URLSearchParams('bins=month&window=1964-12'),data).windowStart,'1965-01');
  assert.equal(normalizeState(new URLSearchParams('bins=month&window=1995-12'),data).windowStart,'1995-01');
  const invalid=normalizeState(new URLSearchParams('bins=month&window=1974-07&month=1975-07'),data);
  assert.equal(invalid.month,'');
  const valid=normalizeState(new URLSearchParams('bins=month&window=1974-07&month=1975-06'),data);
  assert.equal(valid.month,'1975-06');
});
test('monthly window denominators remain independent of rating ranking',()=>{
  const selected={...state,from:1974,to:1975,granularity:'month',windowStart:'1974-06',song:'bertha',sort:'rating'};
  const context=selectShows(shows,selected,history,{ignoreSong:true,ignoreSort:true});
  assert.equal(songStatistics(context,'bertha').denominator,2);
  assert.equal(songStatistics(context,'bertha').frequency,.5);
  assert.equal(selectShows(shows,selected,history).length,0);
});

test('show bins distinguish observed, not observed and unknown evidence',()=>{
  const groups=showBins(shows,'dark-star','1974-06');
  assert.equal(groups.length,12);
  assert.deepEqual(groups[0].shows.map(row=>[row.showId,row.value,row.evidence]),[['a',1,true],['b',0,true],['c',null,false]]);
  assert.equal(groups[1].shows.length,0);
  assert.equal(groups.flatMap(group=>group.shows).length,3);
});
test('show bins count each show rather than its recording sources and cross year boundaries',()=>{
  const sample=[{...shows[0],id:'first',date:'1974-12-31',song_ids:['bertha','bertha','dark-star'],recording_count:50},
    {...shows[1],id:'last',date:'1975-11-30'}, {...shows[0],id:'outside',date:'1975-12-01'}];
  const groups=showBins(sample,'','1974-12');
  assert.equal(groups[0].key,'1974-12');assert.equal(groups.at(-1).key,'1975-11');
  assert.equal(groups[0].shows[0].value,2);
  assert.deepEqual(groups.flatMap(group=>group.shows).map(row=>row.showId),['first','last']);
});
test('distinct event identities on the same date remain individually openable',()=>{
  const sample=[{...shows[0],id:'late'},{...shows[0],id:'early'}];
  const rows=showBins(sample,'dark-star','1974-01')[5].shows;
  assert.deepEqual(rows.map(row=>row.showId),['early','late']);
});

test('ranking is the default while explicit chronological links remain valid',()=>{
  const data={history,songs:[]};
  assert.equal(normalizeState(new URLSearchParams(),data).sort,'rating');
  assert.equal(normalizeState(new URLSearchParams('sort=date'),data).sort,'date');
});
test('year mini histograms retain twelve months, gaps and song evidence',()=>{
  const bins=yearDensity(shows,'dark-star');
  assert.equal(bins[1974].length,12);
  assert.equal(bins[1974][0].frequency,null);
  assert.deepEqual([bins[1974][5].total,bins[1974][5].evidence,bins[1974][5].count],[3,2,1]);
  assert.equal(bins[1974].reduce((n,m)=>n+m.count,0),1);
});
test('Relisten uses HTTPS universal links with a web destination',()=>{
  assert.equal(relistenUrl('1977-05-08'),'https://relisten.net/grateful-dead/1977/05/08');
  assert.throws(()=>relistenUrl('bad/date'));
});
