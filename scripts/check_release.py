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
            if re.search(r'@|https?://|<', str(row.get(field,''))):
                errors.append('Unexpected text in factual field: ' + row['identifier'])
    if errors:
        raise SystemExit('\n'.join(errors))
    print(f'Release check passed: {len(list(filter(None,candidates)))} source files; local links resolve; dataset fields restricted.')

if __name__ == '__main__':
    check()
