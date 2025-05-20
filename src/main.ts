// src/main.ts
import { App, Notice, Plugin, PluginSettingTab, TAbstractFile, TFile } from 'obsidian';
import { registerRenameDeleteHandlers, EmptyAttachmentFolderBehavior, type RenameDeleteHandlerSettings } from 'obsidian-dev-utils/obsidian/RenameDeleteHandler';
import { SidecarSettingTab } from './settings';
import { handleFileCreate, handleFileDelete, handleFileRename } from './sidecar-events';
import { isMonitoredFile, getSidecarPath, isSidecarFile, getSourcePathFromSidecar, isFileAllowedByFolderLists } from './utils';
import type { SidecarPluginSettings } from './types';

const DEFAULT_SETTINGS: SidecarPluginSettings = {
  monitoredExtensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'pdf', 'mp3', 'mp4', 'mov', 'wav', 'webm'],
  sidecarSuffix: '.side.md'
};

export default class SidecarPlugin extends Plugin {
  settings: SidecarPluginSettings;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new SidecarSettingTab(this.app, this));

    // Inject or remove CSS for hiding sidecar files in explorer
    this.updateSidecarHideCss();

    if (registerRenameDeleteHandlers) {
      registerRenameDeleteHandlers(this, () => ({
        isNote: (path: string) => this.isMonitoredFile(path) && !this.isSidecarFile(path),
        isPathIgnored: (path: string) => this.isSidecarFile(path) || !this.isFileAllowedByFolderLists(path),
        shouldHandleRenames: true,
        shouldHandleDeletions: true,
        shouldRenameAttachmentFiles: true,
        shouldDeleteConflictingAttachments: true,
        emptyAttachmentFolderBehavior: EmptyAttachmentFolderBehavior.Keep,
        shouldRenameAttachmentFolder: false,
        getAttachmentPath: (notePath: string) => this.getSidecarPath(notePath),
        isAttachmentOf: (attachmentPath: string, notePath: string) => {
          if (!this.isSidecarFile(attachmentPath)) return false;
          const sourcePath = this.getSourcePathFromSidecar(attachmentPath);
          return sourcePath === notePath;
        },
      } as Partial<RenameDeleteHandlerSettings> & {
        getAttachmentPath: (notePath: string) => string;
        isAttachmentOf: (attachmentPath: string, notePath: string) => boolean;
      }));
    } else {
      console.warn('Sidecar Plugin: rename/delete handler not available; using manual handlers.');
    }

    this.registerDirectEventHandlers();
    this.registerEvent(this.app.vault.on('create', (file) => handleFileCreate(this, file)));
    new Notice('Sidecar Plugin loaded.');
  }

  updateSidecarHideCss() {
    const id = 'sidecar-hide-files-style';
    let style = document.getElementById(id);
    if (this.settings.hideSidecarsInExplorer) {
      if (!style) {
        style = document.createElement('style');
        style.id = id;
        style.textContent = `.nav-file-title[data-path$='${this.settings.sidecarSuffix}'] { display: none !important; }`;
        document.head.appendChild(style);
      }
    } else {
      if (style) style.remove();
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
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.updateSidecarHideCss();
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
