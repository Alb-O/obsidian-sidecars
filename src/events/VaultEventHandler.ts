import type { TAbstractFile, App } from "obsidian";
import { TFile } from "obsidian";
import { loggerDebug, loggerInfo, loggerWarn, loggerError } from "@/utils";
import type SidecarPlugin from "@/main";
import type { SidecarManager } from "@/SidecarManager";

export class VaultEventHandler {
	private plugin: SidecarPlugin;
	private app: App;
	private sidecarManager: SidecarManager;
	private recentRenames = new Map<string, number>();
	private readonly RENAME_DEBOUNCE_MS = 100;
	private uiUpdateTimer: number | null = null;
	private readonly UI_UPDATE_DEBOUNCE_MS = 50;
	private isProcessingBulkOperation = false;
	private bulkOperationTimer: number | null = null;
	private readonly BULK_OPERATION_DEBOUNCE_MS = 200;

	constructor(plugin: SidecarPlugin, sidecarManager: SidecarManager) {
		this.plugin = plugin;
		this.app = plugin.app;
		this.sidecarManager = sidecarManager;
	}

	/**
	 * Mark the start of a bulk operation to reduce event processing
	 */
	private markBulkOperationStart(): void {
		this.isProcessingBulkOperation = true;

		// Reset the bulk operation timer
		if (this.bulkOperationTimer) {
			window.clearTimeout(this.bulkOperationTimer);
		}

		this.bulkOperationTimer = window.setTimeout(() => {
			this.isProcessingBulkOperation = false;
			this.bulkOperationTimer = null;
			loggerDebug(
				this,
				"Bulk operation completed - resuming normal event processing",
			);
		}, this.BULK_OPERATION_DEBOUNCE_MS);
	}

	/**
	 * Debounced UI update to prevent excessive redraws
	 */
	private scheduleUIUpdate(): void {
		if (this.uiUpdateTimer) {
			window.clearTimeout(this.uiUpdateTimer);
		}

		this.uiUpdateTimer = window.setTimeout(() => {
			this.plugin.updateSidecarFileAppearance();
			this.uiUpdateTimer = null;
		}, this.UI_UPDATE_DEBOUNCE_MS);
	}

	async renameSidecarMainFile(
		oldSidecarPath: string,
		newSidecarPath: string,
	): Promise<void> {
		const pathExtractors =
			this.plugin.fileOperationService.createPathExtractors();
		await this.plugin.fileOperationService.renameMainFileForDerivative(
			oldSidecarPath,
			newSidecarPath,
			{
				fileType: "sidecar",
				pathExtractor: pathExtractors.sidecar,
				showUserNotices: true,
				logContext: "sidecar-main-rename",
			},
		);
	}

	async renameRedirectMainFile(
		oldRedirectPath: string,
		newRedirectPath: string,
	): Promise<void> {
		const pathExtractors =
			this.plugin.fileOperationService.createPathExtractors();
		await this.plugin.fileOperationService.renameMainFileForDerivative(
			oldRedirectPath,
			newRedirectPath,
			{
				fileType: "redirect",
				pathExtractor: pathExtractors.redirect,
				showUserNotices: false,
				logContext: "redirect-main-rename",
			},
		);
	}
	async handleExtensionReapplication(
		file: TFile,
		oldPath: string,
	): Promise<boolean> {
		const newPath = file.path;

		loggerDebug(
			this,
			"Checking if file rename requires extension reapplication",
			{
				oldPath,
				newPath,
				duringBulkOp: this.isProcessingBulkOperation,
			},
		);

		if (this.plugin.isSidecarFile(oldPath)) {
			loggerDebug(
				this,
				"Old path was a sidecar file - analyzing rename pattern",
			);
			const mainPath = this.plugin.getSourcePathFromSidecar(oldPath);
			if (mainPath) {
				loggerDebug(this, "Main file path identified for old sidecar", {
					mainPath,
				});
				const expectedNewSidecarPath = this.plugin.getSidecarPath(mainPath);
				loggerDebug(this, "Expected new sidecar path calculated", {
					expectedNewSidecarPath,
				});

				if (
					newPath !== expectedNewSidecarPath &&
					!this.plugin.isSidecarFile(newPath)
				) {
					loggerDebug(
						this,
						"Extension reapplication needed - reconstructing proper sidecar path",
					);

					const newFileName = newPath.substring(newPath.lastIndexOf("/") + 1);
					const newFileNameWithoutMd = newFileName.endsWith(".md")
						? newFileName.slice(0, -3)
						: newFileName;
					const mainFileName = mainPath.substring(
						mainPath.lastIndexOf("/") + 1,
					);
					const mainBaseName =
						mainFileName.lastIndexOf(".") !== -1
							? mainFileName.slice(0, mainFileName.lastIndexOf("."))
							: mainFileName;
					const mainExtensions = mainFileName.substring(mainBaseName.length);
					const newBaseName =
						newFileNameWithoutMd.lastIndexOf(".") !== -1
							? newFileNameWithoutMd.slice(
									0,
									newFileNameWithoutMd.lastIndexOf("."),
								)
							: newFileNameWithoutMd;
					const directory = newPath.substring(0, newPath.lastIndexOf("/") + 1);
					const newSidecarPath =
						directory +
						newBaseName +
						mainExtensions +
						"." +
						this.plugin.settings.sidecarSuffix +
						".md";

					loggerDebug(this, "Calculated proper sidecar path for restoration", {
						originalName: newFileName,
						baseName: newBaseName,
						mainExtensions,
						restoredPath: newSidecarPath,
					});

					try {
						loggerDebug(this, "Restoring proper sidecar file extension");
						await this.app.fileManager.renameFile(file, newSidecarPath);

						loggerInfo(this, "Sidecar extension successfully restored", {
							from: newPath,
							to: newSidecarPath,
						});

						loggerDebug(this, "Processing corresponding main file rename");
						await this.renameSidecarMainFile(oldPath, newSidecarPath);
						return true;
					} catch (restoreError) {
						loggerError(this, "Failed to restore sidecar extension", {
							newPath,
							attemptedPath: newSidecarPath,
							error:
								restoreError instanceof Error
									? restoreError.message
									: String(restoreError),
						});
					}
				} else {
					loggerDebug(
						this,
						"No extension reapplication needed - rename is valid",
						{
							pathsMatch: newPath === expectedNewSidecarPath,
							isStillSidecar: this.plugin.isSidecarFile(newPath),
						},
					);
				}
			} else {
				loggerWarn(this, "Could not determine main file path for old sidecar", {
					oldSidecarPath: oldPath,
				});
			}
		} else {
			loggerDebug(
				this,
				"Old path was not a sidecar file - no extension reapplication needed",
			);
		}
		return false;
	}

	async handleFileCreate(file: TAbstractFile): Promise<void> {
		if (file instanceof TFile) {
			loggerDebug(this, "Processing file creation event", {
				path: file.path,
				extension: file.extension,
			});

			await this.sidecarManager.createSidecarForFile(file);
			if (this.plugin.isRedirectFile(file.path)) {
				loggerDebug(this, "Redirect file created - scheduling UI update");
				this.scheduleUIUpdate();
			}
		}
	}
	async handleFileDelete(file: TAbstractFile): Promise<void> {
		if (file instanceof TFile) {
			loggerDebug(this, "Processing file deletion event", { path: file.path });

			await this.sidecarManager.deleteSidecarForFile(file);

			if (this.plugin.isRedirectFile(file.path)) {
				loggerDebug(this, "Redirect file deleted - scheduling UI update");
				this.scheduleUIUpdate();
			}
		}
	}

	async handleFileRename(file: TAbstractFile, oldPath: string): Promise<void> {
		if (file instanceof TFile) {
			const newPath = file.path;

			// Skip processing if we're in the middle of a bulk operation (unless it's the main file)
			if (
				this.isProcessingBulkOperation &&
				this.plugin.filePathService.isDerivativeFile(newPath)
			) {
				loggerDebug(
					this,
					"Skipping derivative file processing during bulk operation",
					{
						oldPath,
						newPath,
						isDerivative: true,
					},
				);
				this.scheduleUIUpdate(); // Still schedule UI update for consistency
				return;
			} // Deduplicate only very rapid rename events (system duplicates, not user actions)
			// Use a much shorter window to only catch true system duplicates
			const renameKey = `${oldPath}→${newPath}`;
			const now = Date.now();
			const lastRename = this.recentRenames.get(renameKey);

			// Only block if it's the exact same operation within a very short window (25ms)
			// This catches system duplicates but allows legitimate user back-and-forth moves
			if (lastRename && now - lastRename < 25) {
				loggerDebug(this, "Skipping rapid duplicate rename event", {
					oldPath,
					newPath,
					timeSinceLastRename: now - lastRename,
				});
				return;
			}

			this.recentRenames.set(renameKey, now);
			// Clean up old entries to prevent memory leaks
			if (this.recentRenames.size > 100) {
				const cutoff = now - 25 * 10; // Clean up entries older than 250ms
				for (const [key, timestamp] of this.recentRenames.entries()) {
					if (timestamp < cutoff) {
						this.recentRenames.delete(key);
					}
				}
			}

			loggerDebug(this, "Processing file rename event", { oldPath, newPath });

			const extensionWasReapplied = await this.handleExtensionReapplication(
				file,
				oldPath,
			);
			loggerDebug(this, "Extension reapplication check completed", {
				reapplied: extensionWasReapplied,
			});
			if (extensionWasReapplied) {
				loggerDebug(
					this,
					"Extension was reapplied - updating UI and completing rename handling",
				);
				// After extension reapplication, also rename preview files using FileOperationService
				loggerDebug(
					this,
					"Processing preview file rename after extension reapplication",
					{ oldPath, newPath },
				);

				const pathExtractors =
					this.plugin.fileOperationService.createPathExtractors();
				const commonPreviewExts = ["png", "jpg", "jpeg", "gif", "webp", "svg"];

				try {
					await this.plugin.fileOperationService.renameDerivativeForMainFile(
						oldPath,
						newPath,
						{
							fileType: "preview",
							pathExtractor: pathExtractors.preview,
							showUserNotices: false,
							logContext: "extension-reapplication-preview-rename",
						},
						commonPreviewExts,
					);
				} catch (error) {
					loggerWarn(
						this,
						"Error renaming preview files after extension reapplication",
						{
							oldPath,
							newPath,
							error: error instanceof Error ? error.message : String(error),
						},
					);
				}

				this.scheduleUIUpdate();
				return;
			}
			if (this.plugin.isSidecarFile(newPath)) {
				loggerDebug(
					this,
					"Renamed file is a sidecar - processing sidecar rename logic",
				);
				await this.renameSidecarMainFile(oldPath, newPath);

				const mainPath = this.plugin.getSourcePathFromSidecar(newPath);
				if (mainPath && !this.app.vault.getAbstractFileByPath(mainPath)) {
					loggerWarn(
						this,
						"Sidecar is orphaned after rename - main file not found",
						{
							sidecarPath: newPath,
							expectedMainPath: mainPath,
						},
					);
				}

				loggerDebug(this, "Scheduling UI update after sidecar rename");
				this.scheduleUIUpdate();
				return;
			}
			if (this.plugin.isRedirectFile(newPath)) {
				loggerDebug(
					this,
					"Renamed file is a redirect file - processing redirect rename logic",
				);
				// Similar to sidecar handling, handle redirect file renaming
				await this.renameRedirectMainFile(oldPath, newPath);

				loggerDebug(this, "Scheduling UI update after redirect rename");
				this.scheduleUIUpdate();
				return;
			}
			if (this.plugin.isPreviewFile(newPath)) {
				loggerDebug(
					this,
					"Renamed file is a preview file - processing preview rename logic",
				);
				await this.renamePreviewMainFile(oldPath, newPath);

				loggerDebug(this, "Scheduling UI update after preview rename");
				this.scheduleUIUpdate();
				return;
			}

			loggerDebug(
				this,
				"Renamed file is a main file - processing main file rename logic",
			);

			// Only mark bulk operation if this could trigger derivative file renames
			// (i.e., if the directory or base name is changing)
			const oldDir = oldPath.substring(0, oldPath.lastIndexOf("/") + 1);
			const newDir = newPath.substring(0, newPath.lastIndexOf("/") + 1);
			const shouldUseBulkMode = oldDir !== newDir || oldPath !== newPath;

			if (shouldUseBulkMode) {
				this.markBulkOperationStart();
			}

			// Use FileOperationService to rename associated files
			const pathExtractors =
				this.plugin.fileOperationService.createPathExtractors();
			const commonPreviewExts = ["png", "jpg", "jpeg", "gif", "webp", "svg"];

			// Rename associated sidecar file
			try {
				await this.plugin.fileOperationService.renameDerivativeForMainFile(
					oldPath,
					newPath,
					{
						fileType: "sidecar",
						pathExtractor: pathExtractors.sidecar,
						showUserNotices: false,
						logContext: "main-sidecar-rename",
					},
				);
			} catch (error) {
				loggerWarn(this, "Error renaming sidecar for main file", {
					oldPath,
					newPath,
					error: error instanceof Error ? error.message : String(error),
				});
			}

			// Rename associated redirect files
			try {
				await this.plugin.fileOperationService.renameDerivativeForMainFile(
					oldPath,
					newPath,
					{
						fileType: "redirect",
						pathExtractor: pathExtractors.redirect,
						showUserNotices: false,
						logContext: "main-redirect-rename",
					},
				);
			} catch (error) {
				loggerWarn(this, "Error renaming redirect for main file", {
					oldPath,
					newPath,
					error: error instanceof Error ? error.message : String(error),
				});
			}

			// Rename associated preview files
			try {
				await this.plugin.fileOperationService.renameDerivativeForMainFile(
					oldPath,
					newPath,
					{
						fileType: "preview",
						pathExtractor: pathExtractors.preview,
						showUserNotices: false,
						logContext: "main-preview-rename",
					},
					commonPreviewExts,
				);
			} catch (error) {
				loggerWarn(this, "Error renaming preview files for main file", {
					oldPath,
					newPath,
					error: error instanceof Error ? error.message : String(error),
				});
			}
			loggerDebug(this, "Scheduling UI update after main file rename");
			this.scheduleUIUpdate();
		}
	}

	/**
	 * Handle renaming the main file when a preview file is renamed
	 */
	private async renamePreviewMainFile(
		oldPreviewPath: string,
		newPreviewPath: string,
	): Promise<void> {
		const pathExtractors =
			this.plugin.fileOperationService.createPathExtractors();
		await this.plugin.fileOperationService.renameMainFileForDerivative(
			oldPreviewPath,
			newPreviewPath,
			{
				fileType: "preview",
				pathExtractor: pathExtractors.preview,
				showUserNotices: false,
				logContext: "preview-main-rename",
			},
		);
	}
}
