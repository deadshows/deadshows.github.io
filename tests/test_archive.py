import importlib.util
import hashlib
import json
from pathlib import Path
import sqlite3
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('archive_build', ROOT / 'scripts/build.py')
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class EvidenceTests(unittest.TestCase):
    def test_derivative_formats_not_counted_as_more_tracks(self):
        payload = {'files': [
            {'name': 'gd-d1t02.shn', 'source': 'original', 'title': 'Dark Star'},
            {'name': 'gd-d1t01.shn', 'source': 'original', 'title': 'Bertha'},
            {'name': 'gd-d1t02.mp3', 'source': 'derivative', 'title': 'Dark Star'},
            {'name': 'gd-d1t02.ogg', 'source': 'derivative', 'title': 'Dark Star'},
        ]}
        self.assertEqual([f['title'] for f in build.extract_tracks(payload)], ['Bertha', 'Dark Star'])

    def test_missing_original_title_uses_only_explicitly_linked_derivative(self):
        payload = {'files': [
            {'name': 'a.shn', 'source': 'original'},
            {'name': 'a.mp3', 'source': 'derivative', 'original': 'a.shn', 'title': 'Dark Star'},
            {'name': 'b.mp3', 'source': 'derivative', 'original': 'b.shn', 'title': 'Bertha'}
        ]}
        tracks = build.extract_tracks(payload)
        self.assertEqual(len(tracks), 1)
        self.assertEqual(tracks[0]['title'], 'Dark Star')

    def test_track_number_and_encore_prefixes_do_not_create_new_songs(self):
        self.assertEqual(build.clean_title('02 I Know You Rider ->'), 'I Know You Rider')
        self.assertEqual(build.clean_title('E: U.S. Blues'), 'U.S. Blues')

    def test_recording_prefix_keeps_an_explicit_title_but_does_not_guess_from_a_filename(self):
        aliases = {build.key('Might As Well'): 'might-as-well'}
        self.assertEqual(build.resolve_title('gd77-05-01 t01 Might As Well', aliases, {}), ('might-as-well', 'matched'))
        self.assertEqual(build.resolve_title('gd1977-05-01d1t01.flac', aliases, {}), (None, 'unresolved'))

    def test_source_filename_order_is_natural(self):
        payload = {'files': [{'name': f'gd-d{d}t{t}.flac', 'source': 'original'} for d, t in [(2, 1), (1, 10), (1, 2)]]}
        self.assertEqual([f['name'] for f in build.extract_tracks(payload)], ['gd-d1t2.flac', 'gd-d1t10.flac', 'gd-d2t1.flac'])

    def test_composite_derivative_does_not_assign_its_title_to_each_source(self):
        payload = {'files': [
            {'name': 'a.flac', 'source': 'original'},
            {'name': 'b.flac', 'source': 'original'},
            {'name': 'mix.mp3', 'source': 'derivative', 'original': ['a.flac', 'b.flac'], 'title': 'A combined mix'},
            {'name': 'a.ogg', 'source': 'derivative', 'original': ['a.flac'], 'title': 'Bertha'},
        ]}
        tracks = build.extract_tracks(payload)
        self.assertEqual(tracks[0]['title'], 'Bertha')
        self.assertNotIn('title', tracks[1])

    def test_compound_track_not_invented_as_one_song(self):
        songs = {}
        self.assertEqual(build.resolve_title('Scarlet Begonias > Fire On The Mountain', {}, songs), (None, 'compound_unresolved'))
        self.assertEqual(songs, {})

    def test_reprise_alias_and_trailing_segue(self):
        aliases = {build.key("Playin' In The Band Reprise"): 'playing-in-the-band'}
        self.assertEqual(build.resolve_title("Playin' In The Band Reprise ->", aliases, {})[0], 'playing-in-the-band')

    def test_tuning_not_a_song(self):
        for title in ['Tuning and crowd', 'Tune Up', 'Equipment Repairs', 'More repairs', 'Radio Talk', 'Encore Break', 'Technical Difficulty']:
            self.assertEqual(build.resolve_title(title, {}, {}), (None, 'non_song_or_unresolved'))

    def test_unknown_title_is_provisional(self):
        songs = {}
        sid, status = build.resolve_title('Unreviewed Title', {}, songs)
        self.assertEqual(status, 'candidate')
        self.assertEqual(songs[sid]['status'], 'candidate')

    def test_dates_validate_calendar_and_scope(self):
        for date in ['1977-02-30', '1964-12-31', '1995-07-10', 'unknown']:
            self.assertIsNone(build.valid_date(date))
        self.assertEqual(build.valid_date('1977-05-08T00:00:00Z'), '1977-05-08')

    def test_low_review_perfect_rating_shrinks_toward_prior(self):
        self.assertLess(build.adjusted_rating(5, 1, 4), build.adjusted_rating(4.8, 100, 4))
        self.assertIsNone(build.adjusted_rating(None, 0, 4))

    def test_import_coverage_distinguishes_missing_from_unusable_evidence(self):
        shows = {
            'pending': {'recordings': ['index'], 'song_ids': []},
            'untitled': {'recordings': ['imported'], 'song_ids': []},
            'matched': {'recordings': ['imported', 'index'], 'song_ids': ['dark-star']},
        }
        recordings = {'index': {'enriched': False}, 'imported': {'enriched': True}}
        self.assertEqual(build.import_coverage(shows, recordings), {
            'dates_with_metadata': 2, 'dates_awaiting_metadata': 1,
            'dates_imported_without_song_evidence': 1, 'dates_with_tracks': 1,
        })


class ArchiveIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = json.loads((ROOT / 'public/data/catalog.json').read_text())

    def test_counts_reconcile(self):
        c = self.catalog
        self.assertEqual(len(c['shows']), c['coverage']['date_groups'])
        self.assertEqual(sum(s['recording_count'] for s in c['shows']), c['coverage']['recordings_in_scope'])
        self.assertEqual(sum(y['dates'] for y in c['coverage']['years']), len(c['shows']))
        self.assertEqual(len({s['id'] for s in c['shows']}), len(c['shows']))
        self.assertEqual(sum(s.get('metadata_imported', False) for s in c['shows']), c['coverage']['dates_with_metadata'])
        self.assertEqual(c['coverage']['dates_with_metadata'] + c['coverage']['dates_awaiting_metadata'], len(c['shows']))

    def test_build_versions_code_and_data_to_refresh_cached_clients(self):
        revision = hashlib.sha256(b''.join((ROOT / 'public' / name).read_bytes() for name in ['app.js', 'analytics.mjs', 'albums.mjs', 'point-cloud.mjs', 'assets/rose-graph.json', 'data/catalog.json', 'data/setlists.json', 'sequence-ui.mjs', 'sequence-engine.mjs', 'sequence-timeline.mjs'])).hexdigest()[:12]
        self.assertIn(f'src="app.js?v={revision}"', (ROOT / 'dist/index.html').read_text())
        self.assertIn(f"'./analytics.mjs?v={revision}'", (ROOT / 'dist/app.js').read_text())
        self.assertIn(f'src="sequence-ui.mjs?v={revision}"', (ROOT / 'dist/index.html').read_text())
        self.assertIn(f'data/setlists.json?v={revision}', (ROOT / 'dist/sequence-ui.mjs').read_text())
        for stylesheet in ['style.css', 'theme.css', 'timeline.css', 'sequence.css']:
            style_revision = hashlib.sha256((ROOT / 'public' / stylesheet).read_bytes()).hexdigest()[:12]
            self.assertIn(f'href="{stylesheet}?v={style_revision}"', (ROOT / 'dist/index.html').read_text())

    def test_song_observations_deduplicate_sources_and_reprises(self):
        c = self.catalog
        for s in c['shows']:
            self.assertEqual(len(set(s['song_ids'])), len(s['song_ids']))
        song = next(s for s in c['songs'] if s['id'] == 'dark-star')
        self.assertEqual(song['date_count'], sum('dark-star' in s['song_ids'] for s in c['shows']))
        show = next(s for s in c['shows'] if s['date'] == '1977-05-08')
        self.assertGreater(show['recording_count'], 1)
        detail = json.loads((ROOT / f'public/data/shows/{show["id"]}.json').read_text())
        self.assertTrue(detail['evidence_recording'])
        self.assertGreater(sum(bool(r['tracks']) for r in detail['recordings']), 1)

    def test_every_source_and_song_resolves(self):
        songs = {s['id'] for s in self.catalog['songs']}
        for show in self.catalog['shows']:
            self.assertTrue(set(show['song_ids']) <= songs)
            self.assertTrue((ROOT / f'dist/shows/{show["id"]}/index.html').exists())
        for song in songs:
            self.assertTrue((ROOT / f'dist/songs/{song}/index.html').exists())

    def test_reviewed_exclusions_do_not_leak_into_song_observations(self):
        radio = json.loads((ROOT / 'public/data/shows/gd-1967-04-01.json').read_text())
        self.assertEqual(radio['song_ids'], [])
        harpur = json.loads((ROOT / 'public/data/shows/gd-1970-05-02.json').read_text())
        evidence = harpur['tracks']
        self.assertTrue(all(t['song_id'] is None for t in evidence if 14 <= t['position'] <= 26))
        self.assertNotIn('the-weight', harpur['song_ids'])
        self.assertIn('i-know-you-rider', harpur['song_ids'])

    def test_1977_dates_processed_and_nonconcert_groups_remain_excluded(self):
        shows = [s for s in self.catalog['shows'] if s['date'].startswith('1977')]
        excluded = {'1977-01-01', '1977-02-17', '1977-02-20', '1977-03-01'}
        self.assertEqual({s['date'] for s in shows if not s['song_ids']}, excluded)
        self.assertEqual(sum(bool(s['song_ids']) for s in shows), 60)
        may1 = next(s for s in shows if s['date'] == '1977-05-01')
        self.assertIn('might-as-well', may1['song_ids'])
        self.assertIn('supplication', may1['song_ids'])

    def test_1977_filler_does_not_become_a_song_observation(self):
        detail = json.loads((ROOT / 'public/data/shows/gd-1977-11-04.json').read_text())
        self.assertNotIn('cumberland-blues', detail['song_ids'])
        self.assertNotIn('peggy-o', detail['song_ids'])
        self.assertTrue(all(t['song_id'] is None for t in detail['tracks'] if 22 <= t['position'] <= 27))

    def test_sqlite_has_no_broken_references(self):
        with sqlite3.connect(ROOT / 'data/archive.sqlite') as db:
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])
            self.assertEqual(db.execute('SELECT COUNT(*) FROM recordings').fetchone()[0], self.catalog['coverage']['recordings_in_scope'])

    def test_share_preview_uses_committed_png_and_absolute_url(self):
        import struct
        image=(ROOT/'dist/assets/share-card.png').read_bytes()
        self.assertEqual(image[:8],b'\x89PNG\r\n\x1a\n')
        self.assertEqual(struct.unpack('>II',image[16:24]),(1200,630))
        home=(ROOT/'dist/index.html').read_text()
        self.assertIn('property="og:image" content="https://deadshows.github.io/assets/share-card.png"',home)
        show=(ROOT/'dist/shows/gd-1977-05-08/index.html').read_text()
        self.assertIn('https://deadshows.github.io/assets/share-card.png',show)

    def test_concert_release_dates_and_bonus_material_are_separate(self):
        releases=json.loads((ROOT/'data/curated/concert_releases.json').read_text())['releases']
        self.assertEqual({r['volume'] for r in releases if r['category']=='dicks_picks'},set(range(1,37)))
        self.assertEqual(sum(r['category']=='standalone' for r in releases),15)
        shows={s['date']:s for s in self.catalog['shows']}
        def matches(date,category):
            return {r['id']:r for r in shows[date]['official_releases'] if r['category']==category}
        self.assertEqual(matches('1977-05-08','standalone')['cornell-1977']['coverage'],'complete')
        self.assertNotIn('cornell-1977',matches('1977-05-09','standalone'))
        self.assertEqual(matches('1972-08-27','standalone')['sunshine-daydream']['coverage'],'complete')
        self.assertEqual(matches('1972-04-26','standalone')['hundred-year-hall']['coverage'],'selections')
        self.assertEqual(matches('1977-10-11','dicks_picks')['dicks-picks-29']['coverage'],'bonus')
        self.assertEqual(matches('1980-09-02','dicks_picks')['dicks-picks-21']['coverage'],'bonus')
        self.assertIn('dicks-picks-21',matches('1985-11-01','dicks_picks'))
        self.assertEqual(matches('1991-03-31','dicks_picks')['dicks-picks-17']['coverage'],'bonus')
        for show in self.catalog['shows']:
            for release in show['official_releases']:
                self.assertTrue(release['source_url'].startswith('https://'))
        markup=(ROOT/'dist/index.html').read_text()
        self.assertIn('RELISTEN</th>',markup)
        self.assertIn('DICK’S PICKS</th>',markup)
        self.assertNotIn('>EVIDENCE</th>',markup)

    def test_album_tracks_link_only_to_known_song_identities(self):
        albums=self.catalog['albums']
        self.assertTrue({'garcia','ace','terrapin-station','shakedown-street','go-to-heaven','reckoning','dead-set','in-the-dark'} <= {a['id'] for a in albums})
        self.assertEqual([a['year'] for a in albums],sorted(a['year'] for a in albums))
        known={s['id'] for s in json.loads((ROOT/'data/curated/songs.json').read_text())['songs']}
        for album in albums:
            self.assertTrue(album['wikipedia'].startswith('https://en.wikipedia.org/wiki/'))
            self.assertTrue(album['tracks'] or album.get('tracklist_status')=='source_link')
            for track in album['tracks']:
                self.assertTrue(set(track['song_ids'])<=known)
        ace=next(a for a in albums if a['id']=='ace')
        self.assertEqual(next(t for t in ace['tracks'] if t['title']=='Cassidy')['song_ids'],['cassidy'])
        self.assertEqual(next(t for t in ace['tracks'] if t['title']=='Walk in the Sunshine')['song_ids'],[])

    def test_early_band_and_solo_releases_are_included(self):
        albums={a['id']:a for a in self.catalog['albums']}
        for identifier,year in [('the-grateful-dead',1967),('anthem-of-the-sun',1968),('aoxomoxoa',1969),('skull-and-roses',1971)]:
            self.assertEqual(albums[identifier]['year'],year)
        debut=albums['the-grateful-dead']
        self.assertEqual(len(debut['tracks']),9)
        self.assertEqual(debut['tracks'][7]['song_ids'],['new-minglewood-blues'])
        self.assertEqual(debut['tracklist_status'],'indexed')
        for identifier in ['reflections','tiger-rose','run-for-the-roses']:
            self.assertIn(identifier,albums)
            self.assertEqual(albums[identifier]['tracklist_status'],'source_link')
        self.assertEqual(albums['tales-of-the-great-rum-runners']['tracklist_status'],'indexed')
        self.assertEqual(len(albums['tales-of-the-great-rum-runners']['tracks']),13)
        self.assertEqual(albums['tales-of-the-great-rum-runners']['tracks'][8]['song_ids'],['it-must-have-been-the-roses'])
        self.assertEqual(albums['heaven-help-the-fool']['tracklist_status'],'indexed')
        self.assertEqual(len(albums['heaven-help-the-fool']['tracks']),8)
        self.assertEqual(albums['heaven-help-the-fool']['tracks'][0]['title'],'Bombs Away')
        self.assertEqual(albums['compliments']['tracklist_status'],'indexed')
        self.assertEqual(len(albums['compliments']['tracks']),10)
        self.assertEqual(albums['compliments']['tracks'][0]['title'],'Let It Rock')
        self.assertEqual(albums['rolling-thunder']['tracklist_status'],'indexed')
        self.assertEqual(len(albums['rolling-thunder']['tracks']),10)
        self.assertEqual(albums['rolling-thunder']['tracks'][1]['song_ids'],['playing-in-the-band'])
        self.assertEqual(sum(a['artist']=='Grateful Dead' and a['kind']=='studio' for a in albums.values()),13)
        self.assertEqual(min(a['year'] for a in albums.values()),1967)
        self.assertEqual(max(a['year'] for a in albums.values()),1989)

    def test_indexed_albums_have_observed_song_links(self):
        albums={a['id']:a for a in self.catalog['albums']}
        observed={s['id'] for s in self.catalog['songs'] if s['date_count']>0}
        for album in albums.values():
            if album['tracks'] and album.get('tracklist_status')!='source_link':
                self.assertTrue(any(s in observed for t in album['tracks'] for s in t['song_ids']),album['id'])
        for identifier in ['hooteroll','keith-and-donna','old-and-in-the-way','at-the-edge','planet-drum']:
            self.assertNotIn(identifier,albums)
        for identifier in ['reflections','tiger-rose','run-for-the-roses']:
            self.assertIn(identifier,albums)

    def test_mickey_return_window_includes_1975_through_1990(self):
        mickey=next(m for m in self.catalog['history']['members'] if m['id']=='mickey')
        self.assertEqual(mickey['intervals'][1]['start'],'1974-10-20')
        self.assertEqual(mickey['intervals'][1]['end'],'1995-07-09')
        for year in range(1975,1991):
            self.assertTrue(all('mickey' in s['member_ids'] for s in self.catalog['shows'] if s['date'].startswith(str(year))))

    def test_diga_links_only_documented_happiness_is_drumming(self):
        song_id='happiness-is-drumming'
        self.assertEqual({s['date'] for s in self.catalog['shows'] if song_id in s['song_ids']},{'1976-06-28'})
        album=next(a for a in self.catalog['albums'] if a['id']=='diga')
        self.assertEqual(len(album['tracks']),5)
        self.assertEqual(album['tracks'][1]['song_ids'],[song_id])
        self.assertEqual(album['tracks'][2]['song_ids'],[])
        self.assertNotEqual(song_id,'fire-on-the-mountain')

    def test_rubin_and_cherise_resolves_all_four_imported_dates(self):
        song_id='rubin-and-cherise'
        song=next(s for s in self.catalog['songs'] if s['id']==song_id)
        self.assertEqual(song['date_count'],4)
        self.assertEqual({s['date'] for s in self.catalog['shows'] if song_id in s['song_ids']},
                         {'1991-03-17','1991-03-27','1991-04-07','1991-06-09'})
        album=next(a for a in self.catalog['albums'] if a['id']=='cats-under-the-stars')
        self.assertEqual(len(album['tracks']),8)
        self.assertEqual(album['tracks'][0]['song_ids'],[song_id])
        self.assertEqual(album['tracks'][5]['song_ids'],[])
        curated=next(s for s in build.load(ROOT/'data/curated/songs.json')['songs'] if s['id']==song_id)
        aliases={build.key(a):song_id for a in curated['aliases']}
        for title in ['Rubin And Cherise','Reuben and Cherise','Reuben & Cerise']:
            self.assertEqual(build.resolve_title(title,aliases,{}),(song_id,'matched'))

    def test_album_chronology_extends_through_in_the_dark(self):
        albums={a['id']:a for a in self.catalog['albums']}
        self.assertEqual(albums['shakedown-street']['year'],1978)
        self.assertEqual(albums['go-to-heaven']['year'],1980)
        self.assertEqual(albums['reckoning']['year'],1981)
        self.assertEqual(albums['dead-set']['year'],1981)
        dark=albums['in-the-dark']
        self.assertEqual(dark['year'],1987)
        self.assertEqual([t['song_ids'] for t in dark['tracks']], [
            ['touch-of-grey'],['hell-in-a-bucket'],['when-push-comes-to-shove'],
            ['west-l-a-fadeaway'],['tons-of-steel'],['throwing-stones'],['black-muddy-river']])
        shakedown=albums['shakedown-street']['tracks']
        self.assertEqual(next(t for t in shakedown if t['title']=='All New Minglewood Blues')['song_ids'],['new-minglewood-blues'])
        self.assertEqual(len(albums['reckoning']['tracks']),16)
        self.assertEqual(len(albums['dead-set']['tracks']),15)

    def test_chronology_ends_with_built_to_last_and_its_full_cd_tracklist(self):
        album=next(a for a in self.catalog['albums'] if a['id']=='built-to-last')
        band_studio=[a for a in self.catalog['albums'] if a['artist']=='Grateful Dead' and a['kind']=='studio']
        self.assertEqual(band_studio[-1]['id'],'built-to-last')
        self.assertEqual((album['id'],album['year'],album['kind']),('built-to-last',1989,'studio'))
        self.assertIn('Original CD',album['edition'])
        self.assertEqual([t['song_ids'] for t in album['tracks']], [
            ['foolish-heart'],['just-a-little-light'],['built-to-last'],['blow-away'],
            ['victim-or-the-crime'],['we-can-run'],['standing-on-the-moon'],
            ['picasso-moon'],['i-will-take-you-home']])

    def test_release_does_not_publish_raw_archive_records(self):
        snapshot = json.loads((ROOT / 'data/release/archive.json').read_text())
        item_fields = {'identifier', 'date', 'venue', 'coverage', 'avg_rating',
                       'num_reviews', 'studio_warning', 'nonconcert_suspected', 'rating_date'}
        song_ids = {s['id'] for s in json.loads(
            (ROOT / 'data/curated/songs.json').read_text())['songs']}
        self.assertEqual(set(snapshot), {'retrieved_at', 'reported_total', 'items', 'evidence'})
        self.assertTrue(all(set(item) <= item_fields for item in snapshot['items']))
        for evidence in snapshot['evidence'].values():
            self.assertEqual(set(evidence), {'retrieved_at', 'tracks'})
            for song_id, status in evidence['tracks']:
                if status == 'matched':
                    self.assertIn(song_id, song_ids)
                else:
                    self.assertIsNone(song_id)
        for path in (ROOT / 'dist/data/shows').glob('*.json'):
            detail = json.loads(path.read_text())
            for recording in detail['recordings']:
                self.assertEqual(set(recording), {'id', 'url', 'rating', 'enriched', 'evidence_note'})
            if detail['status'] == 'date_group':
                for track in detail['tracks']:
                    self.assertEqual(set(track), {'position', 'title', 'song_id', 'status'})
                    if track['song_id'] is None and track['status'] != 'excluded_non_concert_or_other_artist':
                        self.assertEqual(track['title'], 'Unidentified track')


if __name__ == '__main__':
    unittest.main()
