import { sidecarWarn } from './settings';
import { TAbstractFile, TFile, Notice } from 'obsidian';
import type SidecarPlugin from './main';
import { createSidecarForFile, deleteSidecarForFile, handleSidecarRename } from './sidecar-manager';

/**
 * Renames the main file when a sidecar file is renamed
 */
async function renameSidecarMainFile(plugin: SidecarPlugin, oldSidecarPath: string, newSidecarPath: string): Promise<void> {
	const oldMainPath = plugin.getSourcePathFromSidecar(oldSidecarPath);
	if (!oldMainPath) {
   sidecarWarn(`Sidecar Plugin: Cannot determine main file path for old sidecar: ${oldSidecarPath}`);
		return;
	}

	const newMainPath = plugin.getSourcePathFromSidecar(newSidecarPath);
	if (!newMainPath) {
   sidecarWarn(`Sidecar Plugin: Cannot determine main file path for new sidecar: ${newSidecarPath}`);
		return;
	}	// Check if the main file exists
	const mainFile = plugin.app.vault.getAbstractFileByPath(oldMainPath);
	if (!mainFile || !(mainFile instanceof TFile)) {
		// Main file not found, skipping rename (no debug output)
		return;
	}

	// Check if target main path already exists
	const existingTargetFile = plugin.app.vault.getAbstractFileByPath(newMainPath);
	if (existingTargetFile) {
   sidecarWarn(`Sidecar Plugin: Target main path ${newMainPath} already exists, skipping rename`);
		new Notice(`Cannot rename main file: ${newMainPath.split('/').pop()} already exists`, 3000);
		return;
	}

	try {
		await plugin.app.vault.rename(mainFile, newMainPath);
		new Notice(`Also renamed main file to: ${newMainPath.split('/').pop()}`, 2000);
	} catch (error) {
		console.error(`Sidecar Plugin: Error renaming main file from ${oldMainPath} to ${newMainPath}:`, error);
		new Notice(`Error renaming main file to ${newMainPath.split('/').pop()}`, 3000);
	}
}

/**
 * Checks if a file was renamed to just the base name and needs extensions re-applied
 */
async function handleExtensionReapplication(plugin: SidecarPlugin, file: TFile, oldPath: string): Promise<boolean> {
	const newPath = file.path;
	// Check if the old path was a sidecar file
	if (plugin.isSidecarFile(oldPath)) {
		const mainPath = plugin.getSourcePathFromSidecar(oldPath);
		if (mainPath) {
			const expectedNewSidecarPath = plugin.getSidecarPath(mainPath);
			// If the new path doesn't have the sidecar extension but should be a sidecar
			if (newPath !== expectedNewSidecarPath && !plugin.isSidecarFile(newPath)) {
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
				try {
					await plugin.app.vault.rename(file, newSidecarPath);
					// Also rename the associated main file if needed
					await renameSidecarMainFile(plugin, oldPath, newSidecarPath);
					return true;
				} catch (error) {
					console.error(`Sidecar Plugin: Error restoring sidecar extension for ${newPath}:`, error);
				}
			}
		}
	}
	return false; // No extension reapplication was needed/performed
}

export async function handleFileCreate(plugin: SidecarPlugin, file: TAbstractFile): Promise<void> {
	if (file instanceof TFile) {
		await createSidecarForFile(plugin, file);
	}
}

export async function handleFileDelete(plugin: SidecarPlugin, file: TAbstractFile): Promise<void> {
	if (file instanceof TFile) {
		await deleteSidecarForFile(plugin, file);
	}
}

export async function handleFileRename(plugin: SidecarPlugin, file: TAbstractFile, oldPath: string): Promise<void> {
	if (file instanceof TFile) {
		const newPath = file.path;

		// First, check if we need to re-apply extensions for improperly renamed sidecar/redirect files
		const extensionWasReapplied = await handleExtensionReapplication(plugin, file, oldPath);
		
		// If we re-applied an extension, the file path has changed, so we need to update our reference
		// and exit early since this was just a correction rename
		if (extensionWasReapplied) {
			// Update UI appearance after extension correction
			plugin.updateSidecarFileAppearance();
			return;
		}

		// Handle sidecar file renaming
		if (plugin.isSidecarFile(newPath)) {
			// Rename the associated main file when a sidecar is renamed
			await renameSidecarMainFile(plugin, oldPath, newPath);
			
			const mainPath = plugin.getSourcePathFromSidecar(newPath);
			if (mainPath && !plugin.app.vault.getAbstractFileByPath(mainPath)) {
				// This sidecar is now an orphan because its main file is gone (likely deleted separately)
				// Or, the main file was renamed and this sidecar didn't get renamed with it (which this handler should prevent)
				// For now, we'll log it. Revalidation would clean it up.
			   sidecarWarn(`Sidecar Plugin: Renamed sidecar ${newPath} is an orphan. Main file ${mainPath} not found.`);
			}
			// If it is a sidecar, its appearance might need updating based on its new path/name
			plugin.updateSidecarFileAppearance();
			return; // Stop here, sidecar itself was moved.
		}
		// Handle sidecar rename when main file is renamed
		await handleSidecarRename(plugin, file, oldPath, newPath);

		// Update UI appearance
		plugin.updateSidecarFileAppearance();
	}
}
