importScripts('/collect-common.js');

self.onconnect = (event) => {
  const port = event.ports[0];
  port.onmessage = async (e) => {
    self.__nyaRun = (e.data && e.data.run) || '';
    port.postMessage(await self.nyaCollectCommon('sharedWorker'));
  };
  port.start();
};
