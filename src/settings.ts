import { PluginSettingTab, App, Setting, Notice } from 'obsidian';
import type SidecarPlugin from './main';
import { MultipleTextComponent } from 'obsidian-dev-utils/obsidian/Components/SettingComponents/MultipleTextComponent';

export interface SidecarPluginSettings {
  monitoredExtensions: string[];
  sidecarSuffix: string;
  blacklistFolders?: string[];
  whitelistFolders?: string[];
  hideSidecarsInExplorer?: boolean;
}

export const DEFAULT_SETTINGS: SidecarPluginSettings = {
  monitoredExtensions: [], // No monitored extensions by default
  sidecarSuffix: '.side.md',
  blacklistFolders: [],
  whitelistFolders: [],
  hideSidecarsInExplorer: false,
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

        new Setting(containerEl).setName('File types').setHeading()

        new Setting(containerEl)
            .setName('Manage image files')
            .setDesc('Append supported image file extensions to the list of file types to be monitored and managed:')
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
            .setDesc('Append supported video file extensions to the list of file types to be monitored and managed:')
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
            .setDesc('Append supported audio file extensions to the list of file types to be monitored and managed:')
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

        new Setting(containerEl)
            .setName('Management scope')
            .setHeading()
            .setDesc((() => {
                const fragment = document.createDocumentFragment();
                fragment.createSpan({ text: "Configure which folders are included or excluded from sidecar management. You can use vault-absolute paths (e.g. " });
                fragment.appendChild(document.createElement("code")).textContent = "/Templates/";
                fragment.appendChild(document.createTextNode(") or wildcards."));
                fragment.appendChild(document.createElement("br"));

                const details = document.createElement("details");
                details.style.marginTop = "0.5em";
                const summary = document.createElement("summary");
                summary.textContent = "Click for wildcard pattern examples and explanation";
                details.appendChild(summary);
                details.appendChild(document.createElement("br"));

                // * wildcard
                const codeStar = document.createElement("code");
                codeStar.textContent = "*";
                details.appendChild(codeStar);
                details.appendChild(document.createTextNode(" (one asterisk) matches any sequence of characters except the path separator '/' (not recursive)."));
                const ex1ul = document.createElement("ul");
                const ex1li1 = document.createElement("li");
                ex1li1.appendChild(document.createTextNode("Example: "));
                ex1li1.appendChild(document.createElement("code")).textContent = "*/Templates/*";
                ex1li1.appendChild(document.createTextNode(" manages files directly inside any folder named 'Templates' that is itself directly inside another folder. For example, matches files in "));
                ex1li1.appendChild(document.createElement("code")).textContent = "Folder1/Templates/";
                ex1li1.appendChild(document.createTextNode(" or "));
                ex1li1.appendChild(document.createElement("code")).textContent = "Folder2/Templates/";
                ex1li1.appendChild(document.createTextNode(", but not files in "));
                ex1li1.appendChild(document.createElement("code")).textContent = "Templates/";
                ex1li1.appendChild(document.createTextNode(" or "));
                ex1li1.appendChild(document.createElement("code")).textContent = "Deep/Nested/Templates/";
                ex1li1.appendChild(document.createTextNode(" or their subfolders."));
                ex1ul.appendChild(ex1li1);
                details.appendChild(ex1ul);
                details.appendChild(document.createElement("br"));

                // ** wildcard
                const codeStarStar = document.createElement("code");
                codeStarStar.textContent = "**";
                details.appendChild(codeStarStar);
                details.appendChild(document.createTextNode(" (two asterisks) matches any sequence of characters, including '/' (recursive, matches subfolders)."));
                const ex2ul = document.createElement("ul");
                const ex2li1 = document.createElement("li");
                ex2li1.appendChild(document.createTextNode("Example: "));
                ex2li1.appendChild(document.createElement("code")).textContent = "**/Templates/*";
                ex2li1.appendChild(document.createTextNode(" manages files directly inside any folder named 'Templates', regardless of where that folder is located in the vault hierarchy. Matches files in "));
                ex2li1.appendChild(document.createElement("code")).textContent = "Templates/";
                ex2li1.appendChild(document.createTextNode(", "));
                ex2li1.appendChild(document.createElement("code")).textContent = "Folder/Templates/";
                ex2li1.appendChild(document.createTextNode(", or "));
                ex2li1.appendChild(document.createElement("code")).textContent = "Deep/Nested/Templates/";
                ex2li1.appendChild(document.createTextNode(", but not in their subfolders."));
                ex2ul.appendChild(ex2li1);
                const ex2li2 = document.createElement("li");
                ex2li2.appendChild(document.createTextNode("Example: "));
                ex2li2.appendChild(document.createElement("code")).textContent = "**/Templates/**";
                ex2li2.appendChild(document.createTextNode(" manages files inside any folder named 'Templates' AND all files in all of its subfolders, regardless of where the 'Templates' folder is located in the vault hierarchy. This is fully recursive."));
                ex2ul.appendChild(ex2li2);
                details.appendChild(ex2ul);

                fragment.appendChild(details);
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
    }
}
