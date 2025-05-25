import { TAbstractFile, TFile, Notice } from 'obsidian';
import type SidecarPlugin from './main';
import { createSidecarForFile, deleteSidecarForFile, handleSidecarRename } from './sidecar-manager';
import { createRedirectFile, cleanupRedirectFile } from './redirect-manager';

/**
 * Renames the main file when a sidecar file is renamed
 */
async function renameSidecarMainFile(plugin: SidecarPlugin, oldSidecarPath: string, newSidecarPath: string): Promise<void> {
	const oldMainPath = plugin.getSourcePathFromSidecar(oldSidecarPath);
	if (!oldMainPath) {
		console.warn(`Sidecar Plugin: Cannot determine main file path for old sidecar: ${oldSidecarPath}`);
		return;
	}

	const newMainPath = plugin.getSourcePathFromSidecar(newSidecarPath);
	if (!newMainPath) {
		console.warn(`Sidecar Plugin: Cannot determine main file path for new sidecar: ${newSidecarPath}`);
		return;
	}	// Check if the main file exists
	const mainFile = plugin.app.vault.getAbstractFileByPath(oldMainPath);
	if (!mainFile || !(mainFile instanceof TFile)) {
		console.log(`Sidecar Plugin: Main file ${oldMainPath} not found, skipping rename`);
		return;
	}

	// Check if target main path already exists
	const existingTargetFile = plugin.app.vault.getAbstractFileByPath(newMainPath);
	if (existingTargetFile) {
		console.warn(`Sidecar Plugin: Target main path ${newMainPath} already exists, skipping rename`);
		new Notice(`Cannot rename main file: ${newMainPath.split('/').pop()} already exists`, 3000);
		return;
	}

	try {
		await plugin.app.vault.rename(mainFile, newMainPath);
		console.log(`Sidecar Plugin: Renamed main file from ${oldMainPath} to ${newMainPath}`);
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
	console.log(`Sidecar Plugin: handleExtensionReapplication - oldPath: ${oldPath}, newPath: ${newPath}`);
	// Check if the old path was a sidecar file
	if (plugin.isSidecarFile(oldPath)) {
		console.log(`Sidecar Plugin: Old path was a sidecar file: ${oldPath}`);
		const mainPath = plugin.getSourcePathFromSidecar(oldPath);
		if (mainPath) {
			const expectedNewSidecarPath = plugin.getSidecarPath(mainPath);
			console.log(`Sidecar Plugin: mainPath: ${mainPath}, expectedNewSidecarPath: ${expectedNewSidecarPath}`);// If the new path doesn't have the sidecar extension but should be a sidecar
			if (newPath !== expectedNewSidecarPath && !plugin.isSidecarFile(newPath)) {
				console.log(`Sidecar Plugin: New path ${newPath} doesn't have sidecar extension`);
				
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
				
				console.log(`Sidecar Plugin: Will restore extension - newBaseName: "${newBaseName}", mainExtensions: "${mainExtensions}", newSidecarPath: "${newSidecarPath}"`);try {
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
		// Check if the old path was a redirect file
	if (plugin.isRedirectFile(oldPath)) {
		const mainPath = plugin.getSourcePathFromRedirectFile(oldPath);
		if (mainPath) {
			const expectedNewRedirectPath = plugin.getRedirectFilePath(mainPath);
					// If the new path doesn't have the redirect extension but should be a redirect
			if (newPath !== expectedNewRedirectPath && !plugin.isRedirectFile(newPath)) {
				// Get the new file name without extension to use as the base for the restored redirect
				const newFileName = newPath.substring(newPath.lastIndexOf('/') + 1);
				const newFileNameWithoutExt = newFileName.lastIndexOf('.') !== -1 
					? newFileName.slice(0, newFileName.lastIndexOf('.')) 
					: newFileName;
				
				// Build the new redirect path using the new base name
				const directory = newPath.substring(0, newPath.lastIndexOf('/') + 1);
				const newRedirectPath = directory + newFileNameWithoutExt + '.' + plugin.settings.redirectFileSuffix + '.md';
				
				try {
					await plugin.app.vault.rename(file, newRedirectPath);
					new Notice(`Redirect extension restored: ${newRedirectPath.split('/').pop()}`, 3000);
					return true; // Indicates we handled the rename
				} catch (error) {
					console.error(`Sidecar Plugin: Error restoring redirect extension for ${newPath}:`, error);
					new Notice(`Error restoring redirect extension for ${newFileName}`, 3000);
				}
			}
		}
	}
	
	return false; // No extension reapplication was needed/performed
}

export async function handleFileCreate(plugin: SidecarPlugin, file: TAbstractFile): Promise<void> {
	if (file instanceof TFile) {
		await createSidecarForFile(plugin, file);

		if (plugin.isRedirectFile(file.path) || plugin.isSidecarFile(file.path)) {
			// Use a small delay to ensure the file explorer DOM has been updated
			setTimeout(() => {
				plugin.updateSidecarFileAppearance();
			}, 20);
		}
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
		console.log(`Sidecar Plugin: handleFileRename called - oldPath: ${oldPath}, newPath: ${newPath}`);

		// First, check if we need to re-apply extensions for improperly renamed sidecar/redirect files
		const extensionWasReapplied = await handleExtensionReapplication(plugin, file, oldPath);
		
		// If we re-applied an extension, the file path has changed, so we need to update our reference
		// and exit early since this was just a correction rename
		if (extensionWasReapplied) {
			// Update UI appearance after extension correction
			plugin.updateSidecarFileAppearance();
			return;
		}

		// Create redirect file if needed
		await createRedirectFile(plugin, oldPath, newPath);		// Handle sidecar file renaming
		if (plugin.isSidecarFile(newPath)) {
			console.log(`Sidecar Plugin: Sidecar file was renamed from ${oldPath} to ${newPath}`);
			
			// Rename the associated main file when a sidecar is renamed
			await renameSidecarMainFile(plugin, oldPath, newPath);
			
			const mainPath = plugin.getSourcePathFromSidecar(newPath);
			if (mainPath && !plugin.app.vault.getAbstractFileByPath(mainPath)) {
				// This sidecar is now an orphan because its main file is gone (likely deleted separately)
				// Or, the main file was renamed and this sidecar didn't get renamed with it (which this handler should prevent)
				// For now, we'll log it. Revalidation would clean it up.
				console.warn(`Sidecar Plugin: Renamed sidecar ${newPath} is an orphan. Main file ${mainPath} not found.`);
			}
			// If it is a sidecar, its appearance might need updating based on its new path/name
			plugin.updateSidecarFileAppearance();
			return; // Stop here, sidecar itself was moved.
		}
		// Handle sidecar rename when main file is renamed
		await handleSidecarRename(plugin, file, oldPath, newPath);

		// Update UI appearance
		plugin.updateSidecarFileAppearance();

		// Clean up redirect files if needed
		await cleanupRedirectFile(plugin, newPath);
	}
}
