import { Notice, TAbstractFile, TFile } from 'obsidian';
import type SidecarPlugin from './main';

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
    // If the renamed file is a sidecar itself, move it back next to its source file
    if (plugin.isSidecarFile(oldPath)) {
      // If the sidecar (now at newPath) was just restored by our plugin,
      // this rename event is likely self-triggered. Ignore it to prevent misinterpretation.
      if (recentlyRestoredSidecars.has(newPath)) {
        return;
      }
      const sourcePathBasedOnOld = plugin.getSourcePathFromSidecar(oldPath);
      if (sourcePathBasedOnOld) {
        const sourceFile = plugin.app.vault.getAbstractFileByPath(sourcePathBasedOnOld);
        if (sourceFile instanceof TFile) {
          const intendedSidecarPath = plugin.getSidecarPath(sourcePathBasedOnOld);
          if (newPath !== intendedSidecarPath) {
            try {
              recentlyRestoredSidecars.add(intendedSidecarPath);
              await plugin.app.fileManager.renameFile(file, intendedSidecarPath);
              new Notice(`Moved sidecar back to: ${intendedSidecarPath.split('/').pop()}`);
            } catch (error) {
              recentlyRestoredSidecars.delete(intendedSidecarPath); // Remove from set if rename failed
              console.error(`Sidecar Plugin: Error moving sidecar back from ${newPath} to ${intendedSidecarPath}: `, error);
              new Notice(`Error restoring sidecar for ${sourceFile.name}`);
            }
          }
        } else {
          // Source file (sourcePathBasedOnOld) does NOT exist.
          // This means the sidecar at newPath is an orphan. Delete it.
          try {
            await plugin.app.vault.delete(file); // 'file' is the TFile at newPath
            new Notice(`Deleted orphan sidecar: ${file.name}`);
          } catch (error) {
            console.error(`Sidecar Plugin: Error deleting orphan sidecar ${newPath}: `, error);
          }
        }
      }
      return;
    }

    if (plugin.isMonitoredFile(oldPath) && !plugin.isSidecarFile(oldPath)) {
      const oldSidecarPath = plugin.getSidecarPath(oldPath);
      const newPotentialSidecarPath = plugin.getSidecarPath(newPath);

      const oldSidecarFileRef = plugin.app.vault.getAbstractFileByPath(oldSidecarPath);
      const newSidecarFileRefIfMovedWithFolder = plugin.app.vault.getAbstractFileByPath(newPotentialSidecarPath);

      // Scenario 1: Sidecar might have been moved due to a parent folder rename
      if (!oldSidecarFileRef && newSidecarFileRefIfMovedWithFolder instanceof TFile) {
        if (!plugin.isMonitoredFile(newPath)) {
          try {
            await plugin.app.vault.delete(newSidecarFileRefIfMovedWithFolder);
            new Notice(`Deleted sidecar for ${newPath} (main file moved to non-monitored area).`);
          } catch (error) {
            console.error(`Sidecar Plugin: Error deleting sidecar ${newSidecarFileRefIfMovedWithFolder.path} after folder rename:`, error);
          }
        } else {
          recentlyRestoredSidecars.add(newSidecarFileRefIfMovedWithFolder.path);
        }
        return; // Handled this folder rename scenario
      }

      // Scenario 2: Regular handling if an old sidecar file exists
      if (oldSidecarFileRef instanceof TFile) {
        if (plugin.isMonitoredFile(newPath)) { // Main file's new location IS monitored
          const intendedSidecarPath = newPotentialSidecarPath; // Same as newPotentialSidecarPath

          if (oldSidecarFileRef.path === intendedSidecarPath) {
            recentlyRestoredSidecars.add(intendedSidecarPath);
          } else {
            const existingFileAtIntendedPath = plugin.app.vault.getAbstractFileByPath(intendedSidecarPath);
            if (existingFileAtIntendedPath && existingFileAtIntendedPath.path !== oldSidecarFileRef.path) {
              try {
                await plugin.app.vault.delete(oldSidecarFileRef);
                new Notice(`Deleted original sidecar for ${oldPath} (conflict at new location).`);
                // The existing file at the intended path is now the de facto sidecar, protect it.
                recentlyRestoredSidecars.add(intendedSidecarPath);
              } catch (error) {
                 console.error(`Sidecar Plugin: Error deleting original sidecar ${oldSidecarFileRef.path} due to conflict:`, error);
              }
            } else if (!existingFileAtIntendedPath) { // Target does not exist, proceed with rename
              try {
                recentlyRestoredSidecars.add(intendedSidecarPath);
                await plugin.app.fileManager.renameFile(oldSidecarFileRef, intendedSidecarPath);
                new Notice(`Moved sidecar to: ${intendedSidecarPath.split('/').pop()}`);
              } catch (error) {
                recentlyRestoredSidecars.delete(intendedSidecarPath);
                console.error(`Sidecar Plugin: Error moving sidecar file from ${oldSidecarFileRef.path} to ${intendedSidecarPath}: `, error);
              }
            } else {
              // Sidecar rename skipped, likely due to existing file at intended path
            }
          }
        } else { // Main file's new location IS NOT monitored
          try {
            if (recentlyRestoredSidecars.has(oldSidecarFileRef.path)) {
              recentlyRestoredSidecars.delete(oldSidecarFileRef.path);
            }
            await plugin.app.vault.delete(oldSidecarFileRef);
            new Notice(`Deleted sidecar for ${oldPath} (main file moved to non-monitored area).`);
          } catch (error) {
            console.error(`Sidecar Plugin: Error deleting sidecar ${oldSidecarFileRef.path} after main file moved out: `, error);
          }
        }
      } else if (plugin.isMonitoredFile(newPath)) { // No old sidecar, but new location IS monitored
        if (!plugin.app.vault.getAbstractFileByPath(newPotentialSidecarPath)) {
          try {
            await plugin.app.vault.create(newPotentialSidecarPath, ''); // Changed to empty string
            new Notice(`Created sidecar for renamed file: ${newPotentialSidecarPath.split('/').pop()}`);
          } catch (error) {
            if (String(error).includes('File already exists')) {
                // Sidecar already exists, creation skipped.
            } else {
                console.error(`Sidecar Plugin: Error creating sidecar for renamed file ${newPotentialSidecarPath}: `, error);
            }
          }
        }
      }
      // If oldPath was monitored, but newPath is not, and there was no oldSidecarFile, nothing to do.
    }
    // Handle files moved into monitored folder from non-monitored location
    else if (plugin.isMonitoredFile(newPath) && !plugin.isMonitoredFile(oldPath)) {
      const oldSidecarPath = plugin.getSidecarPath(oldPath);
      const newSidecarPath = plugin.getSidecarPath(newPath);
      const oldSidecarFile = plugin.app.vault.getAbstractFileByPath(oldSidecarPath);
      if (oldSidecarFile instanceof TFile) {
        // Move existing sidecar from old location to new location
        try {
          await plugin.app.fileManager.renameFile(oldSidecarFile, newSidecarPath);
          new Notice(`Moved sidecar to: ${newSidecarPath.split('/').pop()}`);
        } catch (error) {
          console.error(`Sidecar Plugin: Error moving sidecar file from ${oldSidecarPath} to ${newSidecarPath}: `, error);
          new Notice(`Error moving sidecar for ${newPath}`);
        }
      } else if (!plugin.app.vault.getAbstractFileByPath(newSidecarPath)) {
        // No existing sidecar; create a new one
        try {
          await plugin.app.vault.create(newSidecarPath, ''); // Changed to empty string
          new Notice(`Created sidecar for moved file: ${newSidecarPath.split('/').pop()}`);
        } catch (error) {
          // Ignore if already exists
          if (String(error).includes('File already exists')) return;
          console.error(`Sidecar Plugin: Error creating sidecar for moved file ${newSidecarPath}: `, error);
        }
      }
    }
  }
}
