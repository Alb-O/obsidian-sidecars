import { PluginSettingTab, App, Setting, Notice } from 'obsidian';
import type SidecarPlugin from './main';
import { MultipleTextComponent } from 'obsidian-dev-utils/obsidian/Components/SettingComponents/MultipleTextComponent';

export interface SidecarPluginSettings {
  monitoredExtensions: string[];
  sidecarSuffix: string;
  blacklistFolders?: string[];
  whitelistFolders?: string[];
  hideSidecarsInExplorer?: boolean;
  useRegexForFolderLists?: boolean;
  dimSidecarsInExplorer?: boolean;
  prependSidecarIndicator?: boolean;
  revalidateOnStartup: boolean; // Changed to non-optional
}

export const DEFAULT_SETTINGS: SidecarPluginSettings = {
  monitoredExtensions: [], // No monitored extensions by default
  sidecarSuffix: '.side.md',
  blacklistFolders: [],
  whitelistFolders: [],
  hideSidecarsInExplorer: false,
  useRegexForFolderLists: false,
  dimSidecarsInExplorer: false,
  prependSidecarIndicator: false,
  revalidateOnStartup: true,
};

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
            .setName('Sidecar file suffix')
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
            .setName('Revalidate sidecars on startup')
            .setDesc('Automatically re-scan all files and manage sidecars when Obsidian starts or the plugin is loaded.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.revalidateOnStartup) // Removed nullish coalescing as it's no longer optional
                .onChange(async (value) => {
                    this.plugin.settings.revalidateOnStartup = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Revalidate sidecars')
            .setDesc('Manually re-scan all files to create missing sidecars and remove orphaned or invalid ones. This can be useful after bulk file operations or if you suspect inconsistencies.')
            .addButton(button => button
                .setButtonText('Revalidate Now')
                .setCta()
                .onClick(() => {
                    new Notice('Starting sidecar revalidation...');
                    this.plugin.revalidateSidecars();
                }));

        new Setting(containerEl).setName('File types').setHeading()

        new Setting(containerEl)
            .setName('Manage image files')
            .setDesc('Include images in the list of file types to be monitored and managed:')
            .then(setting => {
                const desc = setting.descEl;
                const ex = document.createElement('div');
                ex.style.marginTop = '0.25em';
                ['avif','bmp','gif','jpeg','jpg','png','svg','webp'].forEach((ext, i, arr) => {
                    const code = document.createElement('code');
                    code.textContent = ext;
                    ex.appendChild(code);
                    if (i < arr.length - 1) ex.appendChild(document.createTextNode(', '));
                });
                desc.appendChild(ex);
                setting.addToggle(toggle => toggle
                    .setValue(false)
                    .onChange(async (value) => {
                        if (value) {
                            const imageExts = ['avif','bmp','gif','jpeg','jpg','png','svg','webp'];
                            const current = new Set(this.plugin.settings.monitoredExtensions.map(e => e.toLowerCase()));
                            let changed = false;
                            for (const ext of imageExts) {
                                if (!current.has(ext)) {
                                    this.plugin.settings.monitoredExtensions.push(ext);
                                    changed = true;
                                }
                            }
                            if (changed) await this.plugin.saveSettings();
                        }
                    })
                );
            });

        new Setting(containerEl)
            .setName('Manage video files')
            .setDesc('Include videos in the list of file types to be monitored and managed:')
            .then(setting => {
                const desc = setting.descEl;
                const ex = document.createElement('div');
                ex.style.marginTop = '0.25em';
                ['mkv','mov','mp4','ogv','webm'].forEach((ext, i, arr) => {
                    const code = document.createElement('code');
                    code.textContent = ext;
                    ex.appendChild(code);
                    if (i < arr.length - 1) ex.appendChild(document.createTextNode(', '));
                });
                desc.appendChild(ex);
                setting.addToggle(toggle => toggle
                    .setValue(false)
                    .onChange(async (value) => {
                        if (value) {
                            const videoExts = ['mkv','mov','mp4','ogv','webm'];
                            const current = new Set(this.plugin.settings.monitoredExtensions.map(e => e.toLowerCase()));
                            let changed = false;
                            for (const ext of videoExts) {
                                if (!current.has(ext)) {
                                    this.plugin.settings.monitoredExtensions.push(ext);
                                    changed = true;
                                }
                            }
                            if (changed) await this.plugin.saveSettings();
                        }
                    })
                );
            });

        new Setting(containerEl)
            .setName('Manage audio files')
            .setDesc('Include audio files in the list of file types to be monitored and managed:')
            .then(setting => {
                const desc = setting.descEl;
                const ex = document.createElement('div');
                ex.style.marginTop = '0.25em';
                ['flac','m4a','mp3','ogg','wav','webm','3gp'].forEach((ext, i, arr) => {
                    const code = document.createElement('code');
                    code.textContent = ext;
                    ex.appendChild(code);
                    if (i < arr.length - 1) ex.appendChild(document.createTextNode(', '));
                });
                desc.appendChild(ex);
                setting.addToggle(toggle => toggle
                    .setValue(false)
                    .onChange(async (value) => {
                        if (value) {
                            const audioExts = ['flac','m4a','mp3','ogg','wav','webm','3gp'];
                            const current = new Set(this.plugin.settings.monitoredExtensions.map(e => e.toLowerCase()));
                            let changed = false;
                            for (const ext of audioExts) {
                                if (!current.has(ext)) {
                                    this.plugin.settings.monitoredExtensions.push(ext);
                                    changed = true;
                                }
                            }
                            if (changed) await this.plugin.saveSettings();
                        }
                    })
                );
            });

        new Setting(containerEl)
            .setName('Extra file types')
            .setDesc('List extra file types to manage (one per line).')
            .then(setting => {
                const box = new MultipleTextComponent((setting as any).controlEl as HTMLElement);
                box
                    .setPlaceholder('pdf\ncanvas')
                    .setValue(this.plugin.settings.monitoredExtensions)
                    .onChange(async (value) => {
                        this.plugin.settings.monitoredExtensions = value
                            .filter(item => item.trim().length > 0)
                            .map(ext => ext.trim().replace(/^\./, '').toLowerCase());
                        await this.plugin.saveSettings();
                    });
            });
        
        new Setting(containerEl).setName('Display').setHeading()

        const hideToggleComponent: Setting = new Setting(containerEl)
            .setName('Hide sidecar files in File Explorer')
            .setDesc("Completely hide sidecar files in Obsidian's File Explorer.")
            .addToggle(toggle => {
                toggle.setValue(this.plugin.settings.hideSidecarsInExplorer ?? false)
                    .onChange(async (value) => {
                        this.plugin.settings.hideSidecarsInExplorer = value;
                        await this.plugin.saveSettings();
                    });
            });

        const dimToggleComponent: Setting = new Setting(containerEl)
            .setName('Dim sidecar files in File Explorer')
            .setDesc('Visually dim sidecar files in the File Explorer.')
            .addToggle(toggle => {
                toggle.setValue(this.plugin.settings.dimSidecarsInExplorer ?? false)
                    .onChange(async (value) => {
                        this.plugin.settings.dimSidecarsInExplorer = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName('Arrow indicators')
            .setDesc((() => {
                const frag = document.createDocumentFragment();
                frag.append('Prepend ');
                frag.appendChild(document.createElement('code')).textContent = '⮡';
                frag.append(' to sidecar file names (visual only) and adjust padding to indicate the sidecar is a child of the main file.');
                return frag;
            })())
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.prependSidecarIndicator ?? false)
                .onChange(async (value) => {
                    this.plugin.settings.prependSidecarIndicator = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Management scope')
            .setHeading()
            .setDesc((() => {
                const fragment = document.createDocumentFragment();
                fragment.createSpan({ text: "Configure which folders are included or excluded from sidecar management. You can use vault-absolute paths (e.g. " });
                fragment.appendChild(document.createElement("code")).textContent = "/Templates/";
                fragment.appendChild(document.createTextNode(") or asterisk ("));
                fragment.appendChild(document.createElement("code")).textContent = "*";
                fragment.appendChild(document.createTextNode(") wildcards. For more advanced control, an option to use full regex syntax is provided at the bottom."));
                return fragment;
            })());

        new Setting(containerEl)
            .setName('Blacklist folders')
            .setDesc('List of folders to exclude from sidecar management. Exclusions take precedence over inclusions when resolving blacklist subfolders inside whitelist folders.')
            .then(setting => {
                const box = new MultipleTextComponent((setting as any).controlEl as HTMLElement);
                box
                    .setPlaceholder('/Archive/*\n/Templates/**')
                    .setValue(this.plugin.settings.blacklistFolders || [])
                    .onChange(async (value) => {
                        this.plugin.settings.blacklistFolders = value.filter(item => item.trim().length > 0);
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName('Whitelist folders')
            .setDesc('List of folders to include for sidecar management. If set to at least one folder, only files in these folders will be managed.')
            .then(setting => {
                const box = new MultipleTextComponent((setting as any).controlEl as HTMLElement);
                box
                    .setPlaceholder('/Media/**')
                    .setValue(this.plugin.settings.whitelistFolders || [])
                    .onChange(async (value) => {
                        this.plugin.settings.whitelistFolders = value.filter(item => item.trim().length > 0);
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName('Use regular expressions for folder lists')
            .setDesc((() => {
                const frag = document.createDocumentFragment();
                frag.append('If enabled, folder patterns are treated as full regular expressions. If disabled, only ');
                frag.appendChild(document.createElement('code')).textContent = '*';
                frag.append(' is supported as a wildcard for any depth (e.g. ');
                frag.appendChild(document.createElement('code')).textContent = '*/Media/*';
                frag.append(' matches any Media folder at any depth).');
                return frag;
            })())
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.useRegexForFolderLists ?? false)
                .onChange(async (value) => {
                    this.plugin.settings.useRegexForFolderLists = value;
                    await this.plugin.saveSettings();
                })
            );

    }
}
