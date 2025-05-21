import { Notice, Plugin, TFile } from 'obsidian';
import { SidecarSettingTab } from './settings';
import { handleFileCreate, handleFileDelete, handleFileRename } from './sidecar-events';
import { isMonitoredFile, getSidecarPath, isSidecarFile, getSourcePathFromSidecar, isFileAllowedByFolderLists } from './utils';
import { DEFAULT_SETTINGS, SidecarPluginSettings } from './settings';

export default class SidecarPlugin extends Plugin {
  settings: SidecarPluginSettings;
  public isInitialRevalidating = false; // Flag to manage initial revalidation state

  async onload() {
    await this.loadSettings();
    this.isInitialRevalidating = this.settings.revalidateOnStartup;

    this.addSettingTab(new SidecarSettingTab(this.app, this));

    // Inject or remove CSS for hiding sidecar files in explorer
    this.updateSidecarHideCss();

    // Dev-utils rename/delete integration removed due to conflicts; using manual handlers exclusively
    console.warn('Sidecar Plugin: using manual rename/delete handlers only.');

    this.registerDirectEventHandlers();
    this.registerEvent(this.app.vault.on('create', (file) => handleFileCreate(this, file)));

    if (this.settings.revalidateOnStartup) {
      this.app.workspace.onLayoutReady(async () => {
        this.isInitialRevalidating = true; 
        try {
          await this.revalidateSidecars();
        } catch (error) {
          console.error(`Sidecar Plugin: Error during initial revalidation:`, error);
        } finally {
          this.isInitialRevalidating = false;
        }
      });
    }

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
    // Ensure revalidateOnStartup has a default value if it's missing from saved data (for upgrades)
    if (typeof this.settings.revalidateOnStartup === 'undefined') {
      this.settings.revalidateOnStartup = DEFAULT_SETTINGS.revalidateOnStartup;
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.updateSidecarHideCss();
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
    const noticeFragment = document.createDocumentFragment();
    noticeFragment.appendChild(createEl('div', { text: 'Sidecar revalidation complete.'}));

    const statsDiv = noticeFragment.appendChild(createEl('div'));

    const totalDiv = createEl('div');
    totalDiv.appendText('Total monitored: ');
    const boldNum = createEl('span', { cls: 'sidecar-notice-value', text: String(countMonitoredFilesWithSidecars) });
    totalDiv.appendChild(boldNum);
    statsDiv.appendChild(totalDiv);

    if (newlyCreatedSidecarCount > 0) {
      const createdDiv = createEl('div', { cls: 'sidecar-notice-green' });
      createdDiv.appendText('Newly created: ');
      const boldNum = createEl('span', { cls: 'sidecar-notice-value', text: String(newlyCreatedSidecarCount) });
      createdDiv.appendChild(boldNum);
      statsDiv.appendChild(createdDiv);
    }
    if (deletedOrphanCount > 0) {
      const deletedDiv = createEl('div', { cls: 'sidecar-notice-red' });
      deletedDiv.appendText('Deleted (orphaned/malformed): ');
      const boldNum = createEl('span', { cls: 'sidecar-notice-value', text: String(deletedOrphanCount) });
      deletedDiv.appendChild(boldNum);
      statsDiv.appendChild(deletedDiv);
    }
    if (deletedNonMonitoredSourceCount > 0) {
      const deletedDiv = createEl('div', { cls: 'sidecar-notice-red' });
      deletedDiv.appendText('Deleted (non-monitored source): ');
      const boldNum = createEl('span', { cls: 'sidecar-notice-value', text: String(deletedNonMonitoredSourceCount) });
      deletedDiv.appendChild(boldNum);
      statsDiv.appendChild(deletedDiv);
    }
    new Notice(noticeFragment, 10000);
  }

  isMonitoredFile(filePath: string): boolean {
    // Use the imported utility function from utils.ts which includes extension checking
    return isMonitoredFile(filePath, this.settings, (fp) => this.isSidecarFile(fp));
  }

  getSidecarPath(filePath: string): string {
    return filePath + this.settings.sidecarSuffix;
  }

  isSidecarFile(filePath: string): boolean {
    return filePath.endsWith(this.settings.sidecarSuffix);
  }

  getSourcePathFromSidecar(sidecarPath: string): string | null {
    if (!this.isSidecarFile(sidecarPath)) {
      return null;
    }
    return sidecarPath.slice(0, -this.settings.sidecarSuffix.length);
  }
}
