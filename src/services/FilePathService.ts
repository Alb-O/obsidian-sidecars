import { debug } from '@/utils';
import type { SidecarPluginSettings } from '@/types';
import {
	getExtension,
	getDirname,
	getBasename,
	joinPath,
	toPosixPath,
	isPathInFolderList,
	isFileAllowedByFolderLists
} from '@/utils';

/**
 * Service responsible for all file path operations and validations
 * Encapsulates logic for determining file types, generating paths, and checking permissions
 */
export class FilePathService {
	private settings: SidecarPluginSettings;

	constructor(settings: SidecarPluginSettings) {
		this.settings = settings;
		debug(this, 'FilePathService initialized');
	}

	/**
	 * Update settings reference when settings change
	 */
	updateSettings(settings: SidecarPluginSettings): void {
		debug(this, 'Updating settings reference');
		this.settings = settings;
	}

	/**
	 * Check if a file is monitored based on extension and folder rules
	 */
	isMonitoredFile(filePath: string, isDerivativeFile: (path: string) => boolean): boolean {
		debug(this, 'Checking if file is monitored', { filePath });

		if (isDerivativeFile(filePath)) {
			debug(this, 'File is derivative, not monitored', { filePath });
			return false;
		}

		if (!isFileAllowedByFolderLists(filePath, this.settings)) {
			debug(this, 'File not allowed by folder lists', { filePath });
			return false;
		}

		const extension = getExtension(filePath);
		const isMonitored = extension ? 
			this.settings.monitoredExtensions
				.map(ext => ext.toLowerCase().replace(/^\./, ''))
				.includes(extension) : 
			false;

		debug(this, 'File monitoring result', { filePath, extension, isMonitored });
		return isMonitored;
	}

	/**
	 * Generate sidecar file path for a given source file
	 */
	getSidecarPath(sourcePath: string): string {
		const sidecarPath = `${sourcePath}.${this.settings.sidecarSuffix}.md`;
		debug(this, 'Generated sidecar path', { sourcePath, sidecarPath });
		return sidecarPath;
	}

	/**
	 * Check if a file is a sidecar file
	 */
	isSidecarFile(filePath: string): boolean {
		const isSidecar = filePath.endsWith(`.${this.settings.sidecarSuffix}.md`);
		debug(this, 'Checking if file is sidecar', { filePath, isSidecar });
		return isSidecar;
	}

	/**
	 * Extract source file path from sidecar path
	 */
	getSourcePathFromSidecar(sidecarPath: string): string | null {
		const fullSuffix = `.${this.settings.sidecarSuffix}.md`;
		if (sidecarPath.endsWith(fullSuffix)) {
			const sourcePath = sidecarPath.substring(0, sidecarPath.length - fullSuffix.length);
			debug(this, 'Extracted source path from sidecar', { sidecarPath, sourcePath });
			return sourcePath;
		}
		debug(this, 'Could not extract source path from sidecar', { sidecarPath });
		return null;
	}

	/**
	 * Generate redirect file path for a given source file
	 */
	getRedirectPath(sourcePath: string): string {
		const redirectPath = `${sourcePath}.${this.settings.redirectFileSuffix}.md`;
		debug(this, 'Generated redirect path', { sourcePath, redirectPath });
		return redirectPath;
	}

	/**
	 * Check if a file is a redirect file
	 */
	isRedirectFile(filePath: string): boolean {
		const isRedirect = filePath.endsWith(`.${this.settings.redirectFileSuffix}.md`);
		debug(this, 'Checking if file is redirect', { filePath, isRedirect });
		return isRedirect;
	}

	/**
	 * Extract source file path from redirect path
	 */
	getSourcePathFromRedirect(redirectPath: string): string | null {
		const fullSuffix = `.${this.settings.redirectFileSuffix}.md`;
		if (redirectPath.endsWith(fullSuffix)) {
			const sourcePath = redirectPath.substring(0, redirectPath.length - fullSuffix.length);
			debug(this, 'Extracted source path from redirect', { redirectPath, sourcePath });
			return sourcePath;
		}
		debug(this, 'Could not extract source path from redirect', { redirectPath });
		return null;
	}

	/**
	 * Check if a file is any kind of derivative file (sidecar or redirect)
	 */
	isDerivativeFile(filePath: string): boolean {
		const isDerivative = this.isSidecarFile(filePath) || this.isRedirectFile(filePath);
		debug(this, 'Checking if file is derivative', { filePath, isDerivative });
		return isDerivative;
	}

	/**
	 * Get file extension without dot
	 */
	getFileExtension(filePath: string): string {
		return getExtension(filePath);
	}

	/**
	 * Get directory path from file path
	 */
	getDirectory(filePath: string): string {
		return getDirname(filePath);
	}

	/**
	 * Get filename with extension from path
	 */
	getFilename(filePath: string): string {
		return getBasename(filePath);
	}

	/**
	 * Join path segments safely
	 */
	joinPaths(dir: string, file: string): string {
		return joinPath(dir, file);
	}

	/**
	 * Convert path to POSIX format
	 */
	toPosixPath(path: string): string {
		return toPosixPath(path);
	}
}
