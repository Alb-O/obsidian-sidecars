import { Notice, TAbstractFile, TFile } from 'obsidian';
import type SidecarPlugin from './main';
import { getBasename } from './utils'; // Assuming getBasename is exported from utils.ts

// Track sidecars recently restored to ignore subsequent delete events
const recentlyRestoredSidecars = new Set<string>();

export async function handleFileCreate(plugin: SidecarPlugin, file: TAbstractFile): Promise<void> {
  // Prevent sidecar creation for files present at startup if revalidateOnStartup is false
  if (!plugin.hasFinishedInitialLoad && !plugin.settings.revalidateOnStartup) {
    return;
  }
  if (plugin.isInitialRevalidating) {
    return;
  }

  if (file instanceof TFile && plugin.isMonitoredFile(file.path)) {
    const sidecarPath = plugin.getSidecarPath(file.path);
    if (!plugin.app.vault.getAbstractFileByPath(sidecarPath)) {
      try {
        await plugin.app.vault.create(sidecarPath, ''); // Changed to empty string
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

export async function handleFileDelete(plugin: SidecarPlugin, file: TAbstractFile): Promise<void> {
  if (file instanceof TFile) {
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
}

export async function handleFileRename(plugin: SidecarPlugin, file: TAbstractFile, oldPath: string): Promise<void> {
  if (file instanceof TFile) {
    const newPath = file.path;

    // --- Handle "Redirect File" Creation for Monitored Source Files ---
    const oldPathWasMonitoredSource = plugin.settings.enableRedirectFile && 
                                    plugin.isMonitoredFile(oldPath) && 
                                    !plugin.isSidecarFile(oldPath) && 
                                    !plugin.isRedirectFile(oldPath);

    if (oldPathWasMonitoredSource) {
      const redirectFilePath = plugin.getRedirectFilePath(oldPath); // Generate based on the *old* path
      const redirectFileContent = JSON.stringify({
        originalPath: oldPath,
        newPath: newPath,
        timestamp: new Date().toISOString(),
      }, null, 2); // Pretty print JSON

      try {
        const existingRedirectFile = plugin.app.vault.getAbstractFileByPath(redirectFilePath);
        if (!existingRedirectFile) {
          await plugin.app.vault.create(redirectFilePath, redirectFileContent);
          console.log(`Sidecar Plugin: Created redirect file for ${oldPath} at ${redirectFilePath}`);
          new Notice(`Created .redirect file for ${getBasename(oldPath)}`, 2000);
        }
      } catch (error) {
        console.error(`Sidecar Plugin: Error creating redirect file for ${oldPath} at ${redirectFilePath}:`, error);
        new Notice(`Error creating .redirect file for ${getBasename(oldPath)}`, 3000);
      }
    }

    // --- Standard Sidecar Renaming/Movement Logic ---
    // If the renamed/moved file IS a sidecar file itself
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
            console.log(`Sidecar Plugin: Created new sidecar at ${newSidecarPath} for renamed file ${newPath}`);
          } catch (error) {
            console.error(`Sidecar Plugin: Error creating new sidecar for renamed file ${newPath}:`, error);
          }
        }
      }
    }
    plugin.updateSidecarFileAppearance(); // Update appearance for all relevant files
    // --- Cleanup redirect files when a file is moved back to its original location ---
    if (plugin.settings.enableRedirectFile) {
      const redirectCleanupPath = plugin.getRedirectFilePath(newPath);
      const redirectFileToCleanup = plugin.app.vault.getAbstractFileByPath(redirectCleanupPath);
      if (redirectFileToCleanup instanceof TFile) {
        try {
          await plugin.app.vault.delete(redirectFileToCleanup);
          console.log(`Sidecar Plugin: Cleaned up redirect file at ${redirectCleanupPath} after file was restored.`);
          new Notice(`Cleaned up .redirect file for ${getBasename(newPath)}`, 2000);
        } catch (err) {
          console.error(`Sidecar Plugin: Error cleaning up redirect file at ${redirectCleanupPath}:`, err);
        }
      }
    }
  }
}
