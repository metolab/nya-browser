(function () {
  const params = new URLSearchParams(location.search);
  const run = params.get('run') || Math.random().toString(36).slice(2, 10);
  self.__nyaRun = run;
  const statusEl = document.getElementById('status');

  function status(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function timeout(ms, label) {
    return new Promise((resolve) => setTimeout(() => resolve({ error: 'timeout: ' + label }), ms));
  }

  function viaWorker(worker, port) {
    return new Promise((resolve) => {
      const target = port || worker;
      target.onmessage = (e) => resolve(e.data);
      target.onmessageerror = () => resolve({ error: 'messageerror' });
      if (worker.onerror !== undefined) worker.onerror = (e) => resolve({ error: 'worker error: ' + (e.message || 'unknown') });
      target.postMessage({ run });
    });
  }

  async function dedicatedWorker() {
    if (typeof Worker === 'undefined') return { error: 'no Worker' };
    const w = new Worker('/worker.js?run=' + run);
    const r = await Promise.race([viaWorker(w), timeout(15000, 'dedicatedWorker')]);
    w.terminate();
    return r;
  }

  async function sharedWorker() {
    if (typeof SharedWorker === 'undefined') return { error: 'no SharedWorker' };
    const w = new SharedWorker('/shared-worker.js?run=' + run);
    w.port.start();
    return Promise.race([viaWorker(w, w.port), timeout(15000, 'sharedWorker')]);
  }

  async function serviceWorker() {
    if (!navigator.serviceWorker) return { error: 'no serviceWorker' };
    try {
      const reg = await Promise.race([navigator.serviceWorker.register('/sw.js', { scope: '/' }), timeout(8000, 'register')]);
      if (reg && reg.error) return reg;
      const ready = await Promise.race([navigator.serviceWorker.ready, timeout(8000, 'ready')]);
      if (ready && ready.error) return ready;
      const sw = ready.active;
      const channel = new MessageChannel();
      const result = new Promise((resolve) => {
        channel.port1.onmessage = (e) => resolve(e.data);
      });
      sw.postMessage({ run }, [channel.port2]);
      return await Promise.race([result, timeout(15000, 'serviceWorker')]);
    } catch (err) {
      return { error: String(err) };
    }
  }

  function iframe() {
    return Promise.race([
      new Promise((resolve) => {
        const f = document.createElement('iframe');
        f.style.cssText = 'width:10px;height:10px;border:0;position:absolute;left:-100px;';
        f.src = '/frame.html?run=' + run;
        window.addEventListener('message', function onMsg(e) {
          if (e.source !== f.contentWindow) return;
          window.removeEventListener('message', onMsg);
          resolve(e.data);
          f.remove();
        });
        document.body.appendChild(f);
      }),
      timeout(20000, 'iframe'),
    ]);
  }

  // A fresh document reads outer* as 0 (or equal to inner*) until the browser
  // pushes the window rect, which can land after the probe has finished.
  async function windowSettled() {
    if (document.readyState !== 'complete') await new Promise((r) => window.addEventListener('load', r, { once: true }));
    const until = Date.now() + 3000;
    while (Date.now() < until && !(window.outerWidth > window.innerWidth || window.outerHeight > window.innerHeight)) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  async function main() {
    const started = Date.now();
    await windowSettled();
    const report = {
      schema: 1,
      meta: {
        run,
        source: params.get('source') || 'unknown',
        label: params.get('label') || '',
        href: location.href,
        collectedAt: new Date().toISOString(),
      },
      contexts: {},
      main: null,
      navigationHeaders: null,
    };
    status('采集主线程…');
    report.contexts.main = await nyaCollectCommon('main');
    status('采集 Dedicated Worker…');
    report.contexts.dedicatedWorker = await dedicatedWorker();
    status('采集 Shared Worker…');
    report.contexts.sharedWorker = await sharedWorker();
    status('采集 Service Worker…');
    report.contexts.serviceWorker = await serviceWorker();
    status('采集 iframe…');
    report.contexts.iframe = await iframe();
    status('采集字体、主题、媒体、API…');
    report.main = await nyaCollectMain();
    try {
      const res = await fetch('/api/headers?run=' + run, { cache: 'no-store' });
      report.navigationHeaders = (await res.json()).headers || null;
    } catch (err) {
      report.navigationHeaders = { error: String(err) };
    }
    report.meta.elapsedMs = Date.now() - started;
    window.__nyaProbe = { done: true, report };
    status('采集完成，用时 ' + Math.round(report.meta.elapsedMs / 100) / 10 + ' 秒');
    if (typeof window.nyaProbeDone === 'function') window.nyaProbeDone(report);
  }

  window.__nyaProbe = { done: false, report: null };
  main().catch((err) => {
    window.__nyaProbe = { done: true, error: String((err && err.stack) || err), report: null };
    status('采集失败：' + err);
  });
})();
