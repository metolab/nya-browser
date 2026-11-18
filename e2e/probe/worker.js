importScripts('/collect-common.js');

self.onmessage = async (e) => {
  self.__nyaRun = (e.data && e.data.run) || '';
  self.postMessage(await self.nyaCollectCommon('dedicatedWorker'));
};
