// Loopback mock of the pinned sub2api HTTP surface, driven by the Rust
// integration tests over stdio. Each line of stdin is one expected upstream
// request; unexpected traffic is always rejected so tests fail loudly
// instead of silently talking to the wrong surface.
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { createServer } from 'node:http';

const server = createServer(async (req, res) => {
  const expectation = pending.shift();
  if (!expectation) {
    rejected.push(`${req.method} ${req.url}`);
    res.writeHead(500).end('mock: unexpected upstream request');
    return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const problems = [];
  if (req.method !== expectation.method) problems.push(`method ${req.method} != ${expectation.method}`);
  if (req.url !== expectation.path) problems.push(`path ${req.url} != ${expectation.path}`);
  if (!body.equals(expectation.body ?? Buffer.alloc(0))) problems.push(`body mismatch`);
  for (const [name, value] of Object.entries(expectation.headers ?? {})) {
    if (req.headers[name] !== value) problems.push(`header ${name}: ${req.headers[name]} != ${value}`);
  }
  if (problems.length > 0) {
    rejected.push(problems.join('; '));
    res.writeHead(500).end('mock: expectation violated');
    return;
  }
  served++;
  const { status = 200, headers = {}, response = '' } = expectation;
  if (typeof response === 'string' || Buffer.isBuffer(response)) {
    res.writeHead(status, headers).end(response);
  } else {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(response));
  }
});

const pending = [];
const rejected = [];
let served = 0;

server.listen(0, '127.0.0.1');
await once(server, 'listening');
process.stdout.write(`http://127.0.0.1:${server.address().port}\n`);

for await (const line of createInterface({ input: process.stdin })) {
  const command = line.trim();
  if (!command) continue;
  if (command === 'status') {
    process.stdout.write(JSON.stringify({ served, rejected, pending: pending.length }) + '\n');
  } else if (command === 'shutdown') {
    server.closeAllConnections();
    server.close(() => process.exit(0));
  } else {
    const expectation = JSON.parse(command);
    expectation.body = expectation.body ? Buffer.from(expectation.body, 'base64') : undefined;
    pending.push(expectation);
  }
}
