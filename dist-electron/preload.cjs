"use strict";
// Preload script for security context isolation
// This file can expose specific APIs to the renderer process
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
// You can add APIs here for the renderer process
});
//# sourceMappingURL=preload.js.map