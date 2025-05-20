// src/settings.ts
import { PluginSettingTab, App, Setting, Notice } from 'obsidian';
import type SidecarPlugin from './main';
import { MultipleTextComponent } from 'obsidian-dev-utils/obsidian/Components/SettingComponents/MultipleTextComponent';

export class SidecarSettingTab extends PluginSettingTab {
  plugin: SidecarPlugin;

  constructor(app: App, plugin: SidecarPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Monitored File Extensions')
      .setDesc('Comma-separated list of extensions for which to create sidecar files (e.g., png,jpg,pdf). Reload the plugin or restart Obsidian after changing this.')
      .addText(text => text
        .setPlaceholder('e.g., png,jpg,pdf')
        .setValue(this.plugin.settings.monitoredExtensions.join(','))
        .onChange(async (value) => {
          this.plugin.settings.monitoredExtensions = value.split(',').map(ext => ext.trim().toLowerCase()).filter(ext => ext.length > 0);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Sidecar File Suffix')
      .setDesc('The suffix to use for sidecar files (e.g., .side.md). Reload the plugin or restart Obsidian after changing this.')
      .addText(text => text
        .setPlaceholder('.side.md')
        .setValue(this.plugin.settings.sidecarSuffix)
        .onChange(async (value) => {
          if (value.length > 0 && value.startsWith('.')) {
            this.plugin.settings.sidecarSuffix = value;
            await this.plugin.saveSettings();
          } else {
            new Notice("Sidecar suffix must start with a dot '.' and not be empty.");
            text.setValue(this.plugin.settings.sidecarSuffix);
          }
        }));

    new Setting(containerEl)
      .setName('Blacklist Folders')
      .setDesc('Newline-separated list of folder paths (supports regex, e.g. ^Archive/). Sidecars will NOT be created or managed in these folders.')
      .then(setting => {
        const box = new MultipleTextComponent((setting as any).controlEl as HTMLElement);
        box
          .setPlaceholder('^Archive/\n^Templates/')
          .setValue(this.plugin.settings.blacklistFolders || [])
          .onChange(async (value) => {
            this.plugin.settings.blacklistFolders = value.filter(item => item.trim().length > 0);
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Whitelist Folders')
      .setDesc('Newline-separated list of folder paths (supports regex, e.g. ^Media/). If set, only these folders will be managed.')
      .then(setting => {
        const box = new MultipleTextComponent((setting as any).controlEl as HTMLElement);
        box
          .setPlaceholder('^Media/')
          .setValue(this.plugin.settings.whitelistFolders || [])
          .onChange(async (value) => {
            this.plugin.settings.whitelistFolders = value.filter(item => item.trim().length > 0);
            await this.plugin.saveSettings();
          });
      });

    // Toggle for hiding sidecar files in the file explorer
    new Setting(containerEl)
      .setName('Hide sidecar files in File Explorer')
      .setDesc('Visually hide sidecar files in Obsidian\'s File Explorer.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.hideSidecarsInExplorer ?? false)
        .onChange(async (value) => {
          this.plugin.settings.hideSidecarsInExplorer = value;
          await this.plugin.saveSettings();
          // Dynamically add/remove the CSS
          if (value) {
            document.body.classList.add('sidecar-hide-files');
          } else {
            document.body.classList.remove('sidecar-hide-files');
          }
        })
      );
  }
}
