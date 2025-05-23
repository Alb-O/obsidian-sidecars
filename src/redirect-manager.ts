import { TFile, TAbstractFile, Notice } from 'obsidian';
import { getBasename } from './utils';
import type SidecarPlugin from './main';

/**
 * Creates a redirect file when a monitored file is renamed/moved
 */
export async function createRedirectFile(plugin: SidecarPlugin, oldPath: string, newPath: string): Promise<void> {
  if (!plugin.settings.enableRedirectFile) {
    return;
  }

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
        // Ensure the explorer updates to show the new redirect file correctly styled
        plugin.updateSidecarFileAppearance(); 
      }
    } catch (error) {
      console.error(`Sidecar Plugin: Error creating redirect file for ${oldPath} at ${redirectFilePath}:`, error);
      new Notice(`Error creating .redirect file for ${getBasename(oldPath)}`, 3000);
    }
  }
}

/**
 * Cleans up redirect files when a file is moved back to its original location
 */
export async function cleanupRedirectFile(plugin: SidecarPlugin, newPath: string): Promise<void> {
  if (!plugin.settings.enableRedirectFile) {
    return;
  }
  
  const redirectCleanupPath = plugin.getRedirectFilePath(newPath);
  const redirectFileToCleanup = plugin.app.vault.getAbstractFileByPath(redirectCleanupPath);
  
  if (redirectFileToCleanup instanceof TFile) {
    try {
      await plugin.app.vault.delete(redirectFileToCleanup);
      console.log(`Sidecar Plugin: Cleaned up redirect file at ${redirectCleanupPath} after file was restored.`);
      new Notice(`Cleaned up .redirect file for ${getBasename(newPath)}`, 2000);
    } catch (err) {
      console.error(`Sidecar Plugin: Error cleaning up redirect file at ${redirectCleanupPath}:`, err);
      new Notice(`Error cleaning up .redirect file for ${getBasename(newPath)}`, 3000);
    }
  }
}

/**
 * Batch cleans up all redirect files in the vault
 */
export async function cleanupAllRedirectFiles(plugin: SidecarPlugin): Promise<void> {
  if (!plugin.settings.enableRedirectFile || !plugin.settings.redirectFileSuffix?.trim()) {
    new Notice('Redirect file feature is not enabled or suffix is not configured. Nothing to clean.');
    return;
  }

  new Notice(`Starting cleanup of redirect files...`, 3000);
  let deletedRedirectFileCount = 0;
  const allFiles = plugin.app.vault.getFiles();

  for (const file of allFiles) {
    // Ensure we are dealing with TFile instances before attempting to delete
    if (file instanceof TFile && plugin.isRedirectFile(file.path)) {
      try {
        await plugin.app.vault.delete(file);
        deletedRedirectFileCount++;
      } catch (error) {
        console.error(`Sidecar Plugin: Error deleting redirect file ${file.path}:`, error);
        new Notice(`Error deleting redirect file: ${file.name}`, 3000);
      }
    }
  }

  if (deletedRedirectFileCount > 0) {
    new Notice(`Cleanup complete: ${deletedRedirectFileCount} redirect file(s) deleted.`);
  } else {
    new Notice(`Cleanup complete: No redirect files found to delete.`);
  }
}
