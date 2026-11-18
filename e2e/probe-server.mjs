#!/usr/bin/env node
// Probe server for OS emulation e2e and real-machine baselines.
// Node built-ins only so it runs on the host and inside the runtime image.
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import fs from 'fs';
import http from 'http';
import https from 'https';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROBE_DIR = path.join(HERE, 'probe');

const ACCEPT_CH = [
  'Sec-CH-UA',
  'Sec-CH-UA-Mobile',
  'Sec-CH-UA-Platform',
  'Sec-CH-UA-Platform-Version',
  'Sec-CH-UA-Arch',
  'Sec-CH-UA-Bitness',
  'Sec-CH-UA-Model',
  'Sec-CH-UA-Full-Version',
  'Sec-CH-UA-Full-Version-List',
  'Sec-CH-UA-WoW64',
  'Sec-CH-UA-Form-Factors',
  'Sec-CH-Device-Memory',
  'Device-Memory',
  'Sec-CH-DPR',
  'Sec-CH-Viewport-Width',
  'Sec-CH-Prefers-Color-Scheme',
  'Sec-CH-Prefers-Reduced-Motion',
].join(', ');

const CRITICAL_CH = ['Sec-CH-UA-Platform-Version', 'Sec-CH-UA-Full-Version-List', 'Sec-CH-UA-Arch', 'Sec-CH-UA-Bitness', 'Sec-CH-Device-Memory'].join(', ');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function localIps() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const addr of list || []) {
      if (addr.family === 'IPv4' && !addr.internal) out.push(addr.address);
    }
  }
  return out;
}

function ensureCert(certDir, sanIps) {
  fs.mkdirSync(certDir, { recursive: true });
  const keyPath = path.join(certDir, 'probe.key');
  const certPath = path.join(certDir, 'probe.crt');
  const sanPath = path.join(certDir, 'probe.san');
  const san = ['DNS:localhost', 'IP:127.0.0.1', ...sanIps.map((ip) => `IP:${ip}`)].join(',');
  const fresh = fs.existsSync(certPath) && fs.existsSync(keyPath) && fs.existsSync(sanPath) && fs.readFileSync(sanPath, 'utf8') === san;
  if (!fresh) {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '825',
      '-subj', '/CN=nya-probe',
      '-addext', `subjectAltName=${san}`,
      '-keyout', keyPath, '-out', certPath,
    ], { stdio: 'pipe' });
    fs.writeFileSync(sanPath, san);
  }
  const certPem = fs.readFileSync(certPath);
  const spkiDer = new crypto.X509Certificate(certPem).publicKey.export({ type: 'spki', format: 'der' });
  const spki = crypto.createHash('sha256').update(spkiDer).digest('base64');
  return { key: fs.readFileSync(keyPath), cert: certPem, spki };
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function safeLabel(raw) {
  return String(raw || 'report').replace(/[^\w.-]/g, '_').slice(0, 64) || 'report';
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export async function startProbeServer(opts = {}) {
  const host = opts.host || '0.0.0.0';
  const port = Number(opts.port ?? 18443);
  const outDir = path.resolve(opts.outDir || path.join(HERE, 'results', 'probe'));
  const tls = opts.tls !== false;
  const sanIps = Array.from(new Set([...(opts.sanIps || []), ...localIps()]));
  const recorded = new Map();
  // Real browsers open the page without ?run=, so keep their last navigation per client.
  const lastNavigation = new Map();
  const clientKey = (req) => `${req.socket.remoteAddress}|${req.headers['user-agent'] || ''}`;
  let rerun = 0;
  const record = (run, ctx, headers) => {
    if (!run) return;
    if (!recorded.has(run)) recorded.set(run, {});
    const entry = recorded.get(run);
    entry[ctx] = headers;
    entry[`${ctx}:history`] = [...(entry[`${ctx}:history`] || []), headers].slice(-4);
  };

  const handler = async (req, res) => {
    const url = new URL(req.url, 'https://probe.local');
    const run = url.searchParams.get('run') || '';
    try {
      if (url.pathname === '/api/echo') {
        const ctx = safeLabel(url.searchParams.get('ctx') || 'unknown');
        record(run, `fetch:${ctx}`, req.headers);
        return json(res, 200, { headers: req.headers });
      }
      if (url.pathname === '/api/headers') {
        const entry = recorded.get(run) || null;
        const nav = lastNavigation.get(clientKey(req));
        if (nav && !entry?.navigation) {
          return json(res, 200, { headers: { ...(entry || {}), navigation: nav, 'navigation:history': [nav] } });
        }
        return json(res, 200, { headers: entry });
      }
      if (url.pathname === '/api/spki') {
        return json(res, 200, { spki: server.spki || null });
      }
      if (url.pathname === '/api/health') {
        return json(res, 200, { ok: true });
      }
      if (url.pathname === '/api/version') {
        const mtimes = fs
          .readdirSync(PROBE_DIR)
          .map((f) => `${f}:${fs.statSync(path.join(PROBE_DIR, f)).mtimeMs}`)
          .join('|');
        const hash = crypto.createHash('sha256').update(`${mtimes}#${rerun}`).digest('hex').slice(0, 12);
        return json(res, 200, { version: hash });
      }
      if (url.pathname === '/api/rerun' && req.method === 'POST') {
        const remote = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
        if (remote !== '127.0.0.1' && !sanIps.includes(remote)) return json(res, 403, { error: 'local only' });
        rerun += 1;
        console.log(`[probe] rerun requested (${rerun})`);
        return json(res, 200, { rerun });
      }
      if (url.pathname === '/api/reports' && req.method === 'GET') {
        const dir = path.join(outDir, 'reports');
        const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
        return json(res, 200, { files });
      }
      if (url.pathname === '/api/report' && req.method === 'POST') {
        const body = await readBody(req, 64 * 1024 * 1024);
        const report = JSON.parse(body.toString('utf8'));
        const dir = path.join(outDir, 'reports');
        fs.mkdirSync(dir, { recursive: true });
        const file = `${stamp()}-${safeLabel(url.searchParams.get('label') || report?.meta?.label)}.json`;
        report.meta = { ...(report.meta || {}), receivedAt: new Date().toISOString(), remote: req.socket.remoteAddress };
        fs.writeFileSync(path.join(dir, file), JSON.stringify(report, null, 2));
        console.log(`[probe] report saved ${file} from ${req.socket.remoteAddress}`);
        return json(res, 200, { ok: true, file });
      }
      if (url.pathname === '/api/fonts' && req.method === 'POST') {
        const dir = path.join(outDir, 'fonts');
        fs.mkdirSync(dir, { recursive: true });
        const file = `${stamp()}-${safeLabel(url.searchParams.get('label'))}.zip`;
        const dest = path.join(dir, file);
        const limit = 2 * 1024 * 1024 * 1024;
        if (Number(req.headers['content-length'] || 0) > limit) return json(res, 413, { error: 'too large' });
        let bytes = 0;
        try {
          await new Promise((resolve, reject) => {
            const ws = fs.createWriteStream(dest);
            req.on('data', (c) => {
              bytes += c.length;
              if (bytes > limit) req.destroy(new Error('too large'));
            });
            req.pipe(ws);
            ws.on('finish', resolve);
            ws.on('error', reject);
            req.on('error', reject);
          });
        } catch (err) {
          fs.rmSync(dest, { force: true });
          throw err;
        }
        console.log(`[probe] fonts saved ${file} (${bytes} bytes) from ${req.socket.remoteAddress}`);
        return json(res, 200, { ok: true, file, bytes });
      }

      const rel = url.pathname === '/' ? '/index.html' : url.pathname;
      const filePath = path.join(PROBE_DIR, path.normalize(rel).replace(/^([/\\])+/, ''));
      if (!filePath.startsWith(PROBE_DIR) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('not found');
      }
      const headers = {
        'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      };
      if (rel === '/index.html' || rel === '/frame.html') {
        record(run, rel === '/index.html' ? 'navigation' : 'frameNavigation', req.headers);
        if (rel === '/index.html' && !run) lastNavigation.set(clientKey(req), req.headers);
        headers['Accept-CH'] = ACCEPT_CH;
        headers['Critical-CH'] = CRITICAL_CH;
        headers['Permissions-Policy'] = 'ch-ua-platform-version=*, ch-ua-arch=*, ch-ua-bitness=*, ch-ua-full-version-list=*, ch-ua-model=*, ch-ua-wow64=*, ch-ua-form-factors=*, ch-device-memory=*';
      }
      if (rel === '/sw.js') headers['Service-Worker-Allowed'] = '/';
      res.writeHead(200, headers);
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      json(res, 500, { error: String(err.message || err) });
    }
  };

  let server;
  if (tls) {
    const cert = ensureCert(opts.certDir || path.join(outDir, 'cert'), sanIps);
    server = https.createServer({ key: cert.key, cert: cert.cert }, handler);
    server.spki = cert.spki;
  } else {
    server = http.createServer(handler);
  }
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const actualPort = server.address().port;
  return {
    server,
    port: actualPort,
    spki: server.spki || null,
    ips: sanIps,
    urlFor: (ip) => `${tls ? 'https' : 'http'}://${ip}:${actualPort}`,
    headersFor: (run) => recorded.get(run) || null,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, v] = a.replace(/^--/, '').split('=');
      return [k, v ?? 'true'];
    }),
  );
  const probe = await startProbeServer({
    host: args.host,
    port: args.port,
    outDir: args.out,
    tls: args.plain !== 'true',
    sanIps: args.san ? args.san.split(',') : [],
  });
  console.log(`[probe] listening on port ${probe.port}`);
  for (const ip of probe.ips) console.log(`[probe] ${probe.urlFor(ip)}/?source=real`);
  if (probe.spki) console.log(`[probe] spki ${probe.spki}`);
}
