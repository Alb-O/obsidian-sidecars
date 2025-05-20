// src/sidecar-events.ts
import { Notice, TAbstractFile, TFile } from 'obsidian';
import type SidecarPlugin from './main';

export async function handleFileCreate(plugin: SidecarPlugin, file: TAbstractFile): Promise<void> {
  if (file instanceof TFile && plugin.isMonitoredFile(file.path)) {
    const sidecarPath = plugin.getSidecarPath(file.path);
    if (!plugin.app.vault.getAbstractFileByPath(sidecarPath)) {
      try {
        await plugin.app.vault.create(sidecarPath, `%% Sidecar for ${file.name} %%\n\n`);
        new Notice(`Created sidecar: ${sidecarPath.split('/').pop()}`);
      } catch (error) {
        console.error(`Sidecar Plugin: Error creating sidecar file ${sidecarPath}: `, error);
        new Notice(`Error creating sidecar for ${file.name}`);
      }
    }
  }
}

export async function handleFileDelete(plugin: SidecarPlugin, file: TAbstractFile): Promise<void> {
  if (file instanceof TFile && plugin.isMonitoredFile(file.path)) {
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
    if (plugin.isMonitoredFile(oldPath) && !plugin.isSidecarFile(oldPath)) {
      const oldSidecarPath = plugin.getSidecarPath(oldPath);
      const oldSidecarFile = plugin.app.vault.getAbstractFileByPath(oldSidecarPath);
      if (oldSidecarFile instanceof TFile) {
        if (plugin.isMonitoredFile(newPath)) {
          const newSidecarPath = plugin.getSidecarPath(newPath);
          try {
            const existingFileAtNewSidecarPath = plugin.app.vault.getAbstractFileByPath(newSidecarPath);
            if (existingFileAtNewSidecarPath && existingFileAtNewSidecarPath.path !== oldSidecarFile.path) {
              new Notice(`Sidecar rename conflict for ${newPath}. Target ${newSidecarPath} already exists. Sidecar not renamed.`, 10000);
            } else if (existingFileAtNewSidecarPath && existingFileAtNewSidecarPath.path === oldSidecarFile.path) {
              // No action needed
            } else {
              await plugin.app.vault.rename(oldSidecarFile, newSidecarPath);
              new Notice(`Renamed sidecar to: ${newSidecarPath.split('/').pop()}`);
            }
          } catch (error) {
            console.error(`Sidecar Plugin: Error renaming sidecar file from ${oldSidecarPath} to ${newSidecarPath}: `, error);
            new Notice(`Error renaming sidecar for ${newPath}`);
          }
        } else {
          try {
            await plugin.app.vault.delete(oldSidecarFile);
            new Notice(`Deleted orphan sidecar for: ${oldPath.split('/').pop()}`);
          } catch (error) {
            console.error(`Sidecar Plugin: Error deleting orphan sidecar file ${oldSidecarPath}: `, error);
            new Notice(`Error deleting orphan sidecar for ${oldPath.split('/').pop()}`);
          }
        }
      } else if (plugin.isMonitoredFile(newPath)) {
        const newSidecarPath = plugin.getSidecarPath(newPath);
        if (!plugin.app.vault.getAbstractFileByPath(newSidecarPath)) {
          try {
            await plugin.app.vault.create(newSidecarPath, `%% Sidecar for ${file.name} %%\n\n`);
            new Notice(`Created sidecar for renamed file: ${newSidecarPath.split('/').pop()}`);
          } catch (error) {
            console.error(`Sidecar Plugin: Error creating sidecar for renamed file ${newSidecarPath}: `, error);
          }
        }
      }
    }
  }
}
