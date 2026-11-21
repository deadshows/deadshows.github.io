import test from 'node:test';
import assert from 'node:assert/strict';
import {anniversaryShows, birthdaysOn} from '../public/analytics.mjs';
test('anniversary ranks eligible recordings and keeps unrated dates as alternatives',()=>{
 const s=(id,date,adjusted,count=5)=>({id,date,rated_sources:[{id,adjusted,count}]});
 const shows=[s('low','1977-11-20',4),s('few','1978-11-20',5,1),s('best','1973-11-20',4.8),s('other','1973-11-21',5)];
 assert.deepEqual(anniversaryShows(shows,'11-20').map(x=>x.show.id),['best','low','few']);
 assert.deepEqual(anniversaryShows(shows,'02-29'),[]);
 assert.equal(anniversaryShows([s('leap','1972-02-29',4)],'02-29').length,1);
});

test('birthday notices match month and day, including multiple members',()=>{
 const people=[{birth_date:'1942-08-01'},{birth_date:'1950-08-01'},{birth_date:'1940-03-15'},{}];
 assert.equal(birthdaysOn(people,'08-01').length,2);
 assert.equal(birthdaysOn(people,'11-20').length,0);
});
