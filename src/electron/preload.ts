// Preload script for security context isolation
// This file can expose specific APIs to the renderer process

import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // You can add APIs here for the renderer process
});

