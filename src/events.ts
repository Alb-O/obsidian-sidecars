import { TAbstractFile, TFile } from 'obsidian';
import type SidecarPlugin from './main';
import { createSidecarForFile, deleteSidecarForFile, handleSidecarRename } from './sidecar-manager';
import { createRedirectFile, cleanupRedirectFile } from './redirect-manager';

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

		// Create redirect file if needed
		await createRedirectFile(plugin, oldPath, newPath);

		// Handle sidecar file renaming
		if (plugin.isSidecarFile(newPath)) {
			const sourcePath = plugin.getSourcePathFromSidecar(newPath);
			if (sourcePath && !plugin.app.vault.getAbstractFileByPath(sourcePath)) {
				// This sidecar is now an orphan because its source is gone (likely deleted separately)
				// Or, the source was renamed and this sidecar didn't get renamed with it (which this handler should prevent)
				// For now, we'll log it. Revalidation would clean it up.
				console.warn(`Sidecar Plugin: Renamed sidecar ${newPath} is an orphan. Source ${sourcePath} not found.`);
			}
			// If it is a sidecar, its appearance might need updating based on its new path/name
			plugin.updateSidecarFileAppearance();
			return; // Stop here, sidecar itself was moved.
		}

		// Handle sidecar rename when source file is renamed
		await handleSidecarRename(plugin, file, oldPath, newPath);

		// Update UI appearance
		plugin.updateSidecarFileAppearance();

		// Clean up redirect files if needed
		await cleanupRedirectFile(plugin, newPath);
	}
}
