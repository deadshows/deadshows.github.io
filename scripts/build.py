#!/usr/bin/env python3
"""Build the normalized SQLite archive and a dependency-free static website."""
from collections import Counter, defaultdict
import datetime as dt
import hashlib
import html
import json
import math
from pathlib import Path
import re
import shutil
import sqlite3
import unicodedata

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'data/raw/archive'
SNAPSHOT = ROOT / 'data/release/archive.json'
CURATED = ROOT / 'data/curated'
PUBLIC = ROOT / 'public'
PRIOR_STRENGTH = 20


def load(path):
    return json.loads(path.read_text())


def dump(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')


def scalar(value):
    if isinstance(value, list):
        return str(value[0]) if value else ''
    return str(value or '')


def plain(value):
    return html.unescape(re.sub('<[^>]+>', '', scalar(value))).strip()


def key(value):
    value = unicodedata.normalize('NFKD', value.replace('’', "'")).encode('ascii', 'ignore').decode().casefold()
    return re.sub(r'[^a-z0-9]+', '', value)


def slug(value):
    value = unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', '-', value).strip('-')


def clean_title(value):
    title = plain(value)
    # Some uploads put a recording date and track index before a real title.
    # Require spaces and an explicit track index; never derive a title from a filename.
    title = re.sub(r'^gd(?:\d{4}|\d{2})-\d{2}-\d{2}\s+(?:d\d+)?t\d+\s*[-:.)]?\s+', '', title, flags=re.I)
    title = re.sub(r'^\s*(?:\d+[.)]?\s+|[dD]\d+[tT]\d+\s*[-:]?\s*)', '', title)
    title = re.sub(r'^(?:E:|Encore:)\s*', '', title, flags=re.I)
    return re.sub(r'\s*(?:-?>|→)+\s*$', '', title).strip()


def duration(value):
    try:
        parts = [float(n) for n in str(value).split(':')]
        total = 0
        for part in parts:
            total = total * 60 + part
        return total if total >= 0 else None
    except (ValueError, TypeError):
        return None


def natural(value):
    return tuple((1, int(p)) if p.isdigit() else (0, p.lower()) for p in re.split(r'(\d+)', value))


def extract_tracks(payload):
    files = payload.get('files', [])
    extensions = ['flac', 'shn', 'wav', 'aiff', 'mp3', 'ogg']
    candidates = [f for f in files if f.get('source') == 'original' and f.get('name', '').rsplit('.', 1)[-1].lower() in extensions]
    if not candidates:
        # Derived streams still provide evidence; keep only one encoding.
        candidates = [f for f in files if f.get('name', '').rsplit('.', 1)[-1].lower() in extensions and f.get('title')]
    if not candidates:
        return []
    extension = min({f['name'].rsplit('.', 1)[-1].lower() for f in candidates}, key=extensions.index)
    selected = sorted([dict(f) for f in candidates if f['name'].lower().endswith('.' + extension)], key=lambda f: natural(f['name']))
    # Original lossless files sometimes lack titles supplied on derived streams.
    # Copy only explicitly linked metadata, never guess from a different track.
    derivatives = defaultdict(list)
    for file in files:
        original = file.get('original')
        # Archive can return a list for composite derivatives. Only a unique
        # source establishes a safe one-to-one title/length relationship.
        if isinstance(original, list):
            original = original[0] if len(original) == 1 else None
        if isinstance(original, str) and original:
            derivatives[original].append(file)
    for file in selected:
        linked = sorted(derivatives[file['name']], key=lambda f: f['name'])
        for field in ['title', 'length']:
            if not file.get(field):
                value = next((d[field] for d in linked if d.get(field)), None)
                if value:
                    file[field] = value
    return selected


def resolve_title(raw_title, aliases, songs):
    title = clean_title(raw_title)
    if key(title) in aliases:
        return aliases[key(title)], 'matched'
    if not title or re.search(r'\b(tuning|tune up|banter|f?crowd|audience|announcement|introduction|intro|applause|dead air|soundcheck|tape flip|repairs?|radio talk|encore break|technical difficulty)\b', title, re.I):
        return None, 'non_song_or_unresolved'
    if re.search(r'(>|→|\s/\s|\s\+\s|\binto\b)', title, re.I):
        return None, 'compound_unresolved'
    # File names, durations, abbreviations and long notes are never fabricated songs.
    if len(title) > 70 or re.search(r'\.(?:flac|shn|mp3|wav)$|\bgd\d|\d{4}-\d\d-\d\d', title, re.I) or len(key(title)) < 3 or not re.search('[A-Za-z]', title):
        return None, 'unresolved'
    identifier = 'candidate-' + slug(title)
    if not identifier.removeprefix('candidate-'):
        return None, 'unresolved'
    # Candidate identities do not claim expert-canonical title matching.
    songs.setdefault(identifier, {'id': identifier, 'title': title, 'kind': 'song', 'status': 'candidate'})
    return identifier, 'candidate'


def valid_date(value):
    text = scalar(value)[:10]
    try:
        dt.date.fromisoformat(text)
        return text if '1965-01-01' <= text <= '1995-07-09' else None
    except ValueError:
        return None


def adjusted_rating(average, count, prior):
    if average is None or count <= 0:
        return None
    return (average * count + PRIOR_STRENGTH * prior) / (count + PRIOR_STRENGTH)


def import_coverage(shows, recordings):
    """Distinguish missing imports from imported but unusable track evidence."""
    imported = sum(any(recordings[r]['enriched'] for r in s['recordings']) for s in shows.values())
    evidence = sum(bool(s['song_ids']) for s in shows.values())
    return {'dates_with_metadata': imported, 'dates_awaiting_metadata': len(shows) - imported,
            'dates_imported_without_song_evidence': sum(not s['song_ids'] and any(recordings[r]['enriched'] for r in s['recordings']) for s in shows.values()),
            'dates_with_tracks': evidence}


def build():
    inventory = load(SNAPSHOT)
    shutil.rmtree(PUBLIC / 'data/shows', ignore_errors=True)
    history = load(CURATED / 'history.json')
    song_data = load(CURATED / 'songs.json')
    overrides = load(CURATED / 'recording_overrides.json')
    songs = {s['id']: {k: v for k, v in s.items() if k != 'aliases'} | {'status': 'curated', 'kind': s.get('kind', 'song')} for s in song_data['songs']}
    aliases = {key(alias): s['id'] for s in song_data['songs'] for alias in s['aliases']}
    snapshots = inventory['evidence']
    items = inventory['items']
    ratings = [(float(i['avg_rating']), int(i['num_reviews'])) for i in items if i.get('avg_rating') and i.get('num_reviews') and 0 < float(i['avg_rating']) <= 5]
    prior = math.fsum(a * n for a, n in ratings) / sum(n for _, n in ratings) if ratings else 3.5
    shows, recordings, tracks, excluded = {}, {}, [], []
    venue_counts_by_date = defaultdict(Counter)
    for item in items:
        if plain(item.get('venue')):
            venue_counts_by_date[scalar(item.get('date'))[:10]][plain(item.get('venue'))] += 1
    for item in items:
        identifier = item['identifier']
        date = valid_date(item.get('date'))
        if not date:
            excluded.append({'id': identifier, 'date': item.get('date'), 'reason': 'missing/invalid date or outside 1965–1995-07-09 scope'})
            continue
        show_id = f'gd-{date}'
        show = shows.setdefault(show_id, {'id': show_id, 'date': date, 'venue': '', 'location': '', 'status': 'date_group', 'completeness': 'unknown', 'warnings': [], 'venues': [], 'recordings': [], 'song_ids': [], 'tracks': [], 'evidence_recording': None})
        venue = plain(item.get('venue'))
        if venue and venue not in show['venues']:
            show['venues'].append(venue)
        show['location'] = show['location'] or plain(item.get('coverage'))
        if re.search(r'(?:xx|\?\?)', identifier, re.I):
            warning = 'Some recording identifiers indicate an uncertain date; the indexed day may be a placeholder.'
            if warning not in show['warnings']:
                show['warnings'].append(warning)
        if item.get('studio_warning'):
            warning = 'Possible studio or rehearsal material; event type needs historical review.'
            if warning not in show['warnings']:
                show['warnings'].append(warning)
        count = max(0, int(item.get('num_reviews') or 0))
        average = float(item['avg_rating']) if item.get('avg_rating') else None
        if average is not None and not 0 < average <= 5:
            average = None
        rating = {'average': average, 'count': count, 'adjusted': adjusted_rating(average, count, prior), 'retrieved_at': item['rating_date']}
        snapshot = snapshots.get(identifier)
        recording = {'id': identifier, 'show_id': show_id, 'url': f'https://archive.org/details/{identifier}', 'retrieved_at': snapshot['retrieved_at'] if snapshot else inventory['retrieved_at'], 'rating': rating, 'enriched': bool(snapshot), 'tracks': [], 'nonconcert_suspected': item.get('nonconcert_suspected', False), 'evidence_note': overrides.get(identifier, {}).get('reason', '')}
        if snapshot:
            for pos, (song_id, status) in enumerate(snapshot['tracks'], 1):
                title = songs[song_id]['title'] if song_id else 'Unidentified track'
                override = overrides.get(identifier, {})
                if override.get('exclude_from_song_evidence') or pos in override.get('exclude_positions', []):
                    song_id, status = None, 'excluded_non_concert_or_other_artist'
                track = {'position': pos, 'title': title, 'song_id': song_id, 'status': status}
                recording['tracks'].append(track)
                tracks.append((identifier, track))
        recordings[identifier] = recording
        show['recordings'].append(identifier)
    # One representative tracklist per date avoids unioning contradictory tapes.
    # Richest tracklist wins, then review count, then identifier for deterministic builds.
    for show in shows.values():
        venue_counts = venue_counts_by_date[show['date']]
        show['venue'] = venue_counts.most_common(1)[0][0] if venue_counts else 'Venue not documented'
        if len(show['venues']) > 1:
            show['warnings'].append('Venue labels disagree across recordings; may include spelling variants or distinct events.')
        available = [recordings[r] for r in show['recordings'] if any(t['song_id'] and t['status'] == 'matched' for t in recordings[r]['tracks']) and not recordings[r]['nonconcert_suspected'] and not overrides.get(r, {}).get('exclude_from_song_evidence')]
        if available:
            selected = max(available, key=lambda r: (len([t for t in r['tracks'] if t['song_id'] and t['status'] == 'matched']), r['rating']['count'], r['id']))
            show['evidence_recording'] = selected['id']
            show['tracks'] = selected['tracks']
            show['song_ids'] = sorted({t['song_id'] for t in selected['tracks'] if t['song_id'] and t['status'] == 'matched'})
            show['completeness'] = 'recording_evidence'
        rated = [recordings[r] for r in show['recordings'] if recordings[r]['rating']['count'] >= 5 and recordings[r]['rating']['adjusted'] is not None]
        best = max(rated, key=lambda r: (r['rating']['adjusted'], r['rating']['count'], r['id'])) if rated else None
        show['best_recording'] = {'id': best['id'], **best['rating']} if best else None
        show['rated_sources'] = [{'id': r['id'], **r['rating']} for r in rated]
        show['metadata_imported'] = any(recordings[r]['enriched'] for r in show['recordings'])
    # Event identity is curated separately from tape attribution and song evidence.
    for event in load(CURATED / 'events.json')['shows']:
        if event['id'] != f"gd-{event['date']}" or not valid_date(event['date']) or not event['source_url'].startswith('https://'):
            raise ValueError('Invalid sourced event')
        show = shows.setdefault(event['id'], {'id': event['id'], 'date': event['date'], 'venue': '', 'location': '', 'status': 'date_group', 'completeness': 'unknown', 'warnings': [], 'venues': [], 'recordings': [], 'song_ids': [], 'tracks': [], 'evidence_recording': None, 'best_recording': None, 'rated_sources': [], 'metadata_imported': False})
        show.update(venue=event['venue'], location=event['location'], status='verified_event', source_url=event['source_url'])
        show['warnings'] = [w for w in show['warnings'] if not w.startswith('Venue labels disagree')]
        show['warnings'].append(event['note'])
    # Optional, explicitly sourced complete/partial setlists. This path also accepts
    # distinct same-date event IDs and unrecorded shows when a cleared catalog arrives.
    curated_rows = []
    for curated in load(CURATED / 'setlists.json')['shows']:
        if not curated.get('source_url') or not curated.get('id') or not valid_date(curated.get('date')):
            raise ValueError('Curated show needs id, valid date, and source_url')
        sid = curated['id']
        if curated.get('completeness') not in ('complete', 'partial'):
            raise ValueError('Curated completeness must be complete or partial')
        show = shows.setdefault(sid, {'id': sid, 'date': curated['date'], 'recordings': [], 'venues': [], 'warnings': [], 'evidence_recording': None, 'best_recording': None, 'rated_sources': []})
        show.update({k: curated[k] for k in ['venue', 'location', 'completeness']})
        show.update(status='verified_event', source_url=curated['source_url'])
        show['tracks'], show['song_ids'] = [], []
        for pos, entry in enumerate(curated['entries'], 1):
            song_id = entry['song_id']
            if song_id not in songs:
                raise ValueError(f'Unknown curated song {song_id}; add to songs.json first')
            track = {'position': pos, 'title': entry.get('original_title', songs[song_id]['title']), 'song_id': song_id, 'set': entry.get('set', 'Unknown set'), 'segue': entry.get('segue'), 'status': 'verified_setlist', 'seconds': None}
            show['tracks'].append(track)
            curated_rows.append((sid, track, curated['source_url']))
        show['song_ids'] = sorted({t['song_id'] for t in show['tracks']})
    release_data = load(CURATED / 'concert_releases.json')
    releases_by_date = defaultdict(list)
    release_ids = set()
    for release in release_data['releases']:
        if release['id'] in release_ids or release['category'] not in ('standalone', 'dicks_picks'):
            raise ValueError('Invalid or duplicate concert release')
        release_ids.add(release['id'])
        if not release['source_url'].startswith('https://'):
            raise ValueError('Concert release needs an HTTPS source')
        dates_seen = set()
        for entry in release['dates']:
            if not valid_date(entry['date']) or entry['date'] in dates_seen or entry['coverage'] not in ('complete', 'selections', 'bonus', 'featured'):
                raise ValueError('Invalid release performance date or coverage')
            dates_seen.add(entry['date'])
            releases_by_date[entry['date']].append({k:release[k] for k in ['id','title','category','source_url']} | {'volume': release.get('volume'), 'coverage':entry['coverage']})
    guests = load(CURATED / 'guests.json')
    guest_people = {p['id']: p for p in guests['people']}
    if len(guest_people) != len(guests['people']):
        raise ValueError('Duplicate guest person')
    guest_appearances = defaultdict(list)
    appearance_keys = set()
    for appearance in guests['appearances']:
        appearance_key = (appearance['show_id'], appearance['guest_id'])
        if appearance_key in appearance_keys or appearance_key[0] not in shows or appearance_key[1] not in guest_people or not appearance['source_url'].startswith('https://'):
            raise ValueError('Invalid or duplicate guest appearance')
        appearance_keys.add(appearance_key)
        guest_appearances[appearance_key[0]].append(appearance)
    catalog_shows, years = [], []
    for show in sorted(shows.values(), key=lambda s: (s['date'], s['id'])):
        show['guest_appearances'] = guest_appearances.get(show['id'], [])
        show['guest_ids'] = sorted({a['guest_id'] for a in show['guest_appearances']})
        show['official_releases'] = releases_by_date.get(show['date'], [])
        show['era_ids'] = [e['id'] for e in history['eras'] if e['start'] <= show['date'] <= e['end']]
        show['member_ids'] = [m['id'] for m in history['members'] if any(i['start'] <= show['date'] <= i['end'] for i in m['intervals'])]
        catalog_shows.append({k: v for k, v in show.items() if k not in ['tracks', 'recordings', 'venues'] } | {'recording_count': len(show['recordings'])})
        detail = dict(show)
        detail['recordings'] = sorted([recordings[r] for r in show['recordings']], key=lambda r: (-(r['rating']['adjusted'] or 0), -r['rating']['count'], r['id']))
        dump(PUBLIC / 'data/shows' / f'{show["id"]}.json', detail)
    for year in range(1965, 1996):
        selected = [s for s in catalog_shows if s['date'].startswith(str(year))]
        imported = sum(any(recordings[r]['enriched'] for r in shows[s['id']]['recordings']) for s in selected)
        years.append({'year': year, 'dates': len(selected), 'recordings': sum(s['recording_count'] for s in selected), 'with_metadata': imported, 'awaiting_metadata': len(selected) - imported, 'with_tracks': sum(bool(s['song_ids']) for s in selected), 'complete_setlists': sum(s['completeness'] == 'complete' for s in selected)})
    evidence_counts = Counter(song for s in catalog_shows for song in s['song_ids'])
    exported_songs = sorted([s | {'date_count': evidence_counts[s['id']]} for s in songs.values() if evidence_counts[s['id']]], key=lambda s: (-s['date_count'], s['title']))
    report = {'inventory_items': len(items), 'reported_total': inventory['reported_total'], 'recordings_in_scope': len(recordings), 'date_groups': len(shows), 'enriched_recordings': sum(r['enriched'] for r in recordings.values()), 'dates_with_tracks': sum(bool(s['song_ids']) for s in catalog_shows), 'complete_setlists': sum(s['completeness'] == 'complete' for s in catalog_shows), 'observed_song_labels': len(exported_songs), 'curated_song_labels': sum(s['status'] == 'curated' for s in exported_songs), 'unresolved_tracks': sum(t['status'] != 'matched' for _, t in tracks), 'venue_conflicts': sum(any('Venue labels' in w for w in s['warnings']) for s in catalog_shows), 'excluded_items': excluded, 'unresolved_status_counts': dict(Counter(t['status'] for _, t in tracks if t['status'] != 'matched')), 'years': years}
    report.update(import_coverage(shows, recordings))
    audit_dates = []
    for show in sorted(shows.values(), key=lambda s: (s['date'], s['id'])):
        imported = [recordings[r] for r in show['recordings'] if recordings[r]['enriched']]
        audit_dates.append({'id': show['id'], 'date': show['date'],
            'status': 'song_evidence' if show['song_ids'] else 'imported_without_song_evidence' if imported else 'awaiting_metadata',
            'evidence_recording': show['evidence_recording'], 'song_count': len(show['song_ids']),
            'track_status_counts': dict(Counter(t['status'] for t in show['tracks'])),
            'warnings': show['warnings'],
            'metadata': [{'id': r['id'], 'url': r['url'], 'retrieved_at': snapshots[r['id']]['retrieved_at'], 'track_count': len(r['tracks']), 'note': r['evidence_note']} for r in imported]})
    dump(ROOT / 'data/processing/all-dates.json', {'scope': 'Reported dates in the cached Internet Archive inventory, 1965–1995-07-09; one representative tracklist per date, not every duplicate tape or verified complete setlists.', 'summary': import_coverage(shows, recordings), 'years': years, 'dates': audit_dates})
    albums = load(CURATED / 'albums.json')['albums']
    for album in albums:
        for track in album['tracks']:
            assert set(track['song_ids']) <= set(songs), track
    notable = load(CURATED / 'notable_shows.json')
    assert len({n['show_id'] for n in notable['shows']}) == len(notable['shows'])
    assert all(n['show_id'] in shows and n['source'].startswith('https://') for n in notable['shows'])
    catalog = {'guests': guests, 'notable_shows': notable, 'release_index_note': release_data['note'], 'albums': albums, 'schema_version': 1, 'retrieved_at': inventory['retrieved_at'], 'rating_prior': prior, 'rating_prior_strength': PRIOR_STRENGTH, 'history': history, 'coverage': {k: v for k, v in report.items() if k not in ['excluded_items', 'unresolved_status_counts']}, 'shows': catalog_shows, 'songs': exported_songs}
    dump(PUBLIC / 'data/catalog.json', catalog)
    dump(PUBLIC / 'data/setlists.json', load(ROOT / 'data/release/setlists.json'))
    dump(ROOT / 'data/coverage.json', report)
    database(shows, recordings, tracks, songs, aliases, history, curated_rows, inventory)
    package(catalog)
    print(json.dumps({k: v for k, v in report.items() if k not in ['excluded_items', 'unresolved_status_counts', 'years']}, indent=2))


def database(shows, recordings, tracks, songs, aliases, history, curated_rows, inventory):
    db_path = ROOT / 'data/archive.sqlite'
    if db_path.exists():
        db_path.unlink()
    with sqlite3.connect(db_path) as db:
        db.executescript((ROOT / 'scripts/schema.sql').read_text())
        db.execute('INSERT INTO sources VALUES(?,?,?,?,?)', ('archive', 'Internet Archive', 'https://archive.org/details/GratefulDead', inventory['retrieved_at'], 'Recording index and track evidence; not a complete historical show catalog'))
        db.executemany('INSERT INTO shows VALUES(?,?,?,?,?,?,?)', [(s['id'], s['date'], s['venue'], s.get('location',''), s['status'], s['completeness'], json.dumps(s['warnings'])) for s in shows.values()])
        for r in recordings.values():
            db.execute('INSERT INTO recordings VALUES(?,?,?,?,?,?)', (r['id'], r['show_id'], 'archive', r['url'], r['retrieved_at'], int(r['enriched'])))
            a = r['rating']
            db.execute('INSERT INTO rating_snapshots VALUES(?,?,?,?,?)', (r['id'], a['retrieved_at'], a['average'], a['count'], a['adjusted']))
        db.executemany('INSERT INTO songs VALUES(?,?,?,?)', [(s['id'], s['title'], s['kind'], s['status']) for s in songs.values()])
        db.executemany('INSERT INTO song_aliases VALUES(?,?)', aliases.items())
        for rid, t in tracks:
            db.execute('INSERT INTO track_evidence VALUES(?,?,?,?,?)', (rid, t['position'], t['title'], t['song_id'], t['status']))
        for sid, t, url in curated_rows:
            db.execute('INSERT INTO setlist_entries VALUES(?,?,?,?,?,?,?)', (sid, t['set'], t['position'], t['song_id'], t['title'], t.get('segue'), url))
        for member in history['members']:
            db.execute('INSERT INTO members VALUES(?,?,?,?)', (member['id'], member['name'], json.dumps(member['instruments']), member.get('note','')))
            for i in member['intervals']:
                db.execute('INSERT INTO member_intervals VALUES(?,?,?,?,?,?)', (member['id'], i['start'], i['end'], i['precision'], i.get('note',''), i['source']))
        for era in history['eras']:
            db.execute('INSERT INTO eras VALUES(?,?,?,?,?,?)', (era['id'], era['title'], era['start'], era['end'], era['description'], json.dumps(era['sources'])))
        for event in history['events']:
            db.execute('INSERT INTO historical_events VALUES(?,?,?,?,?,?)', (event['id'], event['date'], event['precision'], event['title'], event['description'], event['source']))
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []


def package(catalog):
    # Keep the current preview available while the next full archive is built.
    dist = ROOT / '.dist-build'
    if dist.exists():
        shutil.rmtree(dist)
    shutil.copytree(PUBLIC, dist)
    # Content revisions refresh module and data URLs after an offline rebuild.
    # A new tab can otherwise reuse yesterday's heuristically cached catalog.
    revision = hashlib.sha256(b''.join((PUBLIC / name).read_bytes() for name in ['app.js', 'analytics.mjs', 'albums.mjs', 'point-cloud.mjs', 'assets/rose-graph.json', 'data/catalog.json', 'data/setlists.json', 'sequence-ui.mjs', 'sequence-engine.mjs', 'sequence-timeline.mjs'])).hexdigest()[:12]
    index_html = (PUBLIC / 'index.html').read_text().replace('src="app.js"', f'src="app.js?v={revision}"').replace('src="point-cloud.mjs"', f'src="point-cloud.mjs?v={revision}"')
    index_html = index_html.replace('src="sequence-ui.mjs"', f'src="sequence-ui.mjs?v={revision}"')
    for stylesheet in ['style.css', 'theme.css', 'timeline.css', 'sequence.css']:
        style_revision = hashlib.sha256((PUBLIC / stylesheet).read_bytes()).hexdigest()[:12]
        index_html = index_html.replace(f'href="{stylesheet}"', f'href="{stylesheet}?v={style_revision}"')
    (dist / 'index.html').write_text(index_html)
    (dist / 'app.js').write_text((PUBLIC / 'app.js').read_text().replace("'./analytics.mjs'", f"'./analytics.mjs?v={revision}'").replace("'./albums.mjs'", f"'./albums.mjs?v={revision}'"))
    (dist / 'sequence-ui.mjs').write_text((PUBLIC / 'sequence-ui.mjs').read_text().replace("'./analytics.mjs'", f"'./analytics.mjs?v={revision}'").replace("'./sequence-engine.mjs'", f"'./sequence-engine.mjs?v={revision}'").replace("'./sequence-timeline.mjs'", f"'./sequence-timeline.mjs?v={revision}'").replace("'data/setlists.json'", f"'data/setlists.json?v={revision}'").replace("'data/catalog.json'", f"'data/catalog.json?v={revision}'"))
    (dist / '.nojekyll').touch()
    shutil.copyfile(ROOT / 'data/coverage.json', dist / 'data/coverage.json')
    (dist / 'sources.html').write_text((PUBLIC / 'sources.html').read_text())
    # Crawlable and useful without JS; explorer links preserve the selected entity.
    guest_names = {p['id']: p['name'] for p in catalog['guests']['people']}
    for show in catalog['shows']:
        title = f'{show["date"]} · {show["venue"]}'
        body = f'<p>{html.escape(show.get("location", ""))}</p><p>{show["recording_count"]} recordings indexed. Status: {html.escape(show["completeness"])}.</p><p>Reported-date grouping; distinct events on one date may be combined until verified.</p>'
        if not show['song_ids'] and show.get('metadata_imported'):
            body += '<p>Recording metadata imported; usable concert song evidence is unresolved or excluded. See the source records for review.</p>'
        detail = load(PUBLIC / 'data/shows' / f'{show["id"]}.json')
        # Only the representative tracklist is used by the site. Alternate
        # evidence stays in the build snapshot for reproducible selection.
        detail.pop('venues', None)
        detail['recordings'] = [{k: v for k, v in r.items() if k in {
            'id', 'url', 'rating', 'enriched', 'evidence_note'}}
            for r in detail['recordings']]
        dump(dist / 'data/shows' / f'{show["id"]}.json', detail)
        if show.get('source_url'):
            body += f'<p><a href="{html.escape(show["source_url"])}">Historical event source</a></p>'
        body += ''.join(f'<p>{html.escape(w)}</p>' for w in show['warnings'])
        if show.get('guest_appearances'):
            body += '<h2>Documented guest appearances</h2><ul>' + ''.join(f'<li>{html.escape(guest_names[a["guest_id"]])}: {html.escape(a["scope"])} <a href="{html.escape(a["source_url"])}">Source</a></li>' for a in show['guest_appearances']) + '</ul>'
        if detail['tracks']:
            body += '<h2>Recorded track evidence</h2><p>May be incomplete; order follows source files. Set divisions are not inferred.</p><ol>' + ''.join(f'<li>{html.escape(t["title"])}</li>' for t in detail['tracks']) + '</ol>'
        body += '<h2>Recording sources</h2><ul>' + ''.join(f'<li><a href="{html.escape(r["url"])}">{html.escape(r["id"])}</a></li>' for r in detail['recordings']) + '</ul>'
        write_page(dist / 'shows' / show['id'] / 'index.html', title, body, f'../../?show={show["id"]}')
    for song in catalog['songs']:
        matching = [s for s in catalog['shows'] if song['id'] in s['song_ids']]
        body = '<p>Played in the indexed recordings. Counts reflect indexed recordings; incomplete setlists may omit performances. This is not a complete performance history or a verified debut list.</p><ul>' + ''.join(f'<li><a href="../../shows/{s["id"]}/">{s["date"]} · {html.escape(s["venue"])}</a></li>' for s in matching) + '</ul>'
        write_page(dist / 'songs' / song['id'] / 'index.html', song['title'], body, f'../../?song={song["id"]}')
    previous = ROOT / '.dist-previous'
    shutil.rmtree(previous, ignore_errors=True)
    published = ROOT / 'dist'
    if published.exists():
        published.rename(previous)
    dist.rename(published)
    shutil.rmtree(previous, ignore_errors=True)


def write_page(path, title, body, explorer):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>{html.escape(title)} — Deadshows</title><meta property="og:type" content="website"><meta property="og:title" content="{html.escape(title)} — Dead Shows Archive"><meta property="og:image" content="https://deadshows.github.io/assets/share-card.png"><meta name="twitter:card" content="summary_large_image"><link rel="stylesheet" href="../../style.css"><link rel="stylesheet" href="../../theme.css"><body class="document"><nav><a href="../../">Deadshows / The live archive</a></nav><main><p class="eyebrow">ARCHIVE RECORD</p><h1>{html.escape(title)}</h1><p><a class="primary-link" href="{html.escape(explorer)}">Open in the interactive explorer ↗</a></p>{body}<p><a href="../../sources.html">Sources & methodology</a></p></main></body></html>')

if __name__ == '__main__':
    build()
