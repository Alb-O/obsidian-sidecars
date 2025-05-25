import { TFile, TAbstractFile, Notice } from 'obsidian';
import { getBasename } from './utils';
import type SidecarPlugin from './main';

// Track sidecars recently restored to ignore subsequent delete events
export const recentlyRestoredSidecars = new Set<string>();

/**
 * Creates a sidecar file for the given source file
 */
export async function createSidecarForFile(plugin: SidecarPlugin, file: TFile): Promise<void> {
	// Prevent sidecar creation for files present at startup if revalidateOnStartup is false
	if (!plugin.hasFinishedInitialLoad && !plugin.settings.revalidateOnStartup) {
		return;
	}
	if (plugin.isInitialRevalidating) {
		return;
	}

	if (plugin.isMonitoredFile(file.path)) {
		const sidecarPath = plugin.getSidecarPath(file.path);
		if (!plugin.app.vault.getAbstractFileByPath(sidecarPath)) {
			try {
				await plugin.app.vault.create(sidecarPath, '');
				new Notice(`Created sidecar: ${sidecarPath.split('/').pop()}`);
			} catch (error) {
				if (String(error).includes('File already exists')) {
					return;
				}
				console.error(`Sidecar Plugin: Error creating sidecar file ${sidecarPath}: `, error);
				new Notice(`Error creating sidecar for ${file.name}`);
			}
		}
	}
}

/**
 * Deletes a sidecar file for the given source file
 */
export async function deleteSidecarForFile(plugin: SidecarPlugin, file: TFile): Promise<void> {
	// Ignore delete events for sidecars just restored
	if (recentlyRestoredSidecars.has(file.path)) {
		recentlyRestoredSidecars.delete(file.path);
		return;
	}

	// Ignore manual or auto delete of sidecar files themselves
	if (plugin.isSidecarFile(file.path)) {
		return;
	}

	// Only handle deletions of monitored main files
	if (!plugin.isMonitoredFile(file.path)) {
		return;
	}

	const sidecarPath = plugin.getSidecarPath(file.path);
	const sidecarFile = plugin.app.vault.getAbstractFileByPath(sidecarPath);

	if (sidecarFile instanceof TFile) {
		try {
			await plugin.app.vault.delete(sidecarFile);
			new Notice(`Deleted sidecar: ${sidecarPath.split('/').pop()}`);
		} catch (error) {
			console.error(`Sidecar Plugin: Error deleting sidecar file ${sidecarPath}: `, error);
			new Notice(`Error deleting sidecar for ${file.name}`);
		}
	}
}

/**
 * Handles the renaming/moving of sidecar files when their source files are renamed/moved
 */
export async function handleSidecarRename(plugin: SidecarPlugin, file: TFile, oldPath: string, newPath: string): Promise<void> {
	// If the renamed/moved file was a source file that HAD a sidecar at the OLD location
	const oldSidecarPath = plugin.getSidecarPath(oldPath);
	const oldSidecarFile = plugin.app.vault.getAbstractFileByPath(oldSidecarPath);

	if (oldSidecarFile instanceof TFile) {
		// Source file was renamed/moved, so rename/move its sidecar too
		const newSidecarPath = plugin.getSidecarPath(newPath);
		try {
			// Check if a file/folder already exists at the target newSidecarPath
			const existingNewSidecar = plugin.app.vault.getAbstractFileByPath(newSidecarPath);
			if (existingNewSidecar && existingNewSidecar.path !== oldSidecarFile.path) { // Don't conflict with itself if no actual move
				console.warn(`Sidecar Plugin: Sidecar for ${newPath} already exists at ${newSidecarPath}. Cannot move ${oldSidecarPath}.`);
				new Notice(`Sidecar for ${getBasename(newPath)} already exists. Old sidecar not moved.`, 3000);
				// Optionally, delete the oldSidecarFile here if it's considered redundant and we don't want duplicates.
				// await plugin.app.vault.delete(oldSidecarFile);
			} else if (!existingNewSidecar || existingNewSidecar.path === oldSidecarFile.path) {
				// If it doesn't exist, or it exists but it *is* the old sidecar (i.e. just a name change in same folder)
				await plugin.app.vault.rename(oldSidecarFile, newSidecarPath);
				console.log(`Sidecar Plugin: Moved sidecar from ${oldSidecarPath} to ${newSidecarPath}`);
				// No user notice here as it's an automatic accompanying action.
			}
		} catch (error) {
			console.error(`Sidecar Plugin: Error moving sidecar from ${oldSidecarPath} to ${newSidecarPath}:`, error);
			new Notice(`Error moving sidecar for ${getBasename(newPath)}`, 3000);
		}
	} else {
		// Renamed file was not a sidecar, and didn't have one. If it's now monitored, create one.
		if (plugin.isMonitoredFile(newPath) && !plugin.isSidecarFile(newPath) && !plugin.isRedirectFile(newPath)) {
			const newSidecarPath = plugin.getSidecarPath(newPath);
			const existingSidecar = plugin.app.vault.getAbstractFileByPath(newSidecarPath);
			if (!existingSidecar) {
				try {
					await plugin.app.vault.create(newSidecarPath, '');
					new Notice(`Created sidecar: ${newSidecarPath.split('/').pop()}`);
				} catch (error) {
					console.error(`Sidecar Plugin: Error creating sidecar file ${newSidecarPath}:`, error);
					new Notice(`Error creating sidecar for ${getBasename(newPath)}`);
				}
			}
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
					console.log(`Sidecar Plugin: Created sidecar for ${file.path} at ${sidecarPath}`);
				} catch (error) {
					if (String(error).includes('File already exists')) {
						sidecarEnsuredThisIteration = true;
					} else {
						console.error(`Sidecar Plugin: Error creating sidecar for ${file.path}:`, error);
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
			let reason = "";

			if (!sourcePath) {
				shouldDelete = true;
				reason = "Cannot determine source path";
			} else if (!plugin.app.vault.getAbstractFileByPath(sourcePath)) {
				shouldDelete = true;
				reason = "Source file no longer exists";
			} else if (!plugin.isMonitoredFile(sourcePath)) {
				shouldDelete = true;
				reason = "Source file is no longer monitored";
			}

			if (shouldDelete) {
				try {
					await plugin.app.vault.delete(file);
					deletedOrphanCount++;
					console.log(`Sidecar Plugin: Deleted orphaned sidecar ${file.path}: ${reason}`);
				} catch (error) {
					console.error(`Sidecar Plugin: Error deleting orphaned sidecar ${file.path}:`, error);
				}
			}
		}
	}

	console.log(`Sidecar Plugin: Revalidation complete. Newly created sidecars: ${newlyCreatedSidecarCount}, Monitored files with sidecars: ${countMonitoredFilesWithSidecars}, Deleted orphans: ${deletedOrphanCount}`);
	new Notice(`Sidecar revalidation complete: ${newlyCreatedSidecarCount} created, ${countMonitoredFilesWithSidecars} monitored, ${deletedOrphanCount} orphans deleted.`);
}
