import { Notice, TAbstractFile, TFile } from 'obsidian';
import type SidecarPlugin from './main';

// Track sidecars recently restored to ignore subsequent delete events
const recentlyRestoredSidecars = new Set<string>();

function log(message: string, ...args: any[]) {
  console.log(`SidecarPlugin: ${message}`, ...args);
}

export async function handleFileCreate(plugin: SidecarPlugin, file: TAbstractFile): Promise<void> {
  if (file instanceof TFile && plugin.isMonitoredFile(file.path)) {
    const sidecarPath = plugin.getSidecarPath(file.path);
    if (!plugin.app.vault.getAbstractFileByPath(sidecarPath)) {
      try {
        await plugin.app.vault.create(sidecarPath, `%% Sidecar for ${file.name} %%\n\n`);
        new Notice(`Created sidecar: ${sidecarPath.split('/').pop()}`);
      } catch (error) {
        // Ignore if file already exists (race condition)
        if (String(error).includes('File already exists')) return;
        console.error(`Sidecar Plugin: Error creating sidecar file ${sidecarPath}: `, error);
        new Notice(`Error creating sidecar for ${file.name}`);
      }
    }
  }
}

export async function handleFileDelete(plugin: SidecarPlugin, file: TAbstractFile): Promise<void> {
  log(`handleFileDelete: Entry for path: ${file.path}`);
  if (file instanceof TFile) {
    // Ignore delete events for sidecars just restored
    if (recentlyRestoredSidecars.has(file.path)) {
      log(`handleFileDelete: Path ${file.path} is in recentlyRestoredSidecars. Deleting from set and returning.`);
      recentlyRestoredSidecars.delete(file.path);
      return;
    }
    log(`handleFileDelete: Path ${file.path} not in recentlyRestoredSidecars.`);
    // Ignore manual or auto delete of sidecar files themselves
    if (plugin.isSidecarFile(file.path)) {
      log(`handleFileDelete: Path ${file.path} is a sidecar file. Returning.`);
      return;
    }
    log(`handleFileDelete: Path ${file.path} is not a sidecar file.`);
    // Only handle deletions of monitored main files
    if (!plugin.isMonitoredFile(file.path)) {
      log(`handleFileDelete: Path ${file.path} is not a monitored file. Returning.`);
      return;
    }
    log(`handleFileDelete: Path ${file.path} is a monitored file. Proceeding to delete its sidecar.`);
    const sidecarPath = plugin.getSidecarPath(file.path);
    const sidecarFile = plugin.app.vault.getAbstractFileByPath(sidecarPath);
    if (sidecarFile instanceof TFile) {
      try {
        log(`handleFileDelete: Attempting to delete sidecar ${sidecarPath} for ${file.path}`);
        await plugin.app.vault.delete(sidecarFile);
        new Notice(`Deleted sidecar: ${sidecarPath.split('/').pop()}`);
        log(`handleFileDelete: Successfully deleted sidecar ${sidecarPath}`);
      } catch (error) {
        console.error(`Sidecar Plugin: Error deleting sidecar file ${sidecarPath}: `, error);
        new Notice(`Error deleting sidecar for ${file.name}`);
      }
    }
  }
}

export async function handleFileRename(plugin: SidecarPlugin, file: TAbstractFile, oldPath: string): Promise<void> {
  log(`handleFileRename: Entry for file: ${file.path}, oldPath: ${oldPath}`);
  if (file instanceof TFile) {
    const newPath = file.path;
    // If the renamed file is a sidecar itself, move it back next to its source file
    if (plugin.isSidecarFile(oldPath)) {
      log(`handleFileRename: Detected rename of a sidecar file. oldPath: ${oldPath}, newPath: ${newPath}`);
      // If the sidecar (now at newPath) was just restored by our plugin,
      // this rename event is likely self-triggered. Ignore it to prevent misinterpretation.
      if (recentlyRestoredSidecars.has(newPath)) {
        log(`handleFileRename: Sidecar newPath ${newPath} is in recentlyRestoredSidecars. This is likely a self-triggered event after restoration. Returning early.`);
        // Do not remove from set here; let handleFileDelete or future operations manage it.
        return;
      }
      log(`handleFileRename: Sidecar newPath ${newPath} not in recentlyRestoredSidecars. Processing as a potential user move.`);
      // Compute source based on the original sidecar path (where it was before this rename event)
      const sourcePathBasedOnOld = plugin.getSourcePathFromSidecar(oldPath);
      log(`handleFileRename: Computed sourcePath ${sourcePathBasedOnOld} from oldSidecarPath ${oldPath}`);
      if (sourcePathBasedOnOld) {
        const sourceFile = plugin.app.vault.getAbstractFileByPath(sourcePathBasedOnOld);
        if (sourceFile instanceof TFile) {
          // Source file exists. The sidecar should be next to it.
          log(`handleFileRename: Source file ${sourcePathBasedOnOld} exists.`);
          const intendedSidecarPath = plugin.getSidecarPath(sourcePathBasedOnOld);
          log(`handleFileRename: Intended sidecar path for ${sourcePathBasedOnOld} is ${intendedSidecarPath}. Current newPath is ${newPath}.`);
          if (newPath !== intendedSidecarPath) {
            try {
              log(`handleFileRename: Adding ${intendedSidecarPath} to recentlyRestoredSidecars BEFORE corrective rename.`);
              recentlyRestoredSidecars.add(intendedSidecarPath);

              log(`handleFileRename: Attempting to move sidecar from ${newPath} back to ${intendedSidecarPath} using fileManager.renameFile.`);
              await plugin.app.fileManager.renameFile(file, intendedSidecarPath);
              
              new Notice(`Moved sidecar back to: ${intendedSidecarPath.split('/').pop()}`);
              log(`handleFileRename: Successfully moved sidecar to ${intendedSidecarPath}.`);
            } catch (error) {
              log(`handleFileRename: Error moving sidecar from ${newPath} to ${intendedSidecarPath}. Removing ${intendedSidecarPath} from recentlyRestoredSidecars.`);
              recentlyRestoredSidecars.delete(intendedSidecarPath); // Remove from set if rename failed
              console.error(`Sidecar Plugin: Error moving sidecar back from ${newPath} to ${intendedSidecarPath}: `, error);
              new Notice(`Error restoring sidecar for ${sourceFile.name}`);
            }
          } else {
            // Sidecar is already at its intended location (newPath === intendedSidecarPath).
            log(`handleFileRename: Sidecar ${newPath} is already at its intended location relative to source ${sourcePathBasedOnOld}. No action needed.`);
          }
        } else {
          // Source file (sourcePathBasedOnOld) does NOT exist.
          // This means the sidecar at newPath is an orphan. Delete it.
          log(`handleFileRename: Source file ${sourcePathBasedOnOld} does NOT exist. Deleting orphan sidecar ${newPath}.`);
          try {
            log(`handleFileRename: Attempting to delete orphan sidecar ${newPath}.`);
            await plugin.app.vault.delete(file); // 'file' is the TFile at newPath
            new Notice(`Deleted orphan sidecar: ${file.name}`);
            log(`handleFileRename: Successfully deleted orphan sidecar ${newPath}.`);
          } catch (error) {
            console.error(`Sidecar Plugin: Error deleting orphan sidecar ${newPath}: `, error);
          }
        }
      } else {
        log(`handleFileRename: Could not determine source path from oldSidecarPath ${oldPath}. Sidecar at ${newPath} might be an orphan or misidentified.`);
        // Potentially delete newPath if it's clearly an orphaned sidecar based on its own name,
        // but current logic relies on oldPath for source determination.
      }
      log(`handleFileRename: Finished processing sidecar rename for oldPath: ${oldPath}. Returning.`);
      return;
    }

    log(`handleFileRename: ${oldPath} is not a sidecar file. Checking if it was a monitored file.`);
    if (plugin.isMonitoredFile(oldPath) && !plugin.isSidecarFile(oldPath)) {
      log(`handleFileRename: ${oldPath} was a monitored file (and not a sidecar).`);
      const oldSidecarPath = plugin.getSidecarPath(oldPath);
      // Handle folder-level rename: if sidecar no longer exists at old path but exists at new path, skip further handling
      const newSidecarPathForMonitored = plugin.getSidecarPath(newPath); // Renamed for clarity
      log(`handleFileRename: oldSidecarPath: ${oldSidecarPath}, newSidecarPathForMonitored: ${newSidecarPathForMonitored}`);
      if (!plugin.app.vault.getAbstractFileByPath(oldSidecarPath) && plugin.app.vault.getAbstractFileByPath(newSidecarPathForMonitored)) {
        log(`handleFileRename: Sidecar already moved by folder rename (old doesn't exist, new does). old: ${oldSidecarPath}, new: ${newSidecarPathForMonitored}. Returning.`);
        return;
      }
      const oldSidecarFile = plugin.app.vault.getAbstractFileByPath(oldSidecarPath);
      if (oldSidecarFile instanceof TFile) {
        log(`handleFileRename: Found oldSidecarFile at ${oldSidecarFile.path}.`);
        // Always move sidecar alongside its main file path, regardless of monitored status
        const intendedSidecarPath = plugin.getSidecarPath(newPath);
        log(`handleFileRename: Moving old sidecar ${oldSidecarFile.path} to ${intendedSidecarPath} (monitored file rename) using fileManager.renameFile.`);
        try {
          if (!plugin.app.vault.getAbstractFileByPath(intendedSidecarPath)) {
            log(`handleFileRename: Target ${intendedSidecarPath} does not exist. Renaming.`);
            log(`handleFileRename: Adding ${intendedSidecarPath} to recentlyRestoredSidecars BEFORE renaming sidecar due to main file rename.`);
            recentlyRestoredSidecars.add(intendedSidecarPath);
            await plugin.app.fileManager.renameFile(oldSidecarFile, intendedSidecarPath);
            new Notice(`Moved sidecar to: ${intendedSidecarPath.split('/').pop()}`);
            log(`handleFileRename: Successfully moved sidecar to ${intendedSidecarPath}.`);
          }
        } catch (error) {
          log(`handleFileRename: Error moving sidecar for main file rename. Removing ${intendedSidecarPath} from recentlyRestoredSidecars.`);
          recentlyRestoredSidecars.delete(intendedSidecarPath); // Clean up set on error
          console.error(`Sidecar Plugin: Error moving sidecar file from ${oldSidecarFile.path} to ${intendedSidecarPath}: `, error);
        }
      } else if (plugin.isMonitoredFile(newPath)) {
        log(`handleFileRename: No oldSidecarFile found for ${oldPath}. ${newPath} is monitored. Creating new sidecar.`);
        const newSidecarPath = plugin.getSidecarPath(newPath);
        if (!plugin.app.vault.getAbstractFileByPath(newSidecarPath)) {
          try {
            log(`handleFileRename: Attempting to create sidecar for renamed file at ${newSidecarPath}.`);
            await plugin.app.vault.create(newSidecarPath, `%% Sidecar for ${file.name} %%\n\n`);
            new Notice(`Created sidecar for renamed file: ${newSidecarPath.split('/').pop()}`);
            log(`handleFileRename: Successfully created sidecar for renamed file at ${newSidecarPath}.`);
          } catch (error) {
            // Ignore if already exists
            if (String(error).includes('File already exists')) return;
            console.error(`Sidecar Plugin: Error creating sidecar for renamed file ${newSidecarPath}: `, error);
          }
        }
      }
    }
    // Handle files moved into monitored folder from non-monitored location
    else if (plugin.isMonitoredFile(newPath) && !plugin.isMonitoredFile(oldPath)) {
      log(`handleFileRename: File ${newPath} moved into a monitored folder from non-monitored ${oldPath}.`);
      const oldSidecarPath = plugin.getSidecarPath(oldPath);
      const newSidecarPath = plugin.getSidecarPath(newPath);
      const oldSidecarFile = plugin.app.vault.getAbstractFileByPath(oldSidecarPath);
      if (oldSidecarFile instanceof TFile) {
        log(`handleFileRename: Found existing sidecar at ${oldSidecarPath} for file moved into monitored area. Moving it to ${newSidecarPath} using fileManager.renameFile.`);
        // Move existing sidecar from old location to new location
        try {
          await plugin.app.fileManager.renameFile(oldSidecarFile, newSidecarPath);
          new Notice(`Moved sidecar to: ${newSidecarPath.split('/').pop()}`);
          log(`handleFileRename: Successfully moved sidecar from ${oldSidecarPath} to ${newSidecarPath}.`);
        } catch (error) {
          console.error(`Sidecar Plugin: Error moving sidecar file from ${oldSidecarPath} to ${newSidecarPath}: `, error);
          new Notice(`Error moving sidecar for ${newPath}`);
        }
      } else if (!plugin.app.vault.getAbstractFileByPath(newSidecarPath)) {
        log(`handleFileRename: No old sidecar found for ${oldPath}. Creating new sidecar for moved file at ${newSidecarPath}.`);
        // No existing sidecar; create a new one
        try {
          await plugin.app.vault.create(newSidecarPath, `%% Sidecar for ${file.name} %%\n\n`);
          new Notice(`Created sidecar for moved file: ${newSidecarPath.split('/').pop()}`);
          log(`handleFileRename: Successfully created sidecar for moved file at ${newSidecarPath}.`);
        } catch (error) {
          // Ignore if already exists
          if (String(error).includes('File already exists')) return;
          console.error(`Sidecar Plugin: Error creating sidecar for moved file ${newSidecarPath}: `, error);
        }
      }
    }
    log(`handleFileRename: Finished all checks for file: ${file.path}, oldPath: ${oldPath}`);
  }
}
