#!/usr/bin/env node
// OS emulation e2e: collect probe reports from Nya sessions and compare them
// against real-machine baselines (docs/windows-emulation.md, section 5).
//
//   node scripts/e2e-os.mjs [--cases=linux,win11,win10,lifecycle] [--out=DIR] [--collect-only] [--update-snapshot]
//   node scripts/e2e-os.mjs --evaluate=DIR [--cases=...]   # re-run the rules on collected samples
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { startProbeServer } from '../e2e/probe-server.mjs';
import {
  api,
  deleteSessionsByPrefix,
  evaluate,
  login,
  openCdp,
  openPage,
  sleep,
  waitBrowser,
} from '../e2e/lib/nya.mjs';
import { CASES, evaluateCases, snapshotMetrics } from '../e2e/lib/os-cases.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PREFIX = 'os-e2e-';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  }),
);
const OUT = path.resolve(args.out || path.join(ROOT, 'e2e', 'results', 'os'));
const FIXTURES = path.resolve(args.fixtures || path.join(ROOT, 'e2e', 'fixtures'));

function probeIp() {
  if (process.env.NYA_PROBE_IP) return process.env.NYA_PROBE_IP;
  for (const list of Object.values(os.networkInterfaces())) {
    for (const addr of list || []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  throw new Error('no non-loopback IPv4 for the probe server');
}

async function collectOnce(cdpPort, browser, base, label) {
  const run = `${label}-${Math.random().toString(36).slice(2, 8)}`;
  const page = await openPage(cdpPort, browser, `${base}/?source=nya&label=${encodeURIComponent(label)}&run=${run}`);
  try {
    const started = Date.now();
    while (Date.now() - started < 150000) {
      const state = await evaluate(page, 'window.__nyaProbe ? { done: window.__nyaProbe.done, error: window.__nyaProbe.error || null } : null', {
        awaitPromise: false,
      }).catch(() => null);
      if (state?.error) throw new Error(`probe failed: ${state.error}`);
      if (state?.done) break;
      await sleep(500);
    }
    const report = await evaluate(page, 'window.__nyaProbe && window.__nyaProbe.report', { awaitPromise: false });
    if (!report) throw new Error('probe did not finish');
    return report;
  } finally {
    await browser.send('Target.closeTarget', { targetId: page.targetId }).catch(() => {});
    page.close();
  }
}

async function collectCase(cookie, base, name, spec) {
  const created = await api(cookie, '/api/sessions', 'POST', {
    name: `${PREFIX}${name}-${Date.now().toString(36)}`,
    homeUrl: `${base}/api/health`,
    ...spec.session,
  });
  let session = created.session;
  if (spec.patch) session = (await api(cookie, `/api/sessions/${session.id}`, 'PATCH', spec.patch)).session;
  try {
    const started = await api(cookie, `/api/sessions/${session.id}/start`, 'POST');
    const cdpPort = started.runtime?.cdpPort;
    if (!cdpPort) throw new Error(`session ${session.id} has no cdpPort`);
    const version = await waitBrowser(cdpPort);
    const browser = openCdp(version.webSocketDebuggerUrl);
    await browser.ready;
    try {
      await browser.send('Security.setIgnoreCertificateErrors', { ignore: true });
      const first = await collectOnce(cdpPort, browser, base, name);
      const second = spec.stability === false ? null : await collectOnce(cdpPort, browser, base, `${name}-again`);
      const list = await api(cookie, '/api/sessions').catch(() => ({}));
      const latest = (list.sessions || []).find((s) => s.id === session.id) || session;
      return { name, session: latest, cdpVersion: version, first, second };
    } finally {
      browser.close();
    }
  } finally {
    await api(cookie, `/api/sessions/${session.id}/stop`, 'POST').catch(() => {});
    await api(cookie, `/api/sessions/${session.id}`, 'DELETE').catch(() => {});
  }
}

const IDENTITY_JS = `(async () => {
  const he = await navigator.userAgentData.getHighEntropyValues(['platformVersion']);
  return JSON.stringify({ platform: navigator.platform, ch: navigator.userAgentData.platform, pv: he.platformVersion, ua: navigator.userAgent });
})()`;

async function browserIdentity(cdpPort, previousWs, base) {
  const started = Date.now();
  let version;
  for (;;) {
    version = await waitBrowser(cdpPort, 90000);
    if (version.webSocketDebuggerUrl !== previousWs) break;
    if (Date.now() - started > 90000) throw new Error('browser did not restart');
    await sleep(1000);
  }
  const browser = openCdp(version.webSocketDebuggerUrl);
  await browser.ready;
  try {
    await browser.send('Security.setIgnoreCertificateErrors', { ignore: true });
    // userAgentData needs a secure context.
    const page = await openPage(cdpPort, browser, `${base}/api/health`);
    try {
      return { ws: version.webSocketDebuggerUrl, id: JSON.parse(await evaluate(page, IDENTITY_JS)) };
    } finally {
      await browser.send('Target.closeTarget', { targetId: page.targetId }).catch(() => {});
      page.close();
    }
  } finally {
    browser.close();
  }
}

async function expectRejected(fn) {
  try {
    await fn();
    return false;
  } catch (err) {
    return err.status === 400;
  }
}

/** T7: OS switches restart Chrome, defaults stay linux, bad values are rejected. */
async function lifecycleRows(cookie, base) {
  const rows = [];
  const add = (id, rule, ok, detail) => rows.push({ case: 'lifecycle', id, rule, status: ok ? 'PASS' : 'FAIL', detail });
  const name = `${PREFIX}lifecycle-${Date.now().toString(36)}`;
  const plain = await api(cookie, '/api/sessions', 'POST', { name: `${name}-default`, homeUrl: 'about:blank' });
  const fp = plain.session.fingerprint || {};
  add(
    'T7-default',
    'exact',
    fp.os === 'windows' && fp.windowsRelease === 'win11' && fp.webrtcMode === 'offline',
    { os: fp.os, windowsRelease: fp.windowsRelease, webrtcMode: fp.webrtcMode },
  );
  await api(cookie, `/api/sessions/${plain.session.id}`, 'DELETE').catch(() => {});

  const badOs = await expectRejected(() => api(cookie, '/api/sessions', 'POST', { name: `${name}-bad`, os: 'mac' }));
  const badRelease = await expectRejected(() =>
    api(cookie, '/api/sessions', 'POST', { name: `${name}-bad`, os: 'windows', windowsRelease: 'win7' }),
  );
  await deleteSessionsByPrefix(cookie, `${name}-bad`);

  const created = await api(cookie, '/api/sessions', 'POST', { name, homeUrl: 'about:blank', os: 'windows', windowsRelease: 'win11' });
  const id = created.session.id;
  try {
    const badPatch = await expectRejected(() => api(cookie, `/api/sessions/${id}`, 'PATCH', { os: 'android' }));
    add('T7-reject', 'validation', badOs && badRelease && badPatch, { badOs, badRelease, badPatch });

    const started = await api(cookie, `/api/sessions/${id}/start`, 'POST');
    const cdpPort = started.runtime?.cdpPort;
    const win11 = await browserIdentity(cdpPort, null, base);
    add('T7-win11', 'exact', win11.id.platform === 'Win32' && win11.id.ch === 'Windows' && win11.id.pv === '19.0.0', win11.id);

    const toLinux = await api(cookie, `/api/sessions/${id}`, 'PATCH', { os: 'linux' });
    const linux = await browserIdentity(cdpPort, win11.ws, base);
    add(
      'T7-linux',
      'restart',
      toLinux.session.fingerprint.os === 'linux' && linux.id.platform === 'Linux x86_64' && linux.id.ch === 'Linux',
      { stored: toLinux.session.fingerprint.os, ...linux.id },
    );

    const toWin10 = await api(cookie, `/api/sessions/${id}`, 'PATCH', { os: 'windows', windowsRelease: 'win10' });
    const win10 = await browserIdentity(cdpPort, linux.ws, base);
    add(
      'T7-win10',
      'restart',
      toWin10.session.fingerprint.windowsRelease === 'win10' && win10.id.platform === 'Win32' && win10.id.pv === '10.0.0',
      { stored: toWin10.session.fingerprint, ...win10.id },
    );
  } finally {
    await api(cookie, `/api/sessions/${id}/stop`, 'POST').catch(() => {});
    await api(cookie, `/api/sessions/${id}`, 'DELETE').catch(() => {});
  }
  return rows;
}

async function main() {
  const wanted = String(args.cases || [...Object.keys(CASES), 'lifecycle'].join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const name of wanted) if (!CASES[name] && name !== 'lifecycle') throw new Error(`unknown case ${name}`);
  fs.mkdirSync(OUT, { recursive: true });
  if (args.evaluate) {
    const samples = {};
    for (const name of wanted) {
      const file = path.join(path.resolve(args.evaluate), `${name}.json`);
      if (fs.existsSync(file)) samples[name] = JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    report(samples, []);
    return;
  }

  const probe = await startProbeServer({ port: Number(args.port || 0), outDir: path.join(OUT, 'probe') });
  const base = probe.urlFor(probeIp());
  process.stderr.write(`probe ${base}\n`);
  const cookie = await login();
  await deleteSessionsByPrefix(cookie, PREFIX);

  const samples = {};
  const errors = [];
  const extra = [];
  try {
    for (const name of wanted) {
      if (name === 'lifecycle') continue;
      process.stderr.write(`collect ${name}\n`);
      try {
        samples[name] = await collectCase(cookie, base, name, CASES[name]);
        fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(samples[name], null, 2));
      } catch (err) {
        errors.push({ name, error: String(err.stack || err) });
        process.stderr.write(`  failed ${name}: ${err.message}\n`);
      }
      await sleep(500);
    }
    if (wanted.includes('lifecycle')) {
      process.stderr.write('lifecycle\n');
      try {
        extra.push(...(await lifecycleRows(cookie, base)));
      } catch (err) {
        errors.push({ name: 'lifecycle', error: String(err.stack || err) });
      }
    }
  } finally {
    await probe.close();
  }

  if (args['update-snapshot'] === 'true' && samples.linux) {
    const browser = String(samples.linux.cdpVersion?.Browser || '');
    const dir = path.join(FIXTURES, 'linux', browser.split('/')[1]?.split('.')[0] || 'unknown');
    fs.mkdirSync(dir, { recursive: true });
    const snapshot = {
      meta: { browser, collectedAt: samples.linux.first.meta?.collectedAt },
      metrics: snapshotMetrics(samples.linux.first),
    };
    fs.writeFileSync(path.join(dir, 'snapshot.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
    process.stderr.write(`wrote ${path.join(dir, 'snapshot.json')}\n`);
  }

  if (args['collect-only'] === 'true') {
    console.log(JSON.stringify({ ok: errors.length === 0, errors, out: OUT }, null, 2));
    process.exit(errors.length ? 1 : 0);
  }

  report(samples, errors, extra);
}

function report(samples, errors, extra = []) {
  const result = evaluateCases(samples, { fixturesDir: FIXTURES });
  result.rows.push(...extra);
  result.errors = errors;
  result.ok = errors.length === 0 && result.rows.every((r) => r.status !== 'FAIL');
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(result, null, 2));
  for (const row of result.rows) {
    const detail = row.status === 'PASS' ? '' : ` ${JSON.stringify(row.detail).slice(0, 220)}`;
    console.log(`${row.status.padEnd(5)} ${row.case.padEnd(8)} ${row.id.padEnd(8)} ${row.rule.padEnd(11)}${detail}`);
  }
  const count = (s) => result.rows.filter((r) => r.status === s).length;
  console.log(`\nPASS ${count('PASS')}  FAIL ${count('FAIL')}  ALLOW ${count('ALLOW')}  INFO ${count('INFO')}  SKIP ${count('SKIP')}  errors ${errors.length}`);
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
