import { TFile, Notice, App } from 'obsidian';
import { getBasename } from './utils';
import { debug, warn, error, registerLoggerClass } from './utils/obsidian-logger';
import type SidecarPlugin from './main';

// Track sidecars recently restored to ignore subsequent delete events
const recentlyRestoredSidecars = new Set<string>();

export class SidecarManager {
	private plugin: SidecarPlugin;
	private app: App;
	private recentlyRestoredSidecars = new Set<string>();

	constructor(plugin: SidecarPlugin) {
		this.plugin = plugin;
		this.app = plugin.app;
	}

	/**
	 * Creates a sidecar file for the given main file
	 */
	async createSidecarForFile(file: TFile, force = false): Promise<void> {
		debug(this, `createSidecarForFile called: file="${file.path}", force=${force}`);

		// Prevent sidecar creation for files present at startup if revalidateOnStartup is false
		if (!this.plugin.hasFinishedInitialLoad && !this.plugin.settings.revalidateOnStartup) {
			warn(this, `Skipping sidecar creation - initial load not finished and revalidateOnStartup is false`);
			return;
		}
		if (this.plugin.isInitialRevalidating) {
			warn(this, `Skipping sidecar creation - initial revalidation in progress`);
			return;
		}

		const monitored = this.plugin.isMonitoredFile(file.path);
		debug(this, `File is monitored: ${monitored}`);
		if (monitored) {
			// Only create if autoCreateSidecars is enabled, unless forced
			const shouldCreate = force || (this.plugin.settings.autoCreateSidecars ?? true);
			debug(this, `Should create sidecar: ${shouldCreate} (force: ${force}, autoCreateSidecars: ${this.plugin.settings.autoCreateSidecars ?? true})`);
			if (shouldCreate) {
				const sidecarPath = this.plugin.getSidecarPath(file.path);
				debug(this, `Calculated sidecar path: ${sidecarPath}`);
				if (!this.app.vault.getAbstractFileByPath(sidecarPath)) {
					try {
						debug(this, `Creating sidecar at ${sidecarPath}`);
						await this.app.vault.create(sidecarPath, '');
						debug(this, `Successfully created sidecar`);
						new Notice(`Created sidecar: ${sidecarPath.split('/').pop()}`);
						// Refresh explorer styling after a short delay to allow DOM update
						if (typeof this.plugin.updateSidecarFileAppearance === 'function') {
							setTimeout(() => this.plugin.updateSidecarFileAppearance(), 50);
						}
					} catch (err) {
						error(this, `Error creating sidecar at ${sidecarPath}:`, err);
						if (String(err).includes('File already exists')) {
							warn(this, `Sidecar already exists, ignoring error`);
							return;
						}
						// Only show error notice for user-facing issues
						new Notice(`Error creating sidecar for ${file.name}`);
					}
				} else {
					warn(this, `Sidecar already exists at ${sidecarPath}`);
				}
			}
		}
	}

	/**
	 * Deletes a sidecar file for the given main file
	 */
	async deleteSidecarForFile(file: TFile): Promise<void> {
		debug(this, `deleteSidecarForFile called: file="${file.path}"`);

		// Ignore delete events for sidecars just restored
		if (this.recentlyRestoredSidecars.has(file.path)) {
			debug(this, `Ignoring delete for recently restored sidecar: ${file.path}`);
			this.recentlyRestoredSidecars.delete(file.path);
			return;
		}

		// Ignore manual or auto delete of sidecar files themselves
		if (this.plugin.isSidecarFile(file.path)) {
			debug(this, `File is a sidecar itself, ignoring delete`);
			return;
		}

		// Only handle deletions of monitored main files
		if (!this.plugin.isMonitoredFile(file.path)) {
			debug(this, `File is not monitored, ignoring delete`);
			return;
		}

		const sidecarPath = this.plugin.getSidecarPath(file.path);
		const sidecarFile = this.app.vault.getAbstractFileByPath(sidecarPath);
		debug(this, `Looking for sidecar at ${sidecarPath}: ${!!sidecarFile}`);

		if (sidecarFile instanceof TFile) {
			try {
				debug(this, `Deleting sidecar file: ${sidecarPath}`);
				await this.app.fileManager.trashFile(sidecarFile);
				debug(this, `Successfully deleted sidecar`);
				new Notice(`Deleted sidecar: ${sidecarPath.split('/').pop()}`);
			} catch (err) {
				debug(this, `Error deleting sidecar file ${sidecarPath}:`, err);
				console.error(`Sidecar Plugin: Error deleting sidecar file ${sidecarPath}: `, err);
				new Notice(`Error deleting sidecar for ${file.name}`);
			}
		} else {
			debug(this, `No sidecar file found to delete`);
		}
	}

	/**
	 * Handles the renaming/moving of sidecar files when their main files are renamed/moved
	 */
	async handleSidecarRename(file: TFile, oldPath: string, newPath: string): Promise<void> {
		debug(this, `oldPath="${oldPath}", newPath="${newPath}"`);

		// If the renamed/moved file was a main file that HAD a sidecar at the OLD location
		const oldSidecarPath = this.plugin.getSidecarPath(oldPath);
		const oldSidecarFile = this.app.vault.getAbstractFileByPath(oldSidecarPath);
		debug(this, `Old sidecar path: ${oldSidecarPath}, exists: ${!!oldSidecarFile}`);

		if (oldSidecarFile instanceof TFile) {
			debug(this, `Found old sidecar file, proceeding with rename`);
			// Main file was renamed/moved, so rename/move its sidecar too
			const newSidecarPath = this.plugin.getSidecarPath(newPath);
			debug(this, `New sidecar path: ${newSidecarPath}`);
			try {
				// Check if a file/folder already exists at the target newSidecarPath
				const existingNewSidecar = this.app.vault.getAbstractFileByPath(newSidecarPath);
				debug(this, `Existing file at new sidecar path: ${!!existingNewSidecar}`);
				if (existingNewSidecar && existingNewSidecar.path !== oldSidecarFile.path) { // Don't conflict with itself if no actual move
					debug(this, `Target sidecar path already exists and is different file, cannot rename`);
					new Notice(`Sidecar for ${getBasename(newPath)} already exists. Old sidecar not moved.`, 3000);
				} else if (!existingNewSidecar || existingNewSidecar.path === oldSidecarFile.path) {
					debug(this, `Target path is available or same file, proceeding with rename`);
					debug(this, `Attempting to rename sidecar from ${oldSidecarFile.path} to ${newSidecarPath}`);
					await this.app.fileManager.renameFile(oldSidecarFile, newSidecarPath);
					debug(this, `Successfully renamed sidecar to ${newSidecarPath}`);
				}
			} catch (err) {
				debug(this, `Error moving sidecar from ${oldSidecarPath} to ${newSidecarPath}:`, err);
				new Notice(`Error moving sidecar for ${getBasename(newPath)}`, 3000);
			}
		} else {
			debug(this, `No old sidecar file found, checking if new file should have a sidecar`);
			// Renamed file was not a sidecar, and didn't have one. If it's now monitored, create one.
			if (this.plugin.isMonitoredFile(newPath) && !this.plugin.isSidecarFile(newPath)) {
				debug(this, `New file is monitored and not a sidecar, creating new sidecar`);
				const newSidecarPath = this.plugin.getSidecarPath(newPath);
				const existingSidecar = this.app.vault.getAbstractFileByPath(newSidecarPath);
				debug(this, `Checking for existing sidecar at ${newSidecarPath}: ${!!existingSidecar}`);
				if (!existingSidecar) {
					try {
						debug(this, `Creating new sidecar at ${newSidecarPath}`);
						await this.app.vault.create(newSidecarPath, '');
						debug(this, `Successfully created new sidecar`);
						new Notice(`Created sidecar: ${newSidecarPath.split('/').pop()}`);
					} catch (err) {
						debug(this, `Error creating new sidecar at ${newSidecarPath}:`, err);
						new Notice(`Error creating sidecar for ${getBasename(newPath)}`);
					}
				} else {
					debug(this, `Sidecar already exists, not creating`);
				}
			} else {
				debug(this, `New file is not monitored or is already a sidecar, no action needed`);
			}
		}
	}

	/**
	 * Revalidates all sidecar files in the vault
	 * - Creates missing sidecars for monitored files
	 * - Removes orphaned sidecars
	 */
	async revalidateAllSidecars(): Promise<void> {
		new Notice(`Starting sidecar revalidation...`, 3000);

		let newlyCreatedSidecarCount = 0;
		let countMonitoredFilesWithSidecars = 0;
		let deletedOrphanCount = 0;

		const allFiles = this.app.vault.getFiles();
		const allFilePaths = new Set(allFiles.map(f => f.path));

		// Phase 1: Ensure monitored files have sidecars
		for (const file of allFiles) {
			const isMonitored = this.plugin.isMonitoredFile(file.path);
			const sidecarPath = this.plugin.getSidecarPath(file.path);
			const initialSidecarExists = allFilePaths.has(sidecarPath);

			if (isMonitored) {
				let sidecarEnsuredThisIteration = initialSidecarExists;

				if (!initialSidecarExists && (this.plugin.settings.autoCreateSidecars ?? true)) { // Added check for autoCreateSidecars
					try {
						await this.app.vault.create(sidecarPath, '');
						newlyCreatedSidecarCount++;
						allFilePaths.add(sidecarPath); // Add to set to reflect creation
						sidecarEnsuredThisIteration = true;
					} catch (err) {
						if (String(err).includes('File already exists')) {
							sidecarEnsuredThisIteration = true; // Already exists, so it's ensured
							if (!allFilePaths.has(sidecarPath)) allFilePaths.add(sidecarPath); // Ensure it's in the set
						} else {
							error(this, `Error creating sidecar for ${file.path} at ${sidecarPath} during revalidation: `, err);
						}
					}
				}
				if (sidecarEnsuredThisIteration) {
					countMonitoredFilesWithSidecars++;
				}
			}
		}

		// Phase 2: Clean up orphan or invalid sidecars
		// Re-fetch files in case new sidecars were created and are now in the list
		const currentFilesAfterCreation = this.app.vault.getFiles();
		const orphanSidecarsToModal: string[] = []; // For modal
		const orphanReasons: Record<string, string> = {}; // For modal

		for (const file of currentFilesAfterCreation) {
			if (this.plugin.isSidecarFile(file.path)) {
				const sourcePath = this.plugin.getSourcePathFromSidecar(file.path);
				let shouldDelete = false;
				let reason = "";
				if (!sourcePath) {
					shouldDelete = true;
					reason = "malformed name or unidentifiable main file";
				} else {
					const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
					if (!sourceFile) {
						shouldDelete = true;
						reason = "orphaned (main file missing)";
					} else if (!(sourceFile instanceof TFile)) {
						shouldDelete = true;
						reason = "main file is a folder, not a file";
					} else {
						if (!this.plugin.isMonitoredFile(sourcePath)) {
							shouldDelete = true;
							reason = "main file no longer monitored";
						}
					}
				}

				if (shouldDelete) {
					// This logic is now handled by the revalidateSidecars in main.ts which calls the modal
					// For now, we'll just log and count, assuming the modal logic will be integrated later
					// or that this revalidateAllSidecars will be called by the plugin's revalidateSidecars
					orphanSidecarsToModal.push(file.path);
					orphanReasons[file.path] = reason;
				}
			}
		}
		
		// The modal interaction and actual deletion will be handled by the calling context (SidecarPlugin.revalidateSidecars)
		// This function now primarily focuses on identifying orphans and creating missing ones.
		// The calling function in main.ts will use this information.
		// For now, we'll just pass back the counts and let the main plugin handle the modal.
		// This means the `deletedOrphanCount` will be updated by the main plugin after user confirmation.

		// This function will be called by `SidecarPlugin.revalidateSidecars` which handles the modal.
		// So, we don't show the modal or delete here directly.
		// We return the identified orphans to the caller.

		// The original `revalidateSidecars` in `main.ts` shows a modal.
		// This refactored `revalidateAllSidecars` should probably return the list of orphans
		// and let the `SidecarPlugin` method handle the modal and deletion.
		// For now, let's keep the notice here but acknowledge the modal is external.

		if (orphanSidecarsToModal.length > 0 && typeof this.plugin.showOrphanModal === 'function') {
			await this.plugin.showOrphanModal(orphanSidecarsToModal, orphanReasons, (deletedCount: number) => { // Explicitly type deletedCount
				deletedOrphanCount = deletedCount;
				new Notice(`Sidecar revalidation complete: ${newlyCreatedSidecarCount} created, ${countMonitoredFilesWithSidecars} monitored, ${deletedOrphanCount} orphans deleted.`);
				debug(this, `Revalidation complete. Newly created: ${newlyCreatedSidecarCount}, Monitored with sidecar: ${countMonitoredFilesWithSidecars}, Deleted orphans: ${deletedOrphanCount}`);
			});
		} else {
			new Notice(`Sidecar revalidation complete: ${newlyCreatedSidecarCount} created, ${countMonitoredFilesWithSidecars} monitored, ${deletedOrphanCount} orphans (or 0) deleted.`);
			debug(this, `Revalidation complete. Newly created: ${newlyCreatedSidecarCount}, Monitored with sidecar: ${countMonitoredFilesWithSidecars}, Deleted orphans: ${deletedOrphanCount} (no modal or no orphans)`);
		}
	}

	// Method to add to recently restored set, if needed by other parts of the plugin via SidecarManager
	public addRecentlyRestored(path: string) {
		this.recentlyRestoredSidecars.add(path);
	}

	public clearRecentlyRestored(path: string) {
		this.recentlyRestoredSidecars.delete(path);
	}
}
