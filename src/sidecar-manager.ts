import { TFile, Notice } from 'obsidian';
import { getBasename } from './utils';
import { debug, warn } from './utils/obsidian-logger';
import type SidecarPlugin from './main';

// Track sidecars recently restored to ignore subsequent delete events
export const recentlyRestoredSidecars = new Set<string>();

/**
 * Creates a sidecar file for the given main file
 */
export async function createSidecarForFile(plugin: SidecarPlugin, file: TFile, force = false): Promise<void> {
	debug(this, `createSidecarForFile called: file="${file.path}", force=${force}`);
	
	// Prevent sidecar creation for files present at startup if revalidateOnStartup is false
	if (!plugin.hasFinishedInitialLoad && !plugin.settings.revalidateOnStartup) {
		warn(this, `Skipping sidecar creation - initial load not finished and revalidateOnStartup is false`);
		return;
	}
	if (plugin.isInitialRevalidating) {
		warn(this, `Skipping sidecar creation - initial revalidation in progress`);
		return;
	}

	const monitored = plugin.isMonitoredFile(file.path);
	debug(this, `File is monitored: ${monitored}`);
	if (monitored) {
		// Only create if autoCreateSidecars is enabled, unless forced
		const shouldCreate = force || (plugin.settings.autoCreateSidecars ?? true);
		debug(this, `Should create sidecar: ${shouldCreate} (force: ${force}, autoCreateSidecars: ${plugin.settings.autoCreateSidecars ?? true})`);
		if (shouldCreate) {
			const sidecarPath = plugin.getSidecarPath(file.path);
			debug(this, `Calculated sidecar path: ${sidecarPath}`);
			if (!plugin.app.vault.getAbstractFileByPath(sidecarPath)) {
				try {
					debug(this, `Creating sidecar at ${sidecarPath}`);
					await plugin.app.vault.create(sidecarPath, '');
					debug(this, `Successfully created sidecar`);
					new Notice(`Created sidecar: ${sidecarPath.split('/').pop()}`);
					// Refresh explorer styling after a short delay to allow DOM update
					if (typeof plugin.updateSidecarFileAppearance === 'function') {
						setTimeout(() => plugin.updateSidecarFileAppearance(), 50);
					}
				} catch (error) {
					error(this, `Error creating sidecar at ${sidecarPath}:`, error);
					if (String(error).includes('File already exists')) {
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
export async function deleteSidecarForFile(plugin: SidecarPlugin, file: TFile): Promise<void> {
	debug(this, `deleteSidecarForFile called: file="${file.path}"`);
	
	// Ignore delete events for sidecars just restored
	if (recentlyRestoredSidecars.has(file.path)) {
		debug(this, `Ignoring delete for recently restored sidecar: ${file.path}`);
		recentlyRestoredSidecars.delete(file.path);
		return;
	}

	// Ignore manual or auto delete of sidecar files themselves
	if (plugin.isSidecarFile(file.path)) {
		debug(this, `File is a sidecar itself, ignoring delete`);
		return;
	}

	// Only handle deletions of monitored main files
	if (!plugin.isMonitoredFile(file.path)) {
		debug(this, `File is not monitored, ignoring delete`);
		return;
	}

	const sidecarPath = plugin.getSidecarPath(file.path);
	const sidecarFile = plugin.app.vault.getAbstractFileByPath(sidecarPath);
	debug(this, `Looking for sidecar at ${sidecarPath}: ${!!sidecarFile}`);

	if (sidecarFile instanceof TFile) {
		try {
			debug(this, `Deleting sidecar file: ${sidecarPath}`);
			await plugin.app.fileManager.trashFile(sidecarFile);
			debug(this, `Successfully deleted sidecar`);
			new Notice(`Deleted sidecar: ${sidecarPath.split('/').pop()}`);
		} catch (error) {
			debug(this, `Error deleting sidecar file ${sidecarPath}:`, error);
			console.error(`Sidecar Plugin: Error deleting sidecar file ${sidecarPath}: `, error);
			new Notice(`Error deleting sidecar for ${file.name}`);
		}
	} else {
		debug(this, `No sidecar file found to delete`);
	}
}

/**
 * Handles the renaming/moving of sidecar files when their main files are renamed/moved
 */
export async function handleSidecarRename(plugin: SidecarPlugin, file: TFile, oldPath: string, newPath: string): Promise<void> {
	debug(this, `handleSidecarRename called: oldPath="${oldPath}", newPath="${newPath}"`);
	
	// If the renamed/moved file was a main file that HAD a sidecar at the OLD location
	const oldSidecarPath = plugin.getSidecarPath(oldPath);
	const oldSidecarFile = plugin.app.vault.getAbstractFileByPath(oldSidecarPath);
	debug(this, `Old sidecar path: ${oldSidecarPath}, exists: ${!!oldSidecarFile}`);

	if (oldSidecarFile instanceof TFile) {
		debug(this, `Found old sidecar file, proceeding with rename`);
		// Main file was renamed/moved, so rename/move its sidecar too
		const newSidecarPath = plugin.getSidecarPath(newPath);
		debug(this, `New sidecar path: ${newSidecarPath}`);
		try {
			// Check if a file/folder already exists at the target newSidecarPath
			const existingNewSidecar = plugin.app.vault.getAbstractFileByPath(newSidecarPath);
			debug(this, `Existing file at new sidecar path: ${!!existingNewSidecar}`);			if (existingNewSidecar && existingNewSidecar.path !== oldSidecarFile.path) { // Don't conflict with itself if no actual move
				debug(this, `Target sidecar path already exists and is different file, cannot rename`);
				// Only warn in dev, skip in production
				new Notice(`Sidecar for ${getBasename(newPath)} already exists. Old sidecar not moved.`, 3000);
				// Optionally, delete the oldSidecarFile here if it's considered redundant and we don't want duplicates.
				// await plugin.app.fileManager.trashFile(oldSidecarFile);
			} else if (!existingNewSidecar || existingNewSidecar.path === oldSidecarFile.path) {
				debug(this, `Target path is available or same file, proceeding with rename`);
				// If it doesn't exist, or it exists but it *is* the old sidecar (i.e. just a name change in same folder)
				debug(this, `Attempting to rename sidecar from ${oldSidecarFile.path} to ${newSidecarPath}`);
				await plugin.app.fileManager.renameFile(oldSidecarFile, newSidecarPath);
				debug(this, `Successfully renamed sidecar to ${newSidecarPath}`);
				// Sidecar moved
				// No user notice here as it's an automatic accompanying action.
			}
		} catch (error) {
			debug(this, `Error moving sidecar from ${oldSidecarPath} to ${newSidecarPath}:`, error);
			// Only show error notice for user-facing issues
			new Notice(`Error moving sidecar for ${getBasename(newPath)}`, 3000);
		}
	} else {
		debug(this, `No old sidecar file found, checking if new file should have a sidecar`);
		// Renamed file was not a sidecar, and didn't have one. If it's now monitored, create one.
		if (plugin.isMonitoredFile(newPath) && !plugin.isSidecarFile(newPath)) {
			debug(this, `New file is monitored and not a sidecar, creating new sidecar`);
			const newSidecarPath = plugin.getSidecarPath(newPath);			const existingSidecar = plugin.app.vault.getAbstractFileByPath(newSidecarPath);
			debug(this, `Checking for existing sidecar at ${newSidecarPath}: ${!!existingSidecar}`);
			if (!existingSidecar) {
				try {
					debug(this, `Creating new sidecar at ${newSidecarPath}`);
					await plugin.app.vault.create(newSidecarPath, '');
					debug(this, `Successfully created new sidecar`);
					new Notice(`Created sidecar: ${newSidecarPath.split('/').pop()}`);
				} catch (error) {
					debug(this, `Error creating new sidecar at ${newSidecarPath}:`, error);
					// Only show error notice for user-facing issues
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
export async function revalidateAllSidecars(plugin: SidecarPlugin): Promise<void> {
	new Notice(`Starting sidecar revalidation...`, 3000);

	let newlyCreatedSidecarCount = 0;
	let countMonitoredFilesWithSidecars = 0;
	let deletedOrphanCount = 0;

	const allFiles = plugin.app.vault.getFiles();
	const allFilePaths = new Set(allFiles.map(f => f.path));

	// Phase 1: Ensure monitored files have sidecars
	for (const file of allFiles) {
		const isMonitored = plugin.isMonitoredFile(file.path);
		const sidecarPath = plugin.getSidecarPath(file.path);
		const initialSidecarExists = allFilePaths.has(sidecarPath);

		if (isMonitored) {
			let sidecarEnsuredThisIteration = initialSidecarExists;

			if (!initialSidecarExists) {
				try {
					await plugin.app.vault.create(sidecarPath, '');
					newlyCreatedSidecarCount++;
					sidecarEnsuredThisIteration = true;
					// Sidecar created
				} catch (error) {
					if (String(error).includes('File already exists')) {
						sidecarEnsuredThisIteration = true;
					} else {
						// Only show error notice for user-facing issues
					}
				}
			}

			if (sidecarEnsuredThisIteration) {
				countMonitoredFilesWithSidecars++;
			}
		}
	}

	// Phase 2: Clean up orphan or invalid sidecars
	const currentFilesAfterCreation = plugin.app.vault.getFiles();

	for (const file of currentFilesAfterCreation) {
		if (plugin.isSidecarFile(file.path)) {
			const sourcePath = plugin.getSourcePathFromSidecar(file.path);
			let shouldDelete = false;
			let reason = ""; if (!sourcePath) {
				shouldDelete = true;
				reason = "Cannot determine main path";
			} else if (!plugin.app.vault.getAbstractFileByPath(sourcePath)) {
				shouldDelete = true;
				reason = "Main file no longer exists";
			} else if (!plugin.isMonitoredFile(sourcePath)) {
				shouldDelete = true;
				reason = "Main file is no longer monitored";
			}

			if (shouldDelete) {
				try {
					await plugin.app.fileManager.trashFile(file);
					deletedOrphanCount++;
					// Orphaned sidecar deleted
				} catch (error) {
					// Only show error notice for user-facing issues
				}
			}
		}
	}

	// Revalidation complete
	new Notice(`Sidecar revalidation complete: ${newlyCreatedSidecarCount} created, ${countMonitoredFilesWithSidecars} monitored, ${deletedOrphanCount} orphans deleted.`);
}
