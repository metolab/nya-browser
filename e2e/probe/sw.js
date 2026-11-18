importScripts('/collect-common.js');

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('message', (event) => {
  const port = event.ports && event.ports[0];
  if (!port) return;
  self.__nyaRun = (event.data && event.data.run) || '';
  event.waitUntil(self.nyaCollectCommon('serviceWorker').then((result) => port.postMessage(result)));
});
