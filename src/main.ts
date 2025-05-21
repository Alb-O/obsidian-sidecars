import { Notice, Plugin, TFile } from 'obsidian';
import { SidecarSettingTab } from './settings';
import { handleFileCreate, handleFileDelete, handleFileRename } from './events';
import { isMonitoredFile, getSidecarPath, isSidecarFile, getSourcePathFromSidecar } from './utils';
import { DEFAULT_SETTINGS, SidecarPluginSettings } from './settings';
import { updateSidecarFileAppearance, updateSidecarHideCss } from './explorer-style';

export default class SidecarPlugin extends Plugin {
  sidecarAppearanceObserver?: MutationObserver; // Renamed from sidecarDraggableObserver

  settings: SidecarPluginSettings;
  public isInitialRevalidating = false; // Flag to manage initial revalidation state
  public hasFinishedInitialLoad = false; // True after initial vault load

  updateSidecarFileAppearance() {
    updateSidecarFileAppearance(this);
  }

  updateSidecarHideCss() {
    updateSidecarHideCss(this);
  }

  async onload() {
    await this.loadSettings();
    this.isInitialRevalidating = this.settings.revalidateOnStartup;
    this.hasFinishedInitialLoad = false;

    this.addSettingTab(new SidecarSettingTab(this.app, this));

    // Dev-utils rename/delete integration removed due to conflicts; using manual handlers exclusively
    console.warn('Sidecar Plugin: using manual rename/delete handlers only.');

    this.registerDirectEventHandlers();
    this.registerEvent(this.app.vault.on('create', (file) => handleFileCreate(this, file)));

    this.app.workspace.onLayoutReady(async () => {
      // Delay DOM manipulations to give Obsidian's UI more time to fully render after a full app reload
      setTimeout(() => {
        // console.log("Sidecar Plugin: Attempting to update CSS and file appearance after delay.");
        this.updateSidecarHideCss();
        this.updateSidecarFileAppearance(); 
      }, 50); // 50ms delay, can be adjusted if needed

      if (this.settings.revalidateOnStartup) {
        this.isInitialRevalidating = true;
        try {
          await this.revalidateSidecars();
        } catch (error) {
          console.error(`Sidecar Plugin: Error during initial revalidation:`, error);
        } finally {
          this.isInitialRevalidating = false;
          this.hasFinishedInitialLoad = true;
        }
      } else {
        this.hasFinishedInitialLoad = true;
        // Ensure appearance is updated even if revalidation is off
        // (it's already called above, but good to be explicit if logic changes)
      }
    });
    // Removed updateSidecarHideCss() and updateSidecarFileAppearance() from here

    this.addCommand({
      id: 'revalidate-sidecars',
      name: 'Revalidate all sidecars',
      callback: () => {
        this.revalidateSidecars();
      },
    });

    new Notice('Sidecar Plugin loaded.');
  }

  private registerDirectEventHandlers() {
    this.registerEvent(this.app.vault.on('delete', (file) => handleFileDelete(this, file)));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => handleFileRename(this, file, oldPath)));
  }

  onunload() {
    if (this.sidecarAppearanceObserver) { // Changed from sidecarDraggableObserver
      this.sidecarAppearanceObserver.disconnect();
      this.sidecarAppearanceObserver = undefined;
    }
    new Notice('Sidecar Plugin unloaded.');
  }

  async loadSettings() {
    // Load user settings, using defaults only for unspecified properties
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    // Ensure revalidateOnStartup has a default value if it's missing from saved data (for upgrades)
    if (typeof this.settings.revalidateOnStartup === 'undefined') {
      this.settings.revalidateOnStartup = DEFAULT_SETTINGS.revalidateOnStartup;
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.updateSidecarHideCss();
    this.updateSidecarFileAppearance(); // Added this call to refresh appearance on settings change
  }

  async revalidateSidecars() {
    new Notice(`Starting sidecar revalidation...`, 3000);
    
    let newlyCreatedSidecarCount = 0;
    let countMonitoredFilesWithSidecars = 0;
    let deletedOrphanCount = 0;
    let deletedNonMonitoredSourceCount = 0;

    const allFiles = this.app.vault.getFiles();
    const allFilePaths = new Set(allFiles.map(f => f.path)); // Represents files at the START of revalidation

    // Phase 1: Ensure monitored files have sidecars
    for (const file of allFiles) {
      const isMonitored = this.isMonitoredFile(file.path);
      const sidecarPath = this.getSidecarPath(file.path);
      const initialSidecarExists = allFilePaths.has(sidecarPath);

      if (isMonitored) {
        let sidecarEnsuredThisIteration = initialSidecarExists;

        if (!initialSidecarExists) {
          try {
            const createdFile = await this.app.vault.create(sidecarPath, ''); 
            
            if (createdFile) { // Check if creation was successful
              newlyCreatedSidecarCount++; // Increment only if a new file was actually created
              allFilePaths.add(sidecarPath); // Update our set of known files
              sidecarEnsuredThisIteration = true;
            } else {
              console.warn(`Sidecar Plugin: vault.create for ${sidecarPath} returned null/undefined. Sidecar might not have been created.`);
            }
          } catch (error) {
            console.error(`Sidecar Plugin: Error creating sidecar for ${file.path} at ${sidecarPath} during revalidation: `, error);
          }
        }
        if (sidecarEnsuredThisIteration) {
          countMonitoredFilesWithSidecars++;
        }
      }
    }

    // Phase 2: Clean up orphan or invalid sidecars
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
              if (reason) {
                console.log(`Sidecar Plugin: Deleted sidecar ${file.path} during revalidation - ${reason}.`);
              } else {
                console.log(`Sidecar Plugin: Deleted sidecar ${file.path} during revalidation.`);
              }
              deletedOrphanCount++;
            } else {
              console.warn(`Sidecar Plugin: Unable to delete ${file.path} - not a valid file reference.`);
            }
          } catch (error) {
            console.error(`Sidecar Plugin: Error deleting sidecar ${file.path} during revalidation: `, error);
          }
        }
      }
    }

    // Final log summary
    console.log(`Sidecar Plugin: Revalidation complete. Newly created sidecars: ${newlyCreatedSidecarCount}, Monitored files with sidecars: ${countMonitoredFilesWithSidecars}, Deleted orphans: ${deletedOrphanCount}, Deleted non-monitored sources: ${deletedNonMonitoredSourceCount}`);

    new Notice(`Sidecar revalidation complete: ${newlyCreatedSidecarCount} created, ${countMonitoredFilesWithSidecars} monitored, ${deletedOrphanCount} orphans deleted.`);
  }

  isMonitoredFile(filePath: string): boolean {
    return isMonitoredFile(filePath, this.settings, (fp) => this.isSidecarFile(fp));
  }

  getSidecarPath(filePath: string): string {
    return getSidecarPath(filePath, this.settings);
  }

  isSidecarFile(filePath: string): boolean {
    return isSidecarFile(filePath, this.settings);
  }

  getSourcePathFromSidecar(sidecarPath: string): string | null {
    return getSourcePathFromSidecar(sidecarPath, this.settings);
  }
}
