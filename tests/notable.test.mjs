import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const notes=JSON.parse(readFileSync(new URL('../data/curated/notable_shows.json',import.meta.url))).shows;
const catalog=JSON.parse(readFileSync(new URL('../public/data/catalog.json',import.meta.url)));
test('historical notes resolve to real date groups and cite HTTPS sources',()=>{
 assert.equal(new Set(notes.map(n=>n.show_id)).size,notes.length);
 for(const n of notes){
  assert.equal(catalog.shows.find(s=>s.id===n.show_id)?.date,n.date);
  assert.ok(n.title && n.blurb && n.category);
  assert.equal(new URL(n.source).protocol,'https:');
 }
 assert.deepEqual(catalog.notable_shows.shows,notes);
});
test('Beach Boys note distinguishes the guest segment from the whole concert',()=>{
 const note=notes.find(n=>n.show_id==='gd-1971-04-27');
 assert.match(note.title,/Beach Boys/);
 assert.match(note.blurb,/without the Dead/);
});
test('festival and multi-night additions use separate indexed dates',()=>{
 for(const date of ['1969-08-16','1973-07-27','1973-07-28','1978-09-14','1978-09-15','1978-09-16','1989-10-08','1989-10-09']) {
  assert.ok(notes.find(n=>n.show_id===`gd-${date}`),date);
 }
 assert.match(notes.find(n=>n.date==='1973-07-27').title,/soundcheck/);
 assert.match(notes.find(n=>n.date==='1989-10-08').blurb,/Help on the Way/);
 assert.match(notes.find(n=>n.date==='1989-10-09').blurb,/Attics of My Life/);
});
test('Columbia is a sourced event without fabricated tape or song evidence',()=>{
 const show=catalog.shows.find(s=>s.id==='gd-1968-05-03');
 assert.equal(show.venue,'Low Library Plaza, Columbia University');
 assert.equal(show.status,'verified_event');
 assert.equal(show.recording_count,0);
 assert.equal(show.metadata_imported,false);
 assert.deepEqual(show.song_ids,[]);
 assert.equal(show.best_recording,null);
});
test('Human Be-In uses the sourced venue while retaining attribution uncertainty',()=>{
 const show=catalog.shows.find(s=>s.id==='gd-1967-01-14');
 assert.equal(show.venue,'Polo Field, Golden Gate Park');
 assert.equal(show.recording_count,2);
 assert.equal(show.completeness,'recording_evidence');
 assert.ok(show.warnings.some(w=>w.includes('Fillmore Auditorium')&&w.includes('not a verified')));
});

test('Celtics notes cover both nights and preserve the supplied video links',()=>{
 const note=notes.find(n=>n.show_id==='gd-1985-11-04');
 assert.match(note.blurb,/returned for the following night/);
 const birthday=notes.find(n=>n.show_id==='gd-1985-11-05');
 assert.match(birthday.title,/birthday/);
 assert.deepEqual(birthday.links,note.links);
 assert.ok(note.links.some(link=>link.url==='https://www.youtube.com/watch?v=QMH4Ho0cQBc'));
 assert.ok(note.links.some(link=>link.url==='https://www.youtube.com/watch?v=Sc-Wh50Pt4Q'));
 for(const n of notes) for(const link of n.links||[]) assert.equal(new URL(link.url).protocol,'https:');
});
test('Lithuanian basketball note retains the dated interview and schedule corroboration',()=>{
 const note=notes.find(n=>n.show_id==='gd-1992-03-24');
 assert.match(note.blurb,/2022 interview-based account/);
 assert.match(note.blurb,/1991/);
 assert.match(note.blurb,/Donnie Nelson/);
 assert.ok(note.links.some(l=>l.url.includes('NBA_1992_games-march')));
 assert.doesNotMatch(note.blurb,/Walton/);
});
