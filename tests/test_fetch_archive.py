import importlib.util
import http.client
import io
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor

spec = importlib.util.spec_from_file_location('archive_fetch', Path(__file__).resolve().parents[1] / 'scripts/fetch_archive.py')
fetch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fetch)


class DateSelectionTests(unittest.TestCase):
    def test_year_scope_uses_one_recording_per_date(self):
        items = [
            {'identifier': 'a', 'date': '1977-05-08T00:00:00Z', 'num_reviews': 5},
            {'identifier': 'b', 'date': ['1977-05-08'], 'num_reviews': 30},
            {'identifier': 'c', 'date': '1977-05-09', 'num_reviews': 10},
            {'identifier': 'd', 'date': '1978-05-08', 'num_reviews': 50},
            {'identifier': 'bad', 'date': '1977-02-30'},
        ]
        self.assertEqual([r['identifier'] for r in fetch.choose_date_recordings(items, 1977)], ['b', 'c'])

    def test_selection_is_deterministic_and_stays_in_archive_scope(self):
        items = [
            {'identifier': 'a', 'date': '1977-01-01', 'num_reviews': 5, 'downloads': 10},
            {'identifier': 'b', 'date': '1977-01-01', 'num_reviews': 5, 'downloads': 20},
            {'identifier': 'outside', 'date': '1995-07-10', 'num_reviews': 10},
            {'identifier': 'early', 'date': '1964-12-31', 'num_reviews': 10},
        ]
        self.assertEqual(fetch.choose_date_recordings(items), fetch.choose_date_recordings(list(reversed(items))))
        self.assertEqual([r['identifier'] for r in fetch.choose_date_recordings(items)], ['b'])


class ImportTests(unittest.TestCase):
    def test_closed_connection_is_retried_and_cached(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(fetch.urllib.request, 'urlopen', side_effect=[http.client.RemoteDisconnected('closed'), io.BytesIO(b'{"files":[]}')]) as request, patch.object(fetch.time, 'sleep'):
            path = Path(folder) / 'response.json'
            result = fetch.Client().get('https://archive.org/metadata/example', path)
            self.assertEqual(request.call_count, 2)
            self.assertEqual(result['data'], {'files': []})
            self.assertTrue(path.exists())

    def test_worker_requests_share_spacing_and_cached_reads_make_no_request(self):
        starts = []
        def response(request, timeout):
            starts.append(time.monotonic())
            time.sleep(.04)
            return io.BytesIO(b'{"files":[]}')
        with tempfile.TemporaryDirectory() as folder, patch.object(fetch.urllib.request, 'urlopen', side_effect=response):
            client = fetch.Client(delay=.03)
            def get(i):
                return client.get(f'https://archive.org/metadata/{i}', Path(folder) / f'{i}.json')
            with ThreadPoolExecutor(max_workers=3) as pool:
                list(pool.map(get, range(3)))
            self.assertEqual(len(starts), 3)
            self.assertTrue(all(b - a >= .025 for a, b in zip(starts, starts[1:])))
            get(0)
            self.assertEqual(len(starts), 3)

    def test_metadata_cache_omits_reviews_and_preserves_provenance(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(fetch, 'RAW', Path(folder)):
            client = fetch.Client()
            payload = {'data': {'files': [], 'reviews': [{'reviewbody': 'private prose'}]}, 'url': 'source', 'sha256': 'hash'}
            with patch.object(client, 'get', return_value=payload):
                self.assertTrue(fetch.fetch_metadata(client, {'identifier': 'example'}))
            cached = json.loads((Path(folder) / 'metadata/example.json').read_text())
            self.assertNotIn('reviews', cached['data'])
            self.assertEqual(cached['sha256'], 'hash')
            self.assertIn('omits reviews', cached['hash_note'])

    def test_limit_counts_new_requests_and_final_build_runs(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(fetch, 'RAW', Path(folder)):
            fetch.write_json(Path(folder) / 'inventory.json', {'items': [
                {'identifier': 'cached', 'date': '1974-02-22'},
                {'identifier': 'new-a', 'date': '1974-02-23'},
                {'identifier': 'new-b', 'date': '1974-02-24'},
            ]})
            fetch.write_json(Path(folder) / 'metadata/cached.json', {'data': {}})
            with patch('sys.argv', ['fetch_archive.py', '--all-dates', '--limit', '1', '--workers', '3', '--build-every', '2']), patch.object(fetch, 'fetch_metadata', return_value=True) as request, patch.object(fetch.subprocess, 'run') as build:
                fetch.main()
            self.assertEqual(request.call_count, 1)
            report = json.loads((Path(folder) / 'fetch-report.json').read_text())
            self.assertEqual(report['completed'], 2)
            self.assertEqual(report['selected'], 3)
            self.assertEqual(report['newly_fetched'], 1)
            self.assertEqual(report['status'], 'complete')
            self.assertEqual([Path(call.args[0][1]).name for call in build.call_args_list],
                             ['export_archive.py', 'build.py'])


if __name__ == '__main__':
    unittest.main()
