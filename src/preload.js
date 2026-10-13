'use strict';
/* Tiny, safe bridge for the program's own screens (welcome animation and
   "no internet" page). The WorkTrail website itself gets no bridge at all. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wt', {
	siteState: () => ipcRenderer.invoke('site-state'),
	onSiteState: (cb) => ipcRenderer.on('site-state', (_event, state) => cb(state)),
	enter: () => ipcRenderer.send('enter'),
	retry: () => ipcRenderer.send('retry'),
	version: () => ipcRenderer.invoke('version'),
});
