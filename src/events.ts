import { warn, debug } from './utils/obsidian-logger';
import { TAbstractFile, TFile, Notice, FileManager } from 'obsidian';
import type SidecarPlugin from './main';
import { createSidecarForFile, deleteSidecarForFile, handleSidecarRename } from './sidecar-manager';

/**
 * Renames the main file when a sidecar file is renamed
 */
async function renameSidecarMainFile(plugin: SidecarPlugin, oldSidecarPath: string, newSidecarPath: string): Promise<void> {
	debug(this, `renameSidecarMainFile called: oldSidecarPath="${oldSidecarPath}", newSidecarPath="${newSidecarPath}"`);
	
	const oldMainPath = plugin.getSourcePathFromSidecar(oldSidecarPath);
	if (!oldMainPath) {
		debug(this, `Cannot determine old main path for sidecar: ${oldSidecarPath}`);
		warn(this, `Sidecar Plugin: Cannot determine main file path for old sidecar: ${oldSidecarPath}`);
		return;
	}
	debug(this, `Old main path determined: ${oldMainPath}`);

	const newMainPath = plugin.getSourcePathFromSidecar(newSidecarPath);
	if (!newMainPath) {
		debug(this, `Cannot determine new main path for sidecar: ${newSidecarPath}`);
		warn(this, `Sidecar Plugin: Cannot determine main file path for new sidecar: ${newSidecarPath}`);
		return;
	}
	debug(this, `New main path determined: ${newMainPath}`);	// Check if the main file exists
	const mainFile = plugin.app.vault.getAbstractFileByPath(oldMainPath);
	if (!mainFile || !(mainFile instanceof TFile)) {
		debug(this, `Main file not found at ${oldMainPath}, skipping rename`);
		// Main file not found, skipping rename (no debug output)
		return;
	}
	debug(this, `Main file found: ${mainFile.path}`);

	// Check if target main path already exists
	const existingTargetFile = plugin.app.vault.getAbstractFileByPath(newMainPath);
	if (existingTargetFile) {
		debug(this, `Target main path ${newMainPath} already exists, cannot rename`);
		warn(this, `Sidecar Plugin: Target main path ${newMainPath} already exists, skipping rename`);
		new Notice(`Cannot rename main file: ${newMainPath.split('/').pop()} already exists`, 3000);
		return;
	}
	debug(this, `Target path is available, proceeding with rename`);
	
	try {
		debug(this, `Attempting to rename main file from ${oldMainPath} to ${newMainPath}`);
		await plugin.app.fileManager.renameFile(mainFile, newMainPath);
		debug(this, `Successfully renamed main file to ${newMainPath}`);
		new Notice(`Also renamed main file to: ${newMainPath.split('/').pop()}`, 2000);
	} catch (error) {
		debug(this, `Error renaming main file from ${oldMainPath} to ${newMainPath}:`, error);
		console.error(`Sidecar Plugin: Error renaming main file from ${oldMainPath} to ${newMainPath}:`, error);
		new Notice(`Error renaming main file to ${newMainPath.split('/').pop()}`, 3000);
	}
}

/**
 * Checks if a file was renamed to just the base name and needs extensions re-applied
 */
async function handleExtensionReapplication(plugin: SidecarPlugin, file: TFile, oldPath: string): Promise<boolean> {
	const newPath = file.path;
	debug(this, `handleExtensionReapplication called: oldPath="${oldPath}", newPath="${newPath}"`);
	
	// Check if the old path was a sidecar file
	if (plugin.isSidecarFile(oldPath)) {
		debug(this, `Old path was a sidecar file`);
		const mainPath = plugin.getSourcePathFromSidecar(oldPath);
		if (mainPath) {
			debug(this, `Main path for old sidecar: ${mainPath}`);
			const expectedNewSidecarPath = plugin.getSidecarPath(mainPath);
			debug(this, `Expected new sidecar path: ${expectedNewSidecarPath}`);
			// If the new path doesn't have the sidecar extension but should be a sidecar
			if (newPath !== expectedNewSidecarPath && !plugin.isSidecarFile(newPath)) {
				debug(this, `Extension reapplication needed - new path missing sidecar extensions`);
				// Get the new file name to use as the base for the restored sidecar
				const newFileName = newPath.substring(newPath.lastIndexOf('/') + 1);
				// Remove only .md extension if present, preserving other extensions
				const newFileNameWithoutMd = newFileName.endsWith('.md')
					? newFileName.slice(0, -3)
					: newFileName;
				// Extract the extension pattern from the original main file
				const mainFileName = mainPath.substring(mainPath.lastIndexOf('/') + 1);
				const mainBaseName = mainFileName.lastIndexOf('.') !== -1
					? mainFileName.slice(0, mainFileName.lastIndexOf('.'))
					: mainFileName;
				const mainExtensions = mainFileName.substring(mainBaseName.length); // e.g., ".blend"
				// Get just the base name from the new filename (without any extensions)
				const newBaseName = newFileNameWithoutMd.lastIndexOf('.') !== -1
					? newFileNameWithoutMd.slice(0, newFileNameWithoutMd.lastIndexOf('.'))
					: newFileNameWithoutMd;
				// Build the new sidecar path: newBaseName + originalExtensions + .side.md
				const directory = newPath.substring(0, newPath.lastIndexOf('/') + 1);
				const newSidecarPath = directory + newBaseName + mainExtensions + '.' + plugin.settings.sidecarSuffix + '.md';
				debug(this, `Calculated restoration path: ${newSidecarPath}`);
				try {
					debug(this, `Attempting to restore sidecar extension from ${newPath} to ${newSidecarPath}`);
					await plugin.app.fileManager.renameFile(file, newSidecarPath);
					debug(this, `Successfully restored sidecar extension`);
					// Also rename the associated main file if needed
					await renameSidecarMainFile(plugin, oldPath, newSidecarPath);
					return true;
				} catch (error) {
					debug(this, `Error restoring sidecar extension for ${newPath}:`, error);
					console.error(`Sidecar Plugin: Error restoring sidecar extension for ${newPath}:`, error);
				}
			} else {
				debug(this, `No extension reapplication needed - paths match or new path is already a sidecar`);
			}
		} else {
			debug(this, `Could not determine main path for old sidecar`);
		}
	} else {
		debug(this, `Old path was not a sidecar file`);
	}
	return false; // No extension reapplication was needed/performed
}

export async function handleFileCreate(plugin: SidecarPlugin, file: TAbstractFile): Promise<void> {
	if (file instanceof TFile) {
		await createSidecarForFile(plugin, file);

		// If this is a redirect file being created, update the decorator for the source file
		if (plugin.isRedirectFile(file.path)) {
			plugin.updateSidecarFileAppearance();
		}
	}
}

export async function handleFileDelete(plugin: SidecarPlugin, file: TAbstractFile): Promise<void> {
	if (file instanceof TFile) {
		await deleteSidecarForFile(plugin, file);

		// If this is a redirect file being deleted, update the decorator for the source file
		if (plugin.isRedirectFile(file.path)) {
			plugin.updateSidecarFileAppearance();
		}
	}
}

export async function handleFileRename(plugin: SidecarPlugin, file: TAbstractFile, oldPath: string): Promise<void> {
	if (file instanceof TFile) {
		const newPath = file.path;
		debug(this, `handleFileRename called: oldPath="${oldPath}", newPath="${newPath}"`);

		// First, check if we need to re-apply extensions for improperly renamed sidecar/redirect files
		const extensionWasReapplied = await handleExtensionReapplication(plugin, file, oldPath);
		debug(this, `Extension reapplication result: ${extensionWasReapplied}`);

		// If we re-applied an extension, the file path has changed, so we need to update our reference
		// and exit early since this was just a correction rename
		if (extensionWasReapplied) {
			debug(this, `Extension was reapplied, updating UI and exiting early`);
			// Update UI appearance after extension correction
			plugin.updateSidecarFileAppearance();
			return;
		}

		// Handle sidecar file renaming
		if (plugin.isSidecarFile(newPath)) {
			debug(this, `New path is a sidecar file, handling sidecar rename`);
			// Rename the associated main file when a sidecar is renamed
			await renameSidecarMainFile(plugin, oldPath, newPath);

			const mainPath = plugin.getSourcePathFromSidecar(newPath);
			if (mainPath && !plugin.app.vault.getAbstractFileByPath(mainPath)) {
				// This sidecar is now an orphan because its main file is gone (likely deleted separately)
				// Or, the main file was renamed and this sidecar didn't get renamed with it (which this handler should prevent)
				// For now, we'll log it. Revalidation would clean it up.
				debug(this, `Sidecar is orphaned - main file ${mainPath} not found`);
				warn(this, `Sidecar Plugin: Renamed sidecar ${newPath} is an orphan. Main file ${mainPath} not found.`);
			}
			// If it is a sidecar, its appearance might need updating based on its new path/name
			plugin.updateSidecarFileAppearance();
			debug(this, `Sidecar rename handling complete`);
			return; // Stop here, sidecar itself was moved.
		}
		debug(this, `New path is not a sidecar, handling main file rename`);
		// Handle sidecar rename when main file is renamed
		await handleSidecarRename(plugin, file, oldPath, newPath);

		// Update UI appearance
		plugin.updateSidecarFileAppearance();
		debug(this, `Main file rename handling complete`);
	}
}
