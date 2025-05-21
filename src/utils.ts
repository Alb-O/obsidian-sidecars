import type { SidecarPluginSettings } from './settings';

export function getExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.');
  if (lastDot === -1 || lastDot === 0 || lastDot === filePath.length - 1) {
    return '';
  }
  return filePath.substring(lastDot + 1).toLowerCase();
}

/**
 * Convert a user-friendly pattern (with *, /, and vault-relative paths) to a valid regex string.
 * - * matches any number of characters except path separator
 * - ** matches any number of characters including path separator
 * - / at the start means vault root
 * - All patterns are matched against normalized forward-slash paths
 */
export function userPatternToRegex(pattern: string, useRegex: boolean): string {
  const orig = pattern.trim();
  if (!orig) return '';
  if (useRegex) {
    // Treat as full regex, use as-is
    return orig;
  }
  // Only * is supported as a wildcard for any depth, / for root
  // Escape regex special chars except * and /
  let pat = orig.replace(/([.+?^${}()|[\\]\\])/g, '\\$1');
  // Replace * with .*
  pat = pat.replace(/\*/g, '.*');
  // If starts with /, anchor to start
  if (pat.startsWith('/')) pat = '^' + pat.slice(1);
  else pat = '.*' + pat;
  // If ends with /, match anything after (subfolders/files)
  if (pat.endsWith('/')) pat = pat + '.*';
  // If pattern does not start with vault-root '/', allow matching at string start as well as after '/'
  if (!orig.startsWith('/')) {
    pat = pat.replace(/\//g, '(?:/|^)');
  }
  return pat;
}

export function isPathInFolderList(filePath: string, folderList: string[] | undefined, useRegex: boolean = false): boolean {
  if (!folderList || folderList.length === 0) return false;
  // Normalize path to always use forward slashes
  const normalized = filePath.replace(/\\/g, '/');
  return folderList.some(pattern => {
    const regexStr = userPatternToRegex(pattern, useRegex);
    if (!regexStr) return false;
    try {
      return new RegExp(regexStr).test(normalized);
    } catch {
      return false;
    }
  });
}

export function isFileAllowedByFolderLists(filePath: string, settings: SidecarPluginSettings): boolean {
  // If whitelist is set, only allow if the file is inside (or matches) a whitelisted folder
  if (settings.whitelistFolders && settings.whitelistFolders.length > 0) {
    if (!isPathInFolderList(filePath, settings.whitelistFolders, settings.useRegexForFolderLists)) return false;
  }
  // If blacklist is set, disallow if matches blacklist (even if inside a whitelisted folder)
  if (settings.blacklistFolders && settings.blacklistFolders.length > 0) {
    if (isPathInFolderList(filePath, settings.blacklistFolders, settings.useRegexForFolderLists)) return false;
  }
  return true;
}

export function isMonitoredFile(filePath: string, settings: SidecarPluginSettings, isSidecarFile: (filePath: string) => boolean): boolean {
  if (isSidecarFile(filePath)) return false;
  if (!isFileAllowedByFolderLists(filePath, settings)) return false;
  const extension = getExtension(filePath);
  // Ensure monitoredExtensions are compared case-insensitively and without leading dots if user adds them.
  return extension ? settings.monitoredExtensions.map(ext => ext.toLowerCase().replace(/^\./, '')).includes(extension) : false;
}

export function getSidecarPath(sourcePath: string, settings: SidecarPluginSettings): string {
  return sourcePath + '.' + settings.sidecarSuffix + '.md';
}

export function isSidecarFile(filePath: string, settings: SidecarPluginSettings): boolean {
  return filePath.endsWith('.' + settings.sidecarSuffix + '.md');
}

export function getSourcePathFromSidecar(sidecarPath: string, settings: SidecarPluginSettings): string | null {
  const fullSuffix = '.' + settings.sidecarSuffix + '.md';
  if (sidecarPath.endsWith(fullSuffix)) {
    return sidecarPath.substring(0, sidecarPath.length - fullSuffix.length);
  }
  return null;
}
