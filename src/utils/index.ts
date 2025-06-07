import type { SidecarPluginSettings } from '../settings';

export function getExtension(filePath: string): string {
	const lastDot = filePath.lastIndexOf('.');
	if (lastDot === -1 || lastDot === 0 || lastDot === filePath.length - 1) {
		return '';
	}
	return filePath.substring(lastDot + 1).toLowerCase();
}

// Helper function to get directory name
export function getDirname(filePath: string): string {
	const lastSlash = filePath.lastIndexOf('/');
	if (lastSlash === -1) {
		return ''; // Root directory or no slashes
	}
	return filePath.substring(0, lastSlash);
}

// Helper function to get base name (file name with extension)
export function getBasename(filePath: string): string {
	const lastSlash = filePath.lastIndexOf('/');
	return filePath.substring(lastSlash + 1);
}

// Helper function to join path segments
export function joinPath(dir: string, file: string): string {
	if (!dir) return file; // If dir is empty (root), just return file
	if (dir.endsWith('/')) return dir + file;
	return dir + '/' + file;
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
	// Use the correct property names from settings.ts
	const {
		blacklistFolders,
		whitelistFolders,
		useRegexForFolderLists
	} = settings;

	// If whitelist is set, only allow if the file is inside (or matches) a whitelisted folder
	if (whitelistFolders && whitelistFolders.length > 0) {
		if (!isPathInFolderList(filePath, whitelistFolders, useRegexForFolderLists)) return false;
	}
	// If blacklist is set, disallow if matches blacklist (even if inside a whitelisted folder)
	if (blacklistFolders && blacklistFolders.length > 0) {
		if (isPathInFolderList(filePath, blacklistFolders, useRegexForFolderLists)) return false;
	}
	return true;
}

export function isMonitoredFileUtil(filePath: string, settings: SidecarPluginSettings, isDerivativeFile: (filePath: string) => boolean): boolean {
	if (isDerivativeFile(filePath)) return false; // Check if it's any kind of derivative file
	if (!isFileAllowedByFolderLists(filePath, settings)) return false;
	const extension = getExtension(filePath);
	// Ensure monitoredExtensions are compared case-insensitively and without leading dots if user adds them.
	return extension ? settings.monitoredExtensions.map(ext => ext.toLowerCase().replace(/^\./, '')).includes(extension) : false;
}

/**
 * Converts a path to a POSIX-compliant path (uses forward slashes).
 * @param path The path to convert.
 * @returns The POSIX-compliant path.
 */
export function toPosixPath(path: string): string {
    return path.replace(/\\/g, "/");
}

export function getSidecarPathUtil(sourcePath: string, settings: SidecarPluginSettings): string {
	return sourcePath + '.' + settings.sidecarSuffix + '.md';
}

export function isSidecarFileUtil(filePath: string, settings: SidecarPluginSettings): boolean {
	return filePath.endsWith('.' + settings.sidecarSuffix + '.md');
}

export function getSourcePathFromSidecarUtil(sidecarPath: string, settings: SidecarPluginSettings): string | null {
	const fullSuffix = '.' + settings.sidecarSuffix + '.md';
	if (sidecarPath.endsWith(fullSuffix)) {
		return sidecarPath.substring(0, sidecarPath.length - fullSuffix.length);
	}
	return null;
}

export function getRedirectPathUtil(sourcePath: string, settings: SidecarPluginSettings): string {
	return sourcePath + '.' + settings.redirectFileSuffix + '.md';
}

export function isRedirectFileUtil(filePath: string, settings: SidecarPluginSettings): boolean {
	return filePath.endsWith('.' + settings.redirectFileSuffix + '.md');
}

export function getSourcePathFromRedirectUtil(redirectPath: string, settings: SidecarPluginSettings): string | null {
	const fullSuffix = '.' + settings.redirectFileSuffix + '.md';
	if (redirectPath.endsWith(fullSuffix)) {
		return redirectPath.substring(0, redirectPath.length - fullSuffix.length);
	}
	return null;
}