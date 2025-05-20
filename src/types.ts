// src/types.ts

export interface SidecarPluginSettings {
  monitoredExtensions: string[];
  sidecarSuffix: string;
  blacklistFolders?: string[];
  whitelistFolders?: string[];
  hideSidecarsInExplorer?: boolean;
}

export const DEFAULT_SETTINGS: SidecarPluginSettings = {
  monitoredExtensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'pdf', 'mp3', 'mp4', 'mov', 'wav', 'webm'],
  sidecarSuffix: '.side.md',
  blacklistFolders: [],
  whitelistFolders: [],
  hideSidecarsInExplorer: false,
};
