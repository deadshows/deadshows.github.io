import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeState,selectShows} from '../public/analytics.mjs';
const catalog=JSON.parse(readFileSync(new URL('../public/data/catalog.json',import.meta.url)));
const source=JSON.parse(readFileSync(new URL('../data/curated/guests.json',import.meta.url)));
const selection=q=>normalizeState(new URLSearchParams(q),catalog);
test('guest appearances preserve sourced scope and map to indexed dates',()=>{
 assert.deepEqual(catalog.guests,source);
 const seen=new Set();
 for(const a of source.appearances){
  const key=a.show_id+':'+a.guest_id;assert.ok(!seen.has(key));seen.add(key);
  const show=catalog.shows.find(s=>s.id===a.show_id);
  assert.ok(show?.guest_ids.includes(a.guest_id));
  assert.ok(show.guest_appearances.some(x=>x.guest_id===a.guest_id));
  assert.ok(source.people.some(p=>p.id===a.guest_id));
  assert.ok(a.scope);assert.equal(new URL(a.source_url).protocol,'https:');
 }
});
test('guest URL accepts indexed IDs and rejects unknown guests',()=>{
 assert.equal(selection('guest=branford-marsalis').guest,'branford-marsalis');
 assert.equal(selection('guest=unknown').guest,'');
});
test('guest filter finds cited dates and intersects year and personnel filters',()=>{
 const state=selection('guest=branford-marsalis&sort=date');
 const select=s=>selectShows(catalog.shows,s,catalog.history);
 assert.deepEqual(select(state).map(s=>s.date),['1990-03-29','1991-09-10']);
 assert.deepEqual(select({...state,from:1991,to:1991}).map(s=>s.date),['1991-09-10']);
 assert.deepEqual(select({...state,members:['pigpen']}).map(s=>s.date),[]);
 assert.equal(select({...state,song:'nonexistent'}).length,0);
});
test('band windows, opening acts and backstage guests do not become sit-ins',()=>{
 const ids=source.people.map(p=>p.id);
 assert.ok(!ids.includes('bill-walton'));
 assert.ok(!ids.includes('ornette-coleman'));
 assert.ok(!catalog.shows.find(s=>s.date==='1991-03-17').guest_ids.includes('bruce-hornsby'));
 assert.ok(catalog.shows.find(s=>s.date==='1988-09-24').guest_ids.includes('bruce-hornsby'));
 assert.ok(!catalog.shows.find(s=>s.date==='1985-11-04').guest_ids.length);
});
test('all five new guest historical notes resolve to indexed guests',()=>{
 for(const date of ['1970-02-11','1972-03-25','1988-09-24','1988-12-31','1991-09-10']) {
  assert.ok(catalog.notable_shows.shows.some(n=>n.date===date));
  assert.ok(catalog.shows.find(s=>s.date===date).guest_ids.length);
 }
});
