#!/usr/bin/env python3
"""開発用サーバ。リポジトリルートを静的配信し、POST /save?name=X を data/X.json に保存する。
（node が無い環境で gen_runner.html からサンプルデータを書き出すための補助。本番は GitHub Pages の静的配信のみ）
用法: python3 scripts/dev_server.py [port]
"""
import os, sys, re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def do_POST(self):
        u = urlparse(self.path)
        if u.path != '/save':
            self.send_error(404); return
        name = parse_qs(u.query).get('name', [''])[0]
        if not re.fullmatch(r'[a-z_]+', name):
            self.send_error(400, 'bad name'); return
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)
        os.makedirs(os.path.join(ROOT, 'data'), exist_ok=True)
        with open(os.path.join(ROOT, 'data', name + '.json'), 'wb') as f:
            f.write(body)
        self.send_response(200); self.end_headers(); self.wfile.write(b'ok')

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8642
    print(f'serving {ROOT} on http://localhost:{port}')
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
