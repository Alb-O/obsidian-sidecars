import type { SidecarPluginSettings } from "@/types";
import {
	getBasename,
	getDirname,
	getExtension,
	isFileAllowedByFolderLists,
	joinPath,
	loggerDebug,
	toPosixPath,
} from "@/utils";

/**
 * Service responsible for all file path operations and validations
 * Encapsulates logic for determining file types, generating paths, and checking permissions
 */
export class FilePathService {
	private settings: SidecarPluginSettings;

	constructor(settings: SidecarPluginSettings) {
		this.settings = settings;
		loggerDebug(this, "FilePathService initialized");
	}

	/**
	 * Update settings reference when settings change
	 */
	updateSettings(settings: SidecarPluginSettings): void {
		loggerDebug(this, "Updating settings reference");
		this.settings = settings;
	}

	/**
	 * Check if a file is monitored based on extension and folder rules
	 */
	isMonitoredFile(
		filePath: string,
		isDerivativeFile: (path: string) => boolean,
	): boolean {
		loggerDebug(this, "Checking if file is monitored", { filePath });

		if (isDerivativeFile(filePath)) {
			loggerDebug(this, "File is derivative, not monitored", { filePath });
			return false;
		}

		if (!isFileAllowedByFolderLists(filePath, this.settings)) {
			loggerDebug(this, "File not allowed by folder lists", { filePath });
			return false;
		}

		const extension = getExtension(filePath);
		const isMonitored = extension
			? this.settings.monitoredExtensions
					.map((ext) => ext.toLowerCase().replace(/^\./, ""))
					.includes(extension)
			: false;

		loggerDebug(this, "File monitoring result", {
			filePath,
			extension,
			isMonitored,
		});
		return isMonitored;
	}
	/**
	 * Generate sidecar file path for a given source file
	 */
	getSidecarPath(sourcePath: string): string {
		const sidecarPath = `${sourcePath}.${this.settings.sidecarSuffix}.md`;
		// loggerDebug(this, 'Generated sidecar path', { sourcePath, sidecarPath }); // Reduced logging
		return sidecarPath;
	}
	/**
	 * Check if a file is a sidecar file
	 */
	isSidecarFile(filePath: string): boolean {
		const isSidecar = filePath.endsWith(`.${this.settings.sidecarSuffix}.md`);
		// loggerDebug(this, 'Checking if file is sidecar', { filePath, isSidecar }); // Reduced logging
		return isSidecar;
	}
	/**
	 * Extract source file path from sidecar path
	 */
	getSourcePathFromSidecar(sidecarPath: string): string | null {
		const fullSuffix = `.${this.settings.sidecarSuffix}.md`;
		if (sidecarPath.endsWith(fullSuffix)) {
			const sourcePath = sidecarPath.substring(
				0,
				sidecarPath.length - fullSuffix.length,
			);
			// loggerDebug(this, 'Extracted source path from sidecar', { sidecarPath, sourcePath }); // Reduced logging
			return sourcePath;
		}
		// loggerDebug(this, 'Could not extract source path from sidecar', { sidecarPath }); // Reduced logging
		return null;
	}
	/**
	 * Generate redirect file path for a given source file
	 */
	getRedirectPath(sourcePath: string): string {
		const redirectPath = `${sourcePath}.${this.settings.redirectFileSuffix}.md`;
		// loggerDebug(this, 'Generated redirect path', { sourcePath, redirectPath }); // Reduced logging
		return redirectPath;
	}
	/**
	 * Check if a file is a redirect file
	 */
	isRedirectFile(filePath: string): boolean {
		const isRedirect = filePath.endsWith(
			`.${this.settings.redirectFileSuffix}.md`,
		);
		// loggerDebug(this, 'Checking if file is redirect', { filePath, isRedirect }); // Reduced logging
		return isRedirect;
	}

	/**
	 * Check if a file is a preview file
	 */
	isPreviewFile(filePath: string): boolean {
		const isPreview = filePath.includes(`.${this.settings.previewFileSuffix}.`);
		// loggerDebug(this, 'Checking if file is preview', { filePath, isPreview }); // Reduced log noise
		return isPreview;
	}

	/**
	 * Extract source file path from redirect path
	 */
	getSourcePathFromRedirect(redirectPath: string): string | null {
		const fullSuffix = `.${this.settings.redirectFileSuffix}.md`;
		if (redirectPath.endsWith(fullSuffix)) {
			const sourcePath = redirectPath.substring(
				0,
				redirectPath.length - fullSuffix.length,
			);
			// loggerDebug(this, 'Extracted source path from redirect', { redirectPath, sourcePath }); // Reduced logging
			return sourcePath;
		}
		// loggerDebug(this, 'Could not extract source path from redirect', { redirectPath }); // Reduced logging
		return null;
	}

	/**
	 * Extract source file path from preview path
	 */
	getSourcePathFromPreview(previewPath: string): string | null {
		const previewPattern = new RegExp(
			`\\.${this.settings.previewFileSuffix}\\.[^.]+$`,
		);
		const match = previewPath.match(previewPattern);
		if (match) {
			const sourcePath = previewPath.substring(
				0,
				previewPath.length - match[0].length,
			);
			// loggerDebug(this, 'Extracted source path from preview', { previewPath, sourcePath }); // Reduced logging
			return sourcePath;
		}
		// loggerDebug(this, 'Could not extract source path from preview', { previewPath }); // Reduced logging
		return null;
	}

	/**
	 * Get preview file info from a preview file path
	 */
	getPreviewFileInfo(
		filePath: string,
	): { mainPath: string; extension: string } | null {
		if (!this.isPreviewFile(filePath)) {
			return null;
		}
		const mainPath = this.getSourcePathFromPreview(filePath);
		if (!mainPath) {
			return null;
		}
		const extension = this.getFileExtension(filePath);
		return { mainPath, extension };
	}

	/**
	 * Get main file path from redirect file path
	 */
	getMainPathFromRedirect(redirectPath: string): string | null {
		return this.getSourcePathFromRedirect(redirectPath);
	}
	/**
	 * Generate preview file path for a source file
	 */
	getPreviewPath(filePath: string, extension = "png"): string {
		// Keep the full source filename (including extension) when generating preview path
		const previewPath = `${filePath}.${this.settings.previewFileSuffix}.${extension}`;
		// loggerDebug(this, 'Generated preview path', { filePath, extension, previewPath }); // Removed verbose logging
		return previewPath;
	}

	/**
	 * Check if a file is any kind of derivative file (sidecar, redirect, or preview)
	 */
	isDerivativeFile(filePath: string): boolean {
		const isDerivative =
			this.isSidecarFile(filePath) ||
			this.isRedirectFile(filePath) ||
			this.isPreviewFile(filePath);
		loggerDebug(this, "Checking if file is derivative", {
			filePath,
			isDerivative,
		});
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
