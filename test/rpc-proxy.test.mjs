import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const expectedUserAgent = "swissledger-anonset-rpc-proxy/1.0";

async function listen(server) {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return server.address().port;
}

async function unusedPort() {
    const server = createServer();
    const port = await listen(server);
    await new Promise((resolveClose) => server.close(resolveClose));
    return port;
}

test("RPC proxy sends the named user agent required by the SwissLedger WAF", async () => {
    let receivedUserAgent;
    const upstream = createServer((request, response) => {
        receivedUserAgent = request.headers["user-agent"];
        request.resume();
        if (receivedUserAgent !== expectedUserAgent) {
            response.writeHead(403, { "content-type": "text/plain" });
            response.end("error code: 1010");
            return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0xde" }));
    });
    const upstreamPort = await listen(upstream);
    const proxyPort = await unusedPort();
    const proxy = spawn(
        "python3",
        [
            "scripts/rpc-proxy.py",
            "--listen",
            `127.0.0.1:${proxyPort}`,
            "--target",
            `http://127.0.0.1:${upstreamPort}`,
        ],
        { cwd: root, stdio: "ignore" },
    );

    try {
        let response;
        for (let attempt = 0; attempt < 40; attempt += 1) {
            try {
                response = await fetch(`http://127.0.0.1:${proxyPort}`, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId" }),
                });
                break;
            } catch {
                await new Promise((resolveWait) => setTimeout(resolveWait, 25));
            }
        }
        assert.ok(response, "proxy did not become ready");
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { jsonrpc: "2.0", id: 1, result: "0xde" });
        assert.equal(receivedUserAgent, expectedUserAgent);
    } finally {
        proxy.kill("SIGTERM");
        await Promise.race([
            once(proxy, "exit"),
            new Promise((resolveWait) => setTimeout(resolveWait, 1_000)),
        ]);
        await new Promise((resolveClose) => upstream.close(resolveClose));
    }
});
