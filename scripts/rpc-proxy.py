#!/usr/bin/env python3
"""JSON-RPC proxy that injects mandatory 'params' field for ledger.swiss compatibility.

The Swissledger Blockscout RPC endpoint requires every JSON-RPC request to
include the "params" field, even when empty. Standard JSON-RPC 2.0 allows
omitting it, so forge and cast skip it for zero-param methods.

Usage:
    python3 scripts/rpc-proxy.py [--listen 127.0.0.1:8545] [--target https://explorer.ledger.swiss/api/eth-rpc]
"""

import http.server
import json
import sys
import urllib.request
import argparse


class RpcProxy(http.server.BaseHTTPRequestHandler):
    target_url = "https://explorer.ledger.swiss/api/eth-rpc"

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)

        try:
            request = json.loads(body)
        except json.JSONDecodeError:
            self._send_error(400, "Invalid JSON")
            return

        # Inject missing params
        if isinstance(request, dict) and "params" not in request:
            request["params"] = []

        modified_body = json.dumps(request).encode()

        try:
            req = urllib.request.Request(
                self.target_url,
                data=modified_body,
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                response_body = resp.read()
        except Exception as e:
            self._send_error(502, str(e))
            return

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(response_body)

    def _send_error(self, code, message):
        err = json.dumps({"jsonrpc": "2.0", "error": {"code": code, "message": message}, "id": None})
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(err.encode())

    def log_message(self, format, *args):
        sys.stderr.write(f"[proxy] {args[0]}\n")


def main():
    parser = argparse.ArgumentParser(description="JSON-RPC params-injection proxy")
    parser.add_argument("--listen", default="127.0.0.1:8545", help="Listen address (default: 127.0.0.1:8545)")
    parser.add_argument("--target", default="https://explorer.ledger.swiss/api/eth-rpc",
                        help="Upstream RPC URL")
    args = parser.parse_args()

    host, port = args.listen.rsplit(":", 1)
    RpcProxy.target_url = args.target

    server = http.server.HTTPServer((host, int(port)), RpcProxy)
    sys.stderr.write(f"[proxy] Listening on {host}:{port} → {args.target}\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        sys.stderr.write("\n[proxy] Shutting down.\n")


if __name__ == "__main__":
    main()
