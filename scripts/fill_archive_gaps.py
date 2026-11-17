"""Supplement weak tracklists after the all-date pass, without downloading audio."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('archive_fetch', ROOT / 'scripts/fetch_archive.py')
fetch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fetch)

def candidates():
    catalog = json.loads((ROOT / 'public/data/catalog.json').read_text())
    overrides = json.loads((ROOT / 'data/curated/recording_overrides.json').read_text())
    weak_dates = set()
    for show in catalog['shows']:
        detail = json.loads((ROOT / 'public/data/shows' / (show['id'] + '.json')).read_text())
        eligible = [r for r in detail['recordings'] if r['enriched'] and not r['nonconcert_suspected'] and not overrides.get(r['id'], {}).get('exclude_from_song_evidence')]
        if not eligible:
            continue
        evidence = next((r for r in eligible if r['id'] == show['evidence_recording']), None)
        if evidence is None:
            weak_dates.add(show['date'])
            continue
        tracks = evidence['tracks']
        matched = sum(t['status'] == 'matched' for t in tracks)
        if len(tracks) >= 6 and matched / len(tracks) < .5:
            weak_dates.add(show['date'])
    inventory = json.loads((ROOT / 'data/raw/archive/inventory.json').read_text())['items']
    options = [r for r in inventory if fetch.scalar(r.get('date'))[:10] in weak_dates and not (fetch.RAW / 'metadata' / (r['identifier'] + '.json')).exists()]
    return fetch.choose_date_recordings(options)

if __name__ == '__main__' and '--run' not in sys.argv:
    rows = candidates()
    print(json.dumps({'alternate_requests': len(rows), 'dates': [fetch.scalar(r.get('date'))[:10] for r in rows]}, indent=2))
elif __name__ == '__main__':
    for round_number in range(1, 3):
        rows = candidates()
        plan = {'round': round_number, 'selected': len(rows), 'recordings': [{'id': r['identifier'], 'date': fetch.scalar(r.get('date'))[:10]} for r in rows]}
        fetch.write_json(ROOT / f'data/processing/alternate-round-{round_number}.json', plan)
        if not rows:
            break
        command = [sys.executable, str(ROOT / 'scripts/fetch_archive.py'), '--workers', '3', '--build-every', '50']
        for row in rows:
            command += ['--recording', row['identifier']]
        subprocess.run(command, check=True, cwd=ROOT)
        report = json.loads((fetch.RAW / 'fetch-report.json').read_text())
        fetch.write_json(ROOT / f'data/processing/alternate-round-{round_number}-fetch.json', report)
