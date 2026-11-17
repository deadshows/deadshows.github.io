#!/usr/bin/env python3
"""Resumable public metadata import. Never downloads audio or review text."""
import argparse
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
import datetime as dt
import hashlib
import http.client
import json
from pathlib import Path
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'data/raw/archive'
FIELDS = ['identifier', 'date', 'title', 'venue', 'coverage', 'avg_rating', 'num_reviews', 'downloads', 'source', 'collection']
QUERY = 'collection:GratefulDead AND mediatype:etree'
FEATURED = ['1966-07-16', '1967-11-10', '1968-02-14', '1969-02-27', '1969-03-01', '1970-02-13', '1970-05-02', '1971-02-18', '1971-10-19', '1972-04-08', '1972-05-26', '1972-08-27', '1973-11-11', '1974-03-23', '1974-06-18', '1974-06-23', '1974-10-20', '1975-08-13', '1976-06-09', '1977-05-08', '1977-05-09', '1977-09-03', '1978-07-08', '1979-04-22', '1980-10-31', '1981-05-06', '1982-10-10', '1983-10-14', '1984-07-13', '1985-06-30', '1986-12-15', '1987-09-18', '1988-07-02', '1989-07-07', '1989-10-09', '1990-03-29', '1990-09-20', '1991-06-17', '1992-05-31', '1993-09-22', '1994-10-14', '1995-07-09']


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n')
    tmp.replace(path)


class Client:
    def __init__(self, delay=1.0, refresh=False):
        self.delay, self.refresh = delay, refresh
        self.last = 0.0
        self.request_lock = threading.Lock()

    def get(self, url, path):
        if path.exists() and not self.refresh:
            return json.loads(path.read_text())
        for attempt in range(5):
            try:
                request = urllib.request.Request(url, headers={'User-Agent': 'DeadshowsResearch/0.1 (metadata only; github.com/deadshows/deadshows.github.io)'})
                # Bound request starts globally, including retries and workers.
                # The lock covers spacing only, so slow responses can overlap.
                with self.request_lock:
                    time.sleep(max(0, self.delay - (time.monotonic() - self.last)))
                    self.last = time.monotonic()
                with urllib.request.urlopen(request, timeout=60) as response:
                    body = response.read()
                payload = json.loads(body)
                if payload.get('error'):
                    raise ValueError(str(payload['error']))
                result = {'url': url, 'retrieved_at': dt.datetime.now(dt.timezone.utc).isoformat(), 'sha256': hashlib.sha256(body).hexdigest(), 'data': payload}
                write_json(path, result)
                return result
            except (OSError, http.client.HTTPException, ValueError) as exc:
                if attempt == 4:
                    raise RuntimeError(f'Failed {url}: {exc}') from exc
                wait = min(60, 2 ** (attempt + 1))
                if isinstance(exc, urllib.error.HTTPError):
                    retry = exc.headers.get('Retry-After', '')
                    if retry.isdigit():
                        wait = max(wait, int(retry))
                print(f'Retrying in {wait}s: {exc}', flush=True)
                time.sleep(wait)


def inventory(client):
    docs, reported_total, snapshot_manifest = [], 0, []
    # Solr deep paging beyond 10,000 can fail. Partition by year, with an
    # explicit catch-all for missing/out-of-range dates, so nothing vanishes.
    partitions = [(str(year), f'{QUERY} AND date:[{year}-01-01T00:00:00Z TO {year}-12-31T23:59:59Z]') for year in range(1965, 1996)]
    partitions.append(('other', f'{QUERY} AND NOT date:[1965-01-01T00:00:00Z TO 1995-12-31T23:59:59Z]'))
    for label, query in partitions:
        page, count = 1, 0
        while True:
            params = [('q', query), ('output', 'json'), ('rows', '1000'), ('page', str(page)), ('sort[]', 'identifier asc')]
            params += [('fl[]', field) for field in FIELDS]
            result = client.get('https://archive.org/advancedsearch.php?' + urllib.parse.urlencode(params), RAW / 'search' / f'{label}-{page:03}.json')
            response = result['data']['response']
            rows = response['docs']
            snapshot_id = f'{label}-{page:03}'
            snapshot_manifest.append({'id': snapshot_id, 'url': result['url'], 'retrieved_at': result['retrieved_at'], 'sha256': result['sha256']})
            docs.extend([dict(row, _snapshot=snapshot_id) for row in rows])
            count += len(rows)
            print(f'Inventory {label}: {count}/{response["numFound"]}', flush=True)
            if count >= response['numFound']:
                reported_total += response['numFound']
                break
            if not rows:
                raise RuntimeError('Empty page before end of inventory')
            page += 1
    unique = {d['identifier']: d for d in docs}
    if len(unique) != len(docs):
        raise RuntimeError('Duplicate IDs across search pages: refresh inventory to avoid pagination drift')
    write_json(RAW / 'inventory.json', {'query': QUERY, 'snapshots': snapshot_manifest, 'retrieved_at': result['retrieved_at'], 'reported_total': reported_total, 'items': sorted(unique.values(), key=lambda d: d['identifier'])})
    return list(unique.values())


def scalar(value):
    return str(value[0] if isinstance(value, list) and value else value or '')


def choose_sample(items, per_year):
    by_date = {}
    for item in items:
        date = scalar(item.get('date'))[:10]
        if len(date) == 10 and '1965-01-01' <= date <= '1995-07-09':
            by_date.setdefault(date, []).append(item)
    def quality(item):
        return (int(item.get('num_reviews') or 0), float(item.get('downloads') or 0), item['identifier'])
    dates = set(FEATURED) & by_date.keys()
    for year in range(1965, 1996):
        candidates = sorted(d for d in by_date if d.startswith(str(year)))
        if candidates:
            for i in range(per_year):
                dates.add(candidates[min(len(candidates) - 1, int((i + .5) * len(candidates) / per_year))])
    selected = [max(by_date[d], key=quality) for d in sorted(dates)]
    # Include a second recording to exercise the many-recordings/one-date distinction.
    for date in ['1972-08-27', '1974-06-23', '1977-05-08', '1990-03-29']:
        alternatives = sorted(by_date.get(date, []), key=quality, reverse=True)
        if len(alternatives) > 1:
            selected.append(alternatives[1])
    return selected


def choose_date_recordings(items, year=None):
    """Select one deterministic, well-reviewed metadata source per valid date."""
    by_date = {}
    for item in items:
        date = scalar(item.get('date'))[:10]
        try:
            dt.date.fromisoformat(date)
        except ValueError:
            continue
        if not '1965-01-01' <= date <= '1995-07-09' or (year is not None and not date.startswith(str(year))):
            continue
        quality = lambda row: (int(row.get('num_reviews') or 0), float(row.get('downloads') or 0), row['identifier'])
        previous = by_date.get(date)
        if previous is None or quality(item) > quality(previous):
            by_date[date] = item
    return [by_date[d] for d in sorted(by_date)]


def fetch_metadata(client, item):
    identifier = item['identifier']
    path = RAW / 'metadata' / f'{identifier}.json'
    was_cached = path.exists() and not client.refresh
    result = client.get(f'https://archive.org/metadata/{urllib.parse.quote(identifier, safe="")}?output=json', path)
    # Never retain reviewer identities or prose, including on cached reads.
    if 'reviews' in result['data']:
        result['data'].pop('reviews', None)
        result['hash_note'] = 'sha256 describes original HTTP body; cached data omits reviews'
        write_json(path, result)
    return not was_cached


def rebuild():
    for script in ('export_archive.py', 'build.py'):
        subprocess.run([sys.executable, str(ROOT / 'scripts' / script)], check=True, cwd=ROOT)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory', action='store_true', help='Fetch/cache the entire Archive recording inventory')
    parser.add_argument('--sample', action='store_true', help='Enrich featured dates plus a deterministic cross-year sample')
    parser.add_argument('--all-dates', action='store_true', help='Enrich one recording per reported date (can take hours)')
    parser.add_argument('--year', type=int, choices=range(1965, 1996), metavar='YYYY', help='Enrich all reported dates in this year only; implies --all-dates')
    parser.add_argument('--recording', action='append', default=[], metavar='IDENTIFIER', help='Import a specific inventory recording; repeat to inspect alternate tracklists')
    parser.add_argument('--limit', type=int, help='Maximum metadata items this run; cached items do not count')
    parser.add_argument('--per-year', type=int, default=2)
    parser.add_argument('--delay', type=float, default=1.0)
    parser.add_argument('--refresh', action='store_true', help='Refresh requested cached responses')
    parser.add_argument('--workers', type=int, choices=range(1, 4), default=1, help='At most three overlapping metadata responses; request starts still at least --delay apart')
    parser.add_argument('--build-every', type=int, metavar='N', help='Rebuild the explorer after every N new metadata responses and at completion')
    args = parser.parse_args()
    if args.delay < 1 or args.per_year < 1 or (args.limit is not None and args.limit < 1) or (args.build_every is not None and args.build_every < 1):
        parser.error('delay >= 1, per-year >= 1, limit >= 1, build-every >= 1 required')
    client = Client(args.delay, args.refresh)
    if args.inventory:
        items = inventory(client)
    else:
        path = RAW / 'inventory.json'
        if not path.exists():
            parser.error('Run --inventory first')
        items = json.loads(path.read_text())['items']
    if args.sample or args.all_dates or args.year is not None or args.recording:
        selected = choose_sample(items, args.per_year)
        if args.all_dates or args.year is not None:
            selected = choose_date_recordings(items, args.year)
        if args.recording:
            lookup = {item['identifier']: item for item in items}
            if any(identifier not in lookup for identifier in args.recording):
                parser.error('--recording must name an identifier in the cached inventory')
            selected = [lookup[identifier] for identifier in dict.fromkeys(args.recording)]
            if args.year is not None and any(not scalar(item.get('date'))[:10].startswith(str(args.year)) for item in selected):
                parser.error('--recording identifiers must match --year when both are supplied')
        cached = [item for item in selected if (RAW / 'metadata' / f'{item["identifier"]}.json').exists() and not args.refresh]
        pending = [item for item in selected if item not in cached]
        if args.limit is not None:
            pending = pending[:args.limit]
        fetched, completed, failures = 0, len(cached), []
        started = dt.datetime.now(dt.timezone.utc).isoformat()
        def checkpoint(status):
            write_json(RAW / 'fetch-report.json', {
                'year': args.year, 'selected': len(selected), 'scheduled': len(pending),
                'cached_at_start': len(cached), 'completed': completed,
                'newly_fetched': fetched, 'failures': failures, 'status': status,
                'started_at': started, 'updated_at': dt.datetime.now(dt.timezone.utc).isoformat(),
            })
        checkpoint('running')
        print(f'Selected {len(selected)} dates/sources; {len(cached)} cached; {len(pending)} requests scheduled', flush=True)
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            # Only workers write metadata; this thread alone builds/reports.
            queue = iter(pending)
            futures = {}
            def submit_next():
                item = next(queue, None)
                if item is not None:
                    futures[pool.submit(fetch_metadata, client, item)] = item
            for _ in range(args.workers):
                submit_next()
            while futures:
                done, _ = wait(futures, return_when=FIRST_COMPLETED)
                for future in done:
                    item = futures.pop(future)
                    newly_fetched = False
                    try:
                        newly_fetched = future.result()
                        fetched += newly_fetched
                        completed += 1
                        print(f'Metadata {completed}/{len(selected)}: {item["identifier"]}', flush=True)
                    except Exception as exc:
                        failures.append({'identifier': item['identifier'], 'error': str(exc)})
                        print(str(exc), flush=True)
                    checkpoint('running')
                    if args.build_every and newly_fetched and fetched % args.build_every == 0:
                        rebuild()
                    submit_next()
        if args.build_every:
            rebuild()
        checkpoint('complete_with_failures' if failures else 'complete')
        if failures:
            raise SystemExit(1)

if __name__ == '__main__':
    main()
