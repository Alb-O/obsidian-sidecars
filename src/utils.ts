import type { SidecarPluginSettings } from './settings';

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

// --- redirect File Utilities ---

/**
 * Checks if redirect file management is enabled and properly configured.
 * This is used for determining whether to create/manage redirect files.
 * @param settings The plugin settings.
 * @returns True if redirect file management is enabled and configured, false otherwise.
 */
export function isRedirectFileManagementEnabledUtil(settings: SidecarPluginSettings): boolean {
	return Boolean(settings.enableRedirectFile) && 
		   Boolean(settings.redirectFileSuffix) && 
		   settings.redirectFileSuffix.trim() !== '';
}

/**
 * Checks if a given file path corresponds to a redirect file.
 * A redirect file is created when a monitored file is moved/renamed, indicating its new location.
 * @param filePath The path of the file to check.
 * @param settings The plugin settings.
 * @returns True if the file is a redirect file, false otherwise.
 */
/**
 * Checks if a given file path corresponds to a redirect file for STYLING purposes.
 * This checks the file pattern regardless of whether redirect file management is enabled.
 * @param filePath The path of the file to check.
 * @param settings The plugin settings.
 * @returns True if the file matches the redirect file pattern, false otherwise.
 */
export function isRedirectFileUtil(filePath: string, settings: SidecarPluginSettings): boolean {
	// For styling purposes, check if file matches redirect pattern even if feature is disabled
	if (!settings.redirectFileSuffix || settings.redirectFileSuffix.trim() === '') {
		return false;
	}
	
	const expectedSuffix = '.' + settings.redirectFileSuffix.trim() + '.md';
	return filePath.endsWith(expectedSuffix);
}

/**
 * Generates the path for a redirect file given the original path of the source file.
 * The redirect file is placed in the same directory as the original source file, with
 * the original full name followed by the redirect suffix and .md extension.
 * E.g., "folder/source.ext" -> "folder/source.ext.redirect.md"
 * @param originalSourcePath The original path of the source file that was moved/renamed.
 * @param settings The plugin settings.
 * @returns The path for the redirect file.
 */
export function getRedirectFilePathUtil(originalSourcePath: string, settings: SidecarPluginSettings): string {
	return originalSourcePath + '.' + settings.redirectFileSuffix.trim() + '.md';
}

/**
 * Extracts the original source file path from a redirect file's path.
 * E.g., "folder/source.ext.redirect.md" -> "folder/source.ext"
 * @param redirectFilePath The path of the redirect file.
 * @param settings The plugin settings.
 * @returns The original source file path, or null if the path is not a valid redirect file path.
 */
export function getSourcePathFromRedirectFileUtil(redirectFilePath: string, settings: SidecarPluginSettings): string | null {
	if (!settings.enableRedirectFile || !settings.redirectFileSuffix || settings.redirectFileSuffix.trim() === '') {
		return null;
	}
	const fullSuffix = '.' + settings.redirectFileSuffix.trim() + '.md';
	if (redirectFilePath.endsWith(fullSuffix)) {
		return redirectFilePath.substring(0, redirectFilePath.length - fullSuffix.length);
	}
	return null;
}
