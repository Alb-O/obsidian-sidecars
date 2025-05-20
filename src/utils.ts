// src/utils.ts
import type { SidecarPluginSettings } from './types';

export function getExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.');
  if (lastDot === -1 || lastDot === 0 || lastDot === filePath.length - 1) {
    return '';
  }
  return filePath.substring(lastDot + 1).toLowerCase();
}

export function isPathInFolderList(filePath: string, folderList: string[] | undefined): boolean {
  if (!folderList || folderList.length === 0) return false;
  // Normalize path to always use forward slashes
  const normalized = filePath.replace(/\\/g, '/');
  return folderList.some(pattern => {
    try {
      return new RegExp(pattern).test(normalized);
    } catch {
      return false;
    }
  });
}

export function isFileAllowedByFolderLists(filePath: string, settings: SidecarPluginSettings): boolean {
  // If whitelist is set, only allow if matches whitelist
  const matchesWhitelist = settings.whitelistFolders && settings.whitelistFolders.length > 0
    ? isPathInFolderList(filePath, settings.whitelistFolders)
    : true;
  if (!matchesWhitelist) return false;
  // If blacklist is set, disallow if matches blacklist (even if inside a whitelisted folder)
  if (settings.blacklistFolders && settings.blacklistFolders.length > 0) {
    if (isPathInFolderList(filePath, settings.blacklistFolders)) return false;
  }
  return true;
}

export function isMonitoredFile(filePath: string, settings: SidecarPluginSettings, isSidecarFile: (filePath: string) => boolean): boolean {
  if (isSidecarFile(filePath)) return false;
  if (!isFileAllowedByFolderLists(filePath, settings)) return false;
  const extension = getExtension(filePath);
  return extension ? settings.monitoredExtensions.includes(extension) : false;
}

export function getSidecarPath(sourcePath: string, settings: SidecarPluginSettings): string {
  return sourcePath + settings.sidecarSuffix;
}

export function isSidecarFile(filePath: string, settings: SidecarPluginSettings): boolean {
  return filePath.endsWith(settings.sidecarSuffix);
}

export function getSourcePathFromSidecar(sidecarPath: string, settings: SidecarPluginSettings): string | null {
  if (!isSidecarFile(sidecarPath, settings)) return null;
  return sidecarPath.substring(0, sidecarPath.length - settings.sidecarSuffix.length);
}
