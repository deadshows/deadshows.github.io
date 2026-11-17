#!/usr/bin/env python3
"""Serve the generated site on loopback only."""
import http.server
from pathlib import Path
from functools import partial
ROOT = Path(__file__).resolve().parents[1]

class PreviewHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

handler = partial(PreviewHandler, directory=str(ROOT / 'dist'))
print('Local: http://127.0.0.1:4173', flush=True)
http.server.ThreadingHTTPServer(('127.0.0.1', 4173), handler).serve_forever()
