import test from 'node:test';import assert from 'node:assert/strict';import {searchShow} from '../public/sequence-engine.mjs';import fs from 'node:fs';
const song=(id,extra={})=>({song_id:id,type:'performance',flags:[],transition_to_next:'unknown',...extra});
const block=entries=>({kind:'main',ordinal:1,start_boundary_explicit:true,entries});
const data={a:{kind:'song'},b:{kind:'song'},c:{kind:'song'}};
const show=entries=>({sets:[block(entries)]});
test('consecutive differs from ordered',()=>{const s=show([song('a'),song('c'),song('b')]);assert.equal(searchShow(s,{sequence:['a','b'],mode:'consecutive'},data),null);assert.ok(searchShow(s,{sequence:['a','b'],mode:'ordered'},data));});
test('missing tracks cannot create a match across a gap',()=>{assert.equal(searchShow(show([song('a'),song('c',{type:'reported_missing'}),song('b')]),{sequence:['a','b'],mode:'ordered'},data),null);});
test('cuts block sequence matching',()=>{assert.equal(searchShow(show([song('a',{flags:['possible_cut_or_gap']}),song('b')]),{sequence:['a','b']},data),null);});
test('segues require actual source arrows',()=>{let s=show([song('a'),song('b')]);assert.equal(searchShow(s,{sequence:['a','b'],segue:true},data),null);s.sets[0].entries[0].transition_to_next='documented_arrow';assert.ok(searchShow(s,{sequence:['a','b'],segue:true},data));});
test('stage talk is not the opener',()=>assert.ok(searchShow(show([song(null,{type:'non_music'}),song('a')]),{opener1:'a'},data)));
test('unknown initial boundary cannot establish opener',()=>{const s=show([song('a')]);s.sets[0].start_boundary_explicit=false;assert.equal(searchShow(s,{opener1:'a'},data),null);});
test('conditions are combined with AND',()=>assert.equal(searchShow(show([song('a'),song('b')]),{opener1:'a',encore:'b'},data),null));
test('scope and set boundaries are respected',()=>{const s={sets:[block([song('a')]),{kind:'main',ordinal:2,entries:[song('b')]}]};assert.equal(searchShow(s,{sequence:['a','b']},data),null);assert.equal(searchShow(show([song('a'),song('b')]),{sequence:['a','b'],scope:'2'},data),null);});
test('real China Rider and Help Slip Franklin evidence',()=>{const p=JSON.parse(fs.readFileSync(new URL('../data/release/setlists.json',import.meta.url)));assert.ok(searchShow(p.shows.find(s=>s.date==='1977-12-29'),{sequence:['china-cat-sunflower','i-know-you-rider']},p.songs));assert.ok(searchShow(p.shows.find(s=>s.date==='1977-05-09'),{sequence:['help-on-the-way','slipknot','franklins-tower'],scope:'1',segue:true},p.songs));});
import {timelineDensity,inWindow,monthIndex,monthKey} from '../public/sequence-timeline.mjs';
test('density keeps unavailable years distinct from indexed zero matches',()=>{const rows=timelineDensity([{id:'a',date:'1977-05-08'},{id:'b',date:'1977-05-09'}],[{id:'a'}],1976,1978);assert.equal(rows[0].available,false);assert.equal(rows[1].available,true);assert.equal(rows[1].months.length,12);assert.deepEqual(rows[1].months[4],{key:'1977-05',total:2,count:1});assert.equal(rows[1].months[0].count,0);});
test('rolling histogram window crosses year boundaries and excludes thirteenth month',()=>{assert.equal(inWindow('1978-06-30','1977-07'),true);assert.equal(inWindow('1978-07-01','1977-07'),false);assert.equal(inWindow('1977-06-30','1977-07'),false);});
test('month slider values round trip across years',()=>{assert.equal(monthKey(monthIndex('1977-12')+1),'1978-01');assert.equal(monthKey(monthIndex('1965-01')),'1965-01');});

test('cut first track does not establish a set opener',()=>{assert.equal(searchShow(show([song('a',{flags:['possible_cut_or_gap']})]),{opener1:'a'},data),null);});

test('unknown sets require documented arrows even without segue checkbox',()=>{const s=show([song('a'),song('b')]);s.sets[0].kind='unknown';s.sets[0].start_boundary_explicit=false;assert.equal(searchShow(s,{sequence:['a','b'],scope:'any'},data),null);s.sets[0].entries[0].transition_to_next='documented_arrow';assert.ok(searchShow(s,{sequence:['a','b'],scope:'any'},data));assert.equal(searchShow(s,{sequence:['a','b'],scope:'1'},data),null);assert.equal(searchShow(s,{opener1:'a'},data),null);});

test('source-listed missing opener is labelled as reported evidence',()=>{const result=searchShow(show([song('a',{type:'reported_missing',flags:['possible_cut_or_gap']})]),{opener1:'a'},data);assert.equal(result[0].reportedOnly,true);});

test('opener and encore cannot be combined across early and late shows',()=>{const s={sets:[{...block([song('a')]),performance:'early'},{kind:'encore',ordinal:1,performance:'late',entries:[song('b')]}]};assert.equal(searchShow(s,{opener1:'a',encore:'b'},data),null);s.sets.push({kind:'encore',ordinal:1,performance:'early',entries:[song('b')]});assert.ok(searchShow(s,{opener1:'a',encore:'b'},data));});
