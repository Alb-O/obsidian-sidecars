import { TFile, Notice } from 'obsidian';
import { loggerDebug, loggerInfo, loggerWarn, loggerError } from '@/utils';
import type SidecarPlugin from '@/main';

export class SidecarManager {
	private plugin: SidecarPlugin;

	constructor(plugin: SidecarPlugin) {
		this.plugin = plugin;
	}
	/**
	 * Create a sidecar file for a given file if it doesn't exist and auto-creation is enabled
	 */
	async createSidecarForFile(file: TFile, forceCreate: boolean = false): Promise<void> {
		const filePath = file.path;
		
		loggerDebug(this, 'Checking if sidecar creation is needed', { filePath, forceCreate });

		// Skip if this is already a derivative file (sidecar, redirect, preview)
		if (this.plugin.filePathService.isDerivativeFile(filePath)) {
			loggerDebug(this, 'File is a derivative file - skipping sidecar creation', { filePath });
			return;
		}

		// Skip if file is not monitored (unless forced)
		if (!forceCreate && !this.plugin.isMonitoredFile(filePath)) {
			loggerDebug(this, 'File is not monitored - skipping sidecar creation', { filePath });
			return;
		}

		// Skip if auto-creation is disabled (unless forced)
		if (!forceCreate && !this.plugin.settings.autoCreateSidecars) {
			loggerDebug(this, 'Auto-creation disabled - skipping sidecar creation');
			return;
		}

		const sidecarPath = this.plugin.getSidecarPath(filePath);
		
		// Check if sidecar already exists
		const existingSidecar = this.plugin.app.vault.getAbstractFileByPath(sidecarPath);
		if (existingSidecar) {
			loggerDebug(this, 'Sidecar already exists - skipping creation', { sidecarPath });
			return;
		}

		try {
			loggerDebug(this, 'Creating new sidecar file', { filePath, sidecarPath });

			await this.plugin.app.vault.create(sidecarPath, '');
			
			loggerInfo(this, 'Sidecar file created successfully', { 
				mainFile: filePath,
				sidecarFile: sidecarPath 
			});
			
		} catch (error) {
			loggerError(this, 'Failed to create sidecar file', { 
				filePath,
				sidecarPath,
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}

	/**
	 * Delete the sidecar file when the main file is deleted
	 */
	async deleteSidecarForFile(file: TFile): Promise<void> {
		const filePath = file.path;
		
		loggerDebug(this, 'Checking if sidecar deletion is needed', { filePath });

		// Skip if this is a derivative file itself
		if (this.plugin.filePathService.isDerivativeFile(filePath)) {
			loggerDebug(this, 'File is a derivative file - no cleanup needed', { filePath });
			return;
		}

		// Skip if file was not monitored
		if (!this.plugin.isMonitoredFile(filePath)) {
			loggerDebug(this, 'File was not monitored - no sidecar to delete', { filePath });
			return;
		}

		const sidecarPath = this.plugin.getSidecarPath(filePath);
		const sidecarFile = this.plugin.app.vault.getAbstractFileByPath(sidecarPath);
		
		if (!sidecarFile || !(sidecarFile instanceof TFile)) {
			loggerDebug(this, 'No sidecar file found to delete', { sidecarPath });
			return;
		}

		try {
			loggerDebug(this, 'Deleting sidecar file', { filePath, sidecarPath });
			await this.plugin.app.fileManager.trashFile(sidecarFile);
			
			loggerInfo(this, 'Sidecar file deleted successfully', { 
				mainFile: filePath,
				sidecarFile: sidecarPath 
			});
			
		} catch (error) {
			loggerError(this, 'Failed to delete sidecar file', { 
				filePath,
				sidecarPath,
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}

	/**
	 * Handle renaming of sidecar files when main file is renamed
	 */
	async handleSidecarRename(file: TFile, oldPath: string, newPath: string): Promise<void> {
		loggerDebug(this, 'Processing main file rename - checking for sidecar', { oldPath, newPath });

		// Skip sidecar management if file is not monitored, but still handle preview files
		if (!this.plugin.isMonitoredFile(newPath)) {
			loggerDebug(this, 'New path is not monitored - skipping sidecar, handling preview rename only', { newPath });
			await this.handlePreviewRename(oldPath, newPath);
			return;
		}

		const oldSidecarPath = this.plugin.filePathService.getSidecarPath(oldPath);
		const newSidecarPath = this.plugin.getSidecarPath(newPath);
		const sidecarFile = this.plugin.app.vault.getAbstractFileByPath(oldSidecarPath);

		// Handle sidecar rename if it exists
		if (sidecarFile && sidecarFile instanceof TFile) {
			// Check if target path already exists
			const existingFile = this.plugin.app.vault.getAbstractFileByPath(newSidecarPath);
			if (!existingFile) {
				try {
					loggerDebug(this, 'Renaming sidecar file', { from: oldSidecarPath, to: newSidecarPath });
					await this.plugin.app.fileManager.renameFile(sidecarFile, newSidecarPath);
					loggerInfo(this, 'Sidecar file renamed successfully', { oldPath: oldSidecarPath, newPath: newSidecarPath, mainFile: newPath });
				} catch (error) {
					loggerError(this, 'Failed to rename sidecar file', { oldPath: oldSidecarPath, newPath: newSidecarPath, error: error instanceof Error ? error.message : String(error) });
				}
			}
		} else {
			loggerDebug(this, 'No sidecar file found - nothing to rename', { oldSidecarPath });
		}

		// After sidecar rename, also handle preview files
		try {
			loggerDebug(this, 'Processing preview file rename inside handleSidecarRename', { oldPath, newPath });
			await this.handlePreviewRename(oldPath, newPath);
		} catch (err) {
			loggerWarn(this, 'Error during preview file rename in handleSidecarRename', { error: err instanceof Error ? err.message : String(err) });
		}
	}
	/**
	 * Handle renaming of preview files when main file is renamed
	 */
	public async handlePreviewRename(oldMainPath: string, newMainPath: string): Promise<void> {
		loggerDebug(this, 'Checking for preview files to rename', { oldMainPath, newMainPath });

		// Check for common preview extensions
		const commonPreviewExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];
		let previewFilesFound = false;

		for (const ext of commonPreviewExts) {
			const oldPreviewPath = this.plugin.filePathService.getPreviewPath(oldMainPath, ext);
			const previewFile = this.plugin.app.vault.getAbstractFileByPath(oldPreviewPath);

			if (previewFile && previewFile instanceof TFile) {
				previewFilesFound = true;
				const newPreviewPath = this.plugin.filePathService.getPreviewPath(newMainPath, ext);

				// Check if target path already exists
				const existingFile = this.plugin.app.vault.getAbstractFileByPath(newPreviewPath);
				if (existingFile) {
					loggerWarn(this, 'Target preview path already exists - skipping rename', { 
						newPreviewPath,
						extension: ext
					});
					continue;
				}

				try {
					loggerDebug(this, 'Renaming preview file', { 
						from: oldPreviewPath, 
						to: newPreviewPath,
						extension: ext 
					});
					await this.plugin.app.fileManager.renameFile(previewFile, newPreviewPath);

					loggerInfo(this, 'Preview file renamed successfully', { 
						oldPath: oldPreviewPath,
						newPath: newPreviewPath,
						mainFile: newMainPath
					});
				} catch (error) {
					loggerError(this, 'Failed to rename preview file', { 
						oldPath: oldPreviewPath,
						newPath: newPreviewPath,
						extension: ext,
						error: error instanceof Error ? error.message : String(error)
					});
				}
			}
		}

		if (!previewFilesFound) {
			loggerDebug(this, 'No preview files found to rename', { oldMainPath });
		}
	}

	/**
	 * Revalidate all sidecars in the vault
	 */
	async revalidateAllSidecars(): Promise<void> {
		loggerDebug(this, 'Starting comprehensive sidecar revalidation');

		const { validFiles, orphanSidecars, orphanReasons, createdCount } = await this.scanAndValidateFiles();

		if (orphanSidecars.length > 0) {
			loggerInfo(this, 'Found orphaned sidecars - showing deletion modal', { 
				orphanCount: orphanSidecars.length 
			});

			await this.plugin.showOrphanModal(
				orphanSidecars,
				orphanReasons,
				(deletedCount: number) => {
					const totalMessage = `Revalidation complete. Created: ${createdCount}, Deleted: ${deletedCount}`;
					new Notice(totalMessage, 4000);
					loggerInfo(this, 'Revalidation completed', { 
						created: createdCount, 
						deleted: deletedCount 
					});
				}
			);
		} else {
			const message = createdCount > 0 
				? `Revalidation complete. Created ${createdCount} sidecar${createdCount !== 1 ? 's' : ''}.`
				: 'Revalidation complete. No changes needed.';
			
			new Notice(message, 3000);
			loggerInfo(this, 'Revalidation completed', { 
				created: createdCount, 
				deleted: 0,
				orphansFound: false 
			});
		}

		// Update appearance after revalidation
		this.plugin.updateSidecarFileAppearance();
	}

	/**
	 * Scan all files and validate sidecars
	 */
	private async scanAndValidateFiles(): Promise<{
		validFiles: string[];
		orphanSidecars: string[];
		orphanReasons: Record<string, string>;
		createdCount: number;
	}> {
		const validFiles: string[] = [];
		const orphanSidecars: string[] = [];
		const orphanReasons: Record<string, string> = {};
		let createdCount = 0;

		const allFiles = this.plugin.app.vault.getFiles();
		loggerDebug(this, 'Scanning all files for validation', { totalFiles: allFiles.length });

		// Process main files
		for (const file of allFiles) {
			const filePath = file.path;

			// Skip derivative files
			if (this.plugin.filePathService.isDerivativeFile(filePath)) {
				continue;
			}

			// Check if file should be monitored
			if (this.plugin.isMonitoredFile(filePath)) {
				validFiles.push(filePath);

				// Auto-create sidecar if enabled and doesn't exist
				if (this.plugin.settings.autoCreateSidecars) {
					const sidecarPath = this.plugin.getSidecarPath(filePath);
					const existingSidecar = this.plugin.app.vault.getAbstractFileByPath(sidecarPath);
					
					if (!existingSidecar) {
						try {
							const sidecarContent = `# ${file.basename}\n\nSidecar notes for ${file.name}\n`;
							await this.plugin.app.vault.create(sidecarPath, sidecarContent);
							createdCount++;
							
							loggerDebug(this, 'Created missing sidecar during revalidation', { 
								mainFile: filePath,
								sidecarFile: sidecarPath 
							});
						} catch (error) {
							loggerError(this, 'Failed to create sidecar during revalidation', { 
								filePath,
								sidecarPath,
								error: error instanceof Error ? error.message : String(error)
							});
						}
					}
				}
			}
		}

		// Find orphaned sidecars
		for (const file of allFiles) {
			const filePath = file.path;

			if (this.plugin.isSidecarFile(filePath)) {
				const mainPath = this.plugin.getSourcePathFromSidecar(filePath);
				
				if (!mainPath) {
					orphanSidecars.push(filePath);
					orphanReasons[filePath] = 'Invalid sidecar format';
					continue;
				}

				const mainFile = this.plugin.app.vault.getAbstractFileByPath(mainPath);
				if (!mainFile) {
					orphanSidecars.push(filePath);
					orphanReasons[filePath] = `Main file not found: ${mainPath}`;
					continue;
				}

				if (!this.plugin.isMonitoredFile(mainPath)) {
					orphanSidecars.push(filePath);
					orphanReasons[filePath] = `Main file no longer monitored: ${mainPath}`;
					continue;
				}
			}
		}

		loggerInfo(this, 'File scan completed', { 
			validFiles: validFiles.length,
			orphanSidecars: orphanSidecars.length,
			created: createdCount 
		});

		return { validFiles, orphanSidecars, orphanReasons, createdCount };
	}
}
