#!/usr/bin/env python3
"""Export only the local Archive evidence needed to reproduce the public build."""
import re

from build import CURATED, RAW, SNAPSHOT, dump, extract_tracks, key, load, plain, resolve_title


def export():
    inventory = load(RAW / 'inventory.json')
    songs = load(CURATED / 'songs.json')['songs']
    aliases = {key(alias): song['id'] for song in songs for alias in song['aliases']}
    times = {row['id']: row['retrieved_at'] for row in inventory.get('snapshots', [])}
    fields = ('identifier', 'date', 'venue', 'coverage', 'avg_rating', 'num_reviews')
    items = []
    for item in inventory['items']:
        record = {field: item[field] for field in fields if field in item}
        evidence = ' '.join(plain(item.get(f)) for f in ('venue', 'title'))
        studio_text = evidence + ' ' + item['identifier']
        if re.search(r'\b(studios?|rehearsal|rehearsals|practice|outtakes)\b', studio_text, re.I):
            record['studio_warning'] = True
        if re.search(r'\b(studios?|rehearsals?|interview|radio conversation)\b', evidence, re.I):
            record['nonconcert_suspected'] = True
        record['rating_date'] = times.get(item.get('_snapshot'), inventory['retrieved_at'])
        items.append(record)

    tracks = {}
    for path in sorted((RAW / 'metadata').glob('*.json')):
        snapshot = load(path)
        rows = []
        for track in extract_tracks(snapshot['data']):
            song_id, status = resolve_title(plain(track.get('title')), aliases, {})
            # Publish a curated song identity or a status, never the uploader's free text.
            rows.append([song_id if status == 'matched' else None, status])
        tracks[path.stem] = {'retrieved_at': snapshot['retrieved_at'], 'tracks': rows}
    dump(SNAPSHOT, {'retrieved_at': inventory['retrieved_at'],
                    'reported_total': inventory['reported_total'], 'items': items, 'evidence': tracks})


if __name__ == '__main__':
    export()
