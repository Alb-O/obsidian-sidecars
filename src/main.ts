import { Notice, Plugin, TFile } from 'obsidian';
import { SidecarSettingTab } from './settings';
import { handleFileCreate, handleFileDelete, handleFileRename } from './sidecar-events';
import { isMonitoredFile, getSidecarPath, isSidecarFile, getSourcePathFromSidecar, isFileAllowedByFolderLists } from './utils';
import { DEFAULT_SETTINGS, SidecarPluginSettings } from './settings';

export default class SidecarPlugin extends Plugin {
  settings: SidecarPluginSettings;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new SidecarSettingTab(this.app, this));

    // Inject or remove CSS for hiding sidecar files in explorer
    this.updateSidecarHideCss();

    // Dev-utils rename/delete integration removed due to conflicts; using manual handlers exclusively
    console.warn('Sidecar Plugin: using manual rename/delete handlers only.');

    this.registerDirectEventHandlers();
    this.registerEvent(this.app.vault.on('create', (file) => handleFileCreate(this, file)));

    this.addCommand({
      id: 'revalidate-sidecars',
      name: 'Revalidate all sidecars',
      callback: () => {
        this.revalidateSidecars();
      },
    });

    new Notice('Sidecar Plugin loaded.');
  }

  updateSidecarHideCss() {
    const id = 'sidecar-visibility-style';
    let styleElement = document.getElementById(id) as HTMLStyleElement | null;

    let styleTextContent = '';

    if (this.settings.hideSidecarsInExplorer) {
      styleTextContent += `
        .nav-file-title[data-path$='${this.settings.sidecarSuffix}'] {
          display: none !important;
        }
      `;
    } else if (this.settings.dimSidecarsInExplorer) {
      styleTextContent += `
        .nav-file-title[data-path$='${this.settings.sidecarSuffix}'] {
          color: var(--text-faint) !important;
        }
        .nav-file-title[data-path$='${this.settings.sidecarSuffix}']:hover,
        .nav-file-title[data-path$='${this.settings.sidecarSuffix}'].is-active {
          color: var(--text-muted) !important;
        }
      `;
    }

    if (this.settings.prependSidecarIndicator) {
      styleTextContent += `
        .nav-file-title[data-path$='${this.settings.sidecarSuffix}']::before {
          content: "⮡";
          padding-left: 0.2em;
          padding-right: 0.75em;
        }
        .nav-file-title[data-path$='${this.settings.sidecarSuffix}'] .tree-item-inner {
          vertical-align: text-top;
        }
        .nav-file-title[data-path$='${this.settings.sidecarSuffix}'] {
          padding-top: 0px !important;
          padding-bottom: calc(2 * var(--size-4-1)) !important;
        }
      `;
    }

    if (styleTextContent) {
      if (!styleElement) {
        styleElement = document.createElement('style');
        styleElement.id = id;
        document.head.appendChild(styleElement);
      }
      styleElement.textContent = styleTextContent;
    } else {
      if (styleElement) {
        styleElement.remove();
      }
    }
  }

  private registerDirectEventHandlers() {
    this.registerEvent(this.app.vault.on('delete', (file) => handleFileDelete(this, file)));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => handleFileRename(this, file, oldPath)));
  }

  onunload() {
    new Notice('Sidecar Plugin unloaded.');
  }

  async loadSettings() {
    // Load user settings, using defaults only for unspecified properties
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.updateSidecarHideCss();
  }

  async revalidateSidecars() {
    new Notice('Starting sidecar revalidation...', 5000); // Show notice for 5 seconds
    let createdCount = 0;
    let deletedOrphanCount = 0;
    let deletedNonMonitoredSourceCount = 0;

    const allFiles = this.app.vault.getFiles();
    const allFilePaths = new Set(allFiles.map(f => f.path));

    // Phase 1: Ensure monitored files have sidecars
    console.log('Sidecar Plugin: Revalidation Phase 1 - Creating missing sidecars.');
    for (const file of allFiles) {
      if (this.isMonitoredFile(file.path)) { // isMonitoredFile checks if it's not a sidecar itself and is allowed
        const sidecarPath = this.getSidecarPath(file.path);
        if (!allFilePaths.has(sidecarPath)) {
          try {
            await this.app.vault.create(sidecarPath, `%% Sidecar for ${file.name} %%\n\n`);
            createdCount++;
            allFilePaths.add(sidecarPath); // Add to set to reflect its creation
            console.log(`Sidecar Plugin: Created sidecar ${sidecarPath} for ${file.path}`);
          } catch (error) {
            console.error(`Sidecar Plugin: Error creating sidecar for ${file.path} during revalidation: `, error);
          }
        }
      }
    }

    // Phase 2: Clean up orphan or invalid sidecars
    // We need a fresh list of files in case sidecars were created that might also be (incorrectly) main files for others
    // or if some files were deleted by other processes during phase 1 (unlikely but good to be safe).
    console.log('Sidecar Plugin: Revalidation Phase 2 - Deleting invalid or orphaned sidecars.');
    const currentFilesAfterCreation = this.app.vault.getFiles(); 

    for (const file of currentFilesAfterCreation) {
      if (this.isSidecarFile(file.path)) {
        const sourcePath = this.getSourcePathFromSidecar(file.path);
        let shouldDelete = false;
        let reason = "";

        if (!sourcePath) {
          shouldDelete = true;
          reason = "malformed name or unidentifiable source";
        } else {
          const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
          if (!sourceFile) {
            shouldDelete = true;
            reason = "orphaned (source file missing)";
          } else if (!(sourceFile instanceof TFile)) {
            shouldDelete = true;
            reason = "source is a folder, not a file";
          } else {
            // Source file exists and is a TFile, check if it's (still) monitored
            if (!this.isMonitoredFile(sourcePath)) {
              shouldDelete = true;
              reason = "source file no longer monitored";
            }
          }
        }

        if (shouldDelete) {
          try {
            // Ensure the file reference is current before deleting
            const sidecarFileToDelete = this.app.vault.getAbstractFileByPath(file.path);
            if (sidecarFileToDelete instanceof TFile) {
              await this.app.vault.delete(sidecarFileToDelete);
              console.log(`Sidecar Plugin: Deleted sidecar ${file.path} (Reason: ${reason})`);
              if (reason === "orphaned (source file missing)" || reason === "malformed name or unidentifiable source" || reason === "source is a folder, not a file") {
                deletedOrphanCount++;
              } else {
                deletedNonMonitoredSourceCount++;
              }
            }
          } catch (error) {
            console.error(`Sidecar Plugin: Error deleting sidecar ${file.path} (Reason: ${reason}) during revalidation: `, error);
          }
        }
      }
    }
    new Notice(`Sidecar revalidation complete.\nCreated: ${createdCount}\nDeleted (Orphaned/Malformed): ${deletedOrphanCount}\nDeleted (Non-Monitored Source): ${deletedNonMonitoredSourceCount}`, 10000); // Show for 10 seconds
  }

  isMonitoredFile(filePath: string): boolean {
    return isMonitoredFile(filePath, this.settings, this.isSidecarFile.bind(this));
  }

  getSidecarPath(sourcePath: string): string {
    return getSidecarPath(sourcePath, this.settings);
  }

  isSidecarFile(filePath: string): boolean {
    return isSidecarFile(filePath, this.settings);
  }

  getSourcePathFromSidecar(sidecarPath: string): string | null {
    return getSourcePathFromSidecar(sidecarPath, this.settings);
  }

  isFileAllowedByFolderLists(filePath: string): boolean {
    // Use the utility function from utils.ts
    return isFileAllowedByFolderLists(filePath, this.settings);
  }
}
