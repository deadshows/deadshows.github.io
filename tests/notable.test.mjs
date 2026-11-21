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
