#!/usr/bin/env python3
"""Check publishable source paths and local links in the built static site."""
import json
from html.parser import HTMLParser
from pathlib import Path
import re
import subprocess
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]

def check():
    candidates = subprocess.check_output(
        ['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd=ROOT).decode().split('\0')
    errors = []
    for name in filter(None, candidates):
        lower = name.lower()
        if (lower.startswith(('data/raw/', 'data/design/', 'data/processing/'))
                or ('preview' in lower and lower.endswith(('.png', '.jpg', '.jpeg')))
                or lower in {'docs/branding.md', 'docs/1977-processing.md', 'docs/all-dates-processing.md', 'docs/data_model.md'}
                or 'stealie' in lower or lower.endswith(('.pem', '.key', '.sqlite'))
                or Path(name).name.startswith('.env')):
            errors.append('Local-only source path: ' + name)

    class Links(HTMLParser):
        def __init__(self):
            super().__init__()
            self.targets = []
        def handle_starttag(self, tag, attrs):
            attrs = dict(attrs)
            for key in ('src', 'href'):
                if attrs.get(key):
                    self.targets.append(attrs[key])
    dist = ROOT / 'dist'
    for path in dist.rglob('*'):
        if 'stealie' in path.name.lower():
            errors.append('Former artwork in build: ' + str(path))
        if path.suffix == '.html':
            parser = Links()
            parser.feed(path.read_text())
            for link in parser.targets:
                url = urlsplit(link)
                if url.scheme or url.netloc or not url.path:
                    continue
                target = dist / unquote(url.path.lstrip('/')) if url.path.startswith('/') else path.parent / unquote(url.path)
                if not target.exists():
                    errors.append(f'Broken local link: {path.relative_to(dist)} -> {link}')
    snapshot = json.loads((ROOT / 'data/release/archive.json').read_text())
    allowed = {'identifier','date','venue','coverage','avg_rating','num_reviews',
               'studio_warning','nonconcert_suspected','rating_date'}
    for row in snapshot['items']:
        if not set(row) <= allowed:
            errors.append('Unexpected Archive fields: ' + row['identifier'])
        for field in ('identifier','venue','coverage'):
            if re.search(r'@|https?://|<|>', str(row.get(field,''))):
                errors.append('Unexpected text in factual field: ' + row['identifier'])
    setlists = json.loads((ROOT / 'data/release/setlists.json').read_text())
    catalog = json.loads((dist / 'data/catalog.json').read_text())
    if set(setlists) != {'schema_version', 'coverage', 'shows', 'songs'}:
        errors.append('Unexpected setlist snapshot fields')
    show_ids = {show['id'] for show in catalog['shows']}
    seen = set()
    for show in setlists['shows']:
        if set(show) != {'id','date','venue','url','boundary_reference','sets','review_level','source_kind'}:
            errors.append('Unexpected setlist show fields: ' + show['id'])
        if show['id'] not in show_ids or show['id'] in seen:
            errors.append('Invalid or duplicate setlist date group: ' + show['id'])
        seen.add(show['id'])
        source = urlsplit(show['url'])
        if source.scheme != 'https' or source.hostname != 'archive.org':
            errors.append('Unexpected setlist source URL: ' + show['id'])
        if re.search(r'@|<|https?://', show['venue']):
            errors.append('Unexpected text in setlist venue: ' + show['id'])
        for group in show['sets']:
            if set(group) != {'performance','kind','ordinal','start_boundary_explicit','entries'}:
                errors.append('Unexpected setlist group fields: ' + show['id'])
            for entry in group['entries']:
                if set(entry) != {'song_id','type','flags','transition_to_next'}:
                    errors.append('Unexpected setlist entry fields: ' + show['id'])
                if entry['song_id'] and entry['song_id'] not in setlists['songs']:
                    errors.append('Missing setlist song identity: ' + show['id'])
    for song in setlists['songs'].values():
        if set(song) != {'id','title','kind'} or re.search(r'@|<|https?://', song['title']):
            errors.append('Unexpected setlist song fields or text')
    for album in catalog['albums']:
        if 'cover_url' in album or not re.fullmatch(r'#[0-9a-f]{6}', album.get('display_color','')):
            errors.append('Album marker must be a solid color: ' + album['id'])
    index_text = (dist / 'index.html').read_text()
    if any(marker in index_text for marker in ['LOCAL PREVIEW', 'local-album-preview', 'LOCAL-SEQUENCES']):
        errors.append('Local preview markup in release build')
    if (dist / 'data/setlists.json').read_text() != (ROOT / 'public/data/setlists.json').read_text():
        errors.append('Setlist release data was not packaged correctly')
    if errors:
        raise SystemExit('\n'.join(errors))
    print(f'Release check passed: {len(list(filter(None,candidates)))} source files; local links resolve; dataset fields restricted.')

if __name__ == '__main__':
    check()
