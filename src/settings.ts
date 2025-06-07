import { PluginSettingTab, App, Setting, Notice } from 'obsidian';
import { ConfirmResetModal } from './modals/ConfirmResetModal';
import { ConfirmDeleteAllSidecarsModal } from './modals/ConfirmDeleteAllSidecarsModal';
import type SidecarPlugin from './main';

export interface SidecarPluginSettings {
	monitoredExtensions: string[];
	sidecarSuffix: string;
	blacklistFolders: string[];
	whitelistFolders: string[];
	hideSidecarsInExplorer: boolean;
	useRegexForFolderLists: boolean;
	dimSidecarsInExplorer: boolean;
	prependSidecarIndicator: boolean;
	revalidateOnStartup: boolean;
	preventDraggingSidecars: boolean;
	colorSidecarExtension: boolean;
	hideMainExtensionInExplorer: boolean;
	showMdInSidecarTag: boolean;
	redirectFileSuffix: string;
	hideRedirectFilesInExplorer: boolean;
	showRedirectDecorator: boolean;
	showRedirectDecoratorOnSidecars: boolean;
	autoCreateSidecars: boolean;
	prependPeriodToExtTags: boolean;
	hideSidecarBaseNameInExplorer?: boolean;

}

export const DEFAULT_SETTINGS: SidecarPluginSettings = {
	monitoredExtensions: [],
	sidecarSuffix: 'side',
	blacklistFolders: [],
	whitelistFolders: [],
	hideSidecarsInExplorer: false,
	useRegexForFolderLists: false,
	dimSidecarsInExplorer: true,
	prependSidecarIndicator: false,
	revalidateOnStartup: true,
	preventDraggingSidecars: true,
	colorSidecarExtension: true,
	hideMainExtensionInExplorer: false,
	showMdInSidecarTag: false,	redirectFileSuffix: 'redirect',
	hideRedirectFilesInExplorer: true,
	showRedirectDecorator: true,
	showRedirectDecoratorOnSidecars: false,
	autoCreateSidecars: true,
	prependPeriodToExtTags: false,
	hideSidecarBaseNameInExplorer: false,
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
			.setDesc('The suffix to use for sidecar files. Don\'t include periods or the .md extension.')
			.addText(text => {
				text.setPlaceholder('side')
					.setValue(this.plugin.settings.sidecarSuffix);

				const handleValidation = async () => {
					const currentValue = text.inputEl.value;
					if (currentValue.length > 0 && !currentValue.includes('.') && !currentValue.toLowerCase().includes('md')) {
						// Only save if the value has actually changed from the last saved valid state
						if (this.plugin.settings.sidecarSuffix !== currentValue) {
							this.plugin.settings.sidecarSuffix = currentValue;
							await this.plugin.saveSettings();
							// Update example tags in settings UI
							const exampleTags = this.containerEl.querySelectorAll('.sidecar-tag-example');
							exampleTags.forEach(tag => {
								if (tag instanceof HTMLElement) {
									tag.textContent = this.plugin.settings.sidecarSuffix;
								}
							});
							// Refresh explorer styles through saveSettings (no redundant calls)
						}
					} else {
						new Notice("Sidecar suffix must not be empty and cannot contain periods or 'md'.");
						// Revert the input field to the last saved (and valid) value
						text.setValue(this.plugin.settings.sidecarSuffix);
					}
				};

				text.inputEl.addEventListener('blur', async () => {
					await handleValidation();
				});

				text.inputEl.addEventListener('keydown', async (event: KeyboardEvent) => {
					if (event.key === 'Enter') {
						event.preventDefault(); // Prevent default Enter behavior (e.g., form submission)
						await handleValidation();
					}
				});
			});

		new Setting(containerEl)
			.setName('Automatically create new sidecars')
			.setDesc('If enabled, new sidecars will be created automatically for monitored files. If disabled, only existing sidecars will be managed. To manually create sidecars, use the context menu in the File Explorer.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoCreateSidecars)
				.onChange(async (value) => {
					this.plugin.settings.autoCreateSidecars = value;
					await this.plugin.saveSettings();
				})
			);

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
				.setButtonText('Revalidate now')
				.setCta()
				.onClick(() => {
					new Notice('Starting sidecar revalidation...');
					this.plugin.revalidateSidecars();
				}));

		new Setting(containerEl).setName('File types').setHeading()

		new Setting(containerEl)
			.setName('Manage image files')
			.setDesc('Create and manage sidecars for image formats supported by Obsidian:')
			.then(setting => {
				const desc = setting.descEl;
			   const ex = document.createElement('div');
			   ex.classList.add('sidecar-margin-top');
				['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp'].forEach((ext, i, arr) => {
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
							const imageExts = ['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp'];
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
			.setDesc('Create and manage sidecars for video formats supported by Obsidian:')
			.then(setting => {
				const desc = setting.descEl;
			   const ex = document.createElement('div');
			   ex.classList.add('sidecar-margin-top');
				['mkv', 'mov', 'mp4', 'ogv', 'webm'].forEach((ext, i, arr) => {
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
							const videoExts = ['mkv', 'mov', 'mp4', 'ogv', 'webm'];
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
			.setDesc('Create and manage sidecars for audio formats supported by Obsidian:')
			.then(setting => {
				const desc = setting.descEl;
			   const ex = document.createElement('div');
			   ex.classList.add('sidecar-margin-top');
				['flac', 'm4a', 'mp3', 'ogg', 'wav', 'webm', '3gp'].forEach((ext, i, arr) => {
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
							const audioExts = ['flac', 'm4a', 'mp3', 'ogg', 'wav', 'webm', '3gp'];
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
				// Remove any existing content
				setting.controlEl.empty();
				// Create textarea
				const textarea = document.createElement('textarea');
				textarea.placeholder = 'pdf\ncanvas';
				textarea.value = this.plugin.settings.monitoredExtensions.join('\n');
				textarea.addEventListener('change', async () => {
					this.plugin.settings.monitoredExtensions = textarea.value
						.split(/\r?\n/)
						.map(item => item.trim())
						.filter(item => item.length > 0)
						.map(ext => ext.replace(/^\./, '').toLowerCase());
					await this.plugin.saveSettings();
				});
				// Assign class to parent
				setting.controlEl.classList.add('multiple-text-component');
				setting.controlEl.appendChild(textarea);
			});

		new Setting(containerEl).setName('File Explorer behavior').setHeading();

		// Prevent dragging (OUTSIDE details)
		new Setting(containerEl)
			.setName('Prevent dragging of sidecar files')
			.setDesc('If enabled, sidecar files cannot be dragged in the File Explorer. This helps prevent accidental moves.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.preventDraggingSidecars)
				.onChange(async (value) => {
					this.plugin.settings.preventDraggingSidecars = value;
					await this.plugin.saveSettings();
					if (this.plugin.updateSidecarFileAppearance) {
						this.plugin.updateSidecarFileAppearance();
					}
				}));

		// Hide sidecar files (OUTSIDE details)
		new Setting(containerEl)
			.setName('Hide sidecar files')
			.setDesc("Completely hide sidecar files in Obsidian's File Explorer.")
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.hideSidecarsInExplorer)
					.onChange(async (value) => {
						this.plugin.settings.hideSidecarsInExplorer = value;
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
				fragment.appendChild(document.createTextNode(") or asterisk ("));
				fragment.appendChild(document.createElement("code")).textContent = "*";
				fragment.appendChild(document.createTextNode(") wildcards. For more advanced control, an option to use full regex syntax is provided at the bottom."));
				return fragment;
			})());

		new Setting(containerEl)
			.setName('Blacklist folders')
			.setDesc('List of folders to exclude from sidecar management. Exclusions take precedence over inclusions when resolving blacklist subfolders inside whitelist folders.')
			.then(setting => {
				setting.controlEl.empty();
				const textarea = document.createElement('textarea');
				textarea.placeholder = '/Templates/\n*/archive/*';
				textarea.value = (this.plugin.settings.blacklistFolders || []).join('\n');
				textarea.addEventListener('change', async () => {
					this.plugin.settings.blacklistFolders = textarea.value
						.split(/\r?\n/)
						.map(item => item.trim())
						.filter(item => item.length > 0);
					await this.plugin.saveSettings();
				});
				setting.controlEl.classList.add('multiple-text-component');
				setting.controlEl.appendChild(textarea);
			});

		new Setting(containerEl)
			.setName('Whitelist folders')
			.setDesc('List of folders to include for sidecar management. If set to at least one folder, only files in these folders will be managed.')
			.then(setting => {
				setting.controlEl.empty();
				const textarea = document.createElement('textarea');
				textarea.placeholder = '*/attachments/*';
				textarea.value = (this.plugin.settings.whitelistFolders || []).join('\n');
				textarea.addEventListener('change', async () => {
					this.plugin.settings.whitelistFolders = textarea.value
						.split(/\r?\n/)
						.map(item => item.trim())
						.filter(item => item.length > 0);
					await this.plugin.saveSettings();
				});
				setting.controlEl.classList.add('multiple-text-component');
				setting.controlEl.appendChild(textarea);
			});

		new Setting(containerEl)
			.setName('Use regular expressions for folder lists')
			.setDesc((() => {
				const frag = document.createDocumentFragment();
				frag.append('If enabled, folder patterns are treated as full regular expressions (e.g. ');
				frag.appendChild(document.createElement('code')).textContent = '.';
				frag.append(' and ');
				frag.appendChild(document.createElement('code')).textContent = '^';
				frag.append(' are supported). If disabled, only ');
				frag.appendChild(document.createElement('code')).textContent = '*';
				frag.append(' is supported as a wildcard for any depth (e.g. ');
				frag.appendChild(document.createElement('code')).textContent = '*/Media/*';
				frag.append(' matches any Media folder at any depth).');
				return frag;
			})())
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.useRegexForFolderLists)
				.onChange(async (value) => {
					this.plugin.settings.useRegexForFolderLists = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl).setName('File Explorer styles').setHeading();

		// Dim sidecar files (INSIDE details)
		new Setting(containerEl)
			.setName('Dim sidecar files')
			.setDesc('Visually dim sidecar files in the File Explorer.')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.dimSidecarsInExplorer)
					.onChange(async (value) => {
						this.plugin.settings.dimSidecarsInExplorer = value;
						await this.plugin.saveSettings();
					});
			});

		// Arrow indicators
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
				.setValue(this.plugin.settings.prependSidecarIndicator)
				.onChange(async (value) => {
					this.plugin.settings.prependSidecarIndicator = value;
					await this.plugin.saveSettings();
				}));

		// Colored sidecar extension
		new Setting(containerEl)
			.setName('Colored sidecar extension')
			.setDesc((() => {
				const frag = document.createDocumentFragment();
				frag.append('Toggle coloring of the sidecar extension (e.g. ');
				const codeTag = document.createElement('span');
				codeTag.className = 'nav-file-tag sidecar-tag sidecar-tag-example';
				codeTag.textContent = this.plugin.settings.sidecarSuffix;
				frag.appendChild(codeTag);
				frag.append(') in the File Explorer.');
				return frag;
			})())
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.colorSidecarExtension)
				.onChange(async (value) => {
					this.plugin.settings.colorSidecarExtension = value;
					await this.plugin.saveSettings();
				}));

		// Show .md in sidecar extension
		new Setting(containerEl)
			.setName('Show .md in sidecar extension')
			.setDesc('Visually append .md to the sidecar extension tag in the File Explorer (e.g. side.md).')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showMdInSidecarTag).onChange(async (value) => {
					this.plugin.settings.showMdInSidecarTag = value;
					await this.plugin.saveSettings(); // saveSettings will refresh styles automatically
				}));

		// Hide main file extension
		new Setting(containerEl)
			.setName('Hide main file extension')
			.setDesc((() => {
				const frag = document.createDocumentFragment();
				frag.append('Hide the main file extension from sidecar items in the File Explorer, leaving only the ');
				const codeTag = document.createElement('span');
				codeTag.className = 'nav-file-tag sidecar-tag sidecar-tag-example no-color';
				codeTag.textContent = this.plugin.settings.sidecarSuffix;
				frag.appendChild(codeTag);
				frag.append(' suffix.');
				return frag;
			})())
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.hideMainExtensionInExplorer)
				.onChange(async (value) => {
					this.plugin.settings.hideMainExtensionInExplorer = value;
					await this.plugin.saveSettings();
				}));

		// Prepend period to all file extension tags
		new Setting(containerEl)
			.setName('Prepend period to extension tags')
			.setDesc('Visually prepend a period to all file extension tags in the File Explorer (e.g. .PNG, .SIDE).')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.prependPeriodToExtTags)
					.onChange(async (value) => {
						this.plugin.settings.prependPeriodToExtTags = value;
						await this.plugin.saveSettings();
					});
			});

		// Hide base name of sidecar files (extension only display)
		new Setting(containerEl)
			.setName('Hide base name of sidecar files')
			.setDesc('If enabled, only the extension tags or arrow indicators will be visible for sidecar files. The base file name will be hidden (visual only).')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.hideSidecarBaseNameInExplorer ?? false)
					.onChange(async (value) => {
						this.plugin.settings.hideSidecarBaseNameInExplorer = value;
						await this.plugin.saveSettings();
						if (this.plugin.updateSidecarFileAppearance) {
							this.plugin.updateSidecarFileAppearance();
						}
					});
			});

		new Setting(containerEl).setName('Redirect files (Blend Vault integration)').setHeading()
			.setDesc((() => {
				const frag = document.createDocumentFragment();
				frag.appendText('Only relevant if you use the ');
				const link = frag.createEl('span', { text: 'Blend Vault', cls: 'external-link' });
				link.onclick = () => {
					window.open('https://github.com/AMC-Albert/blend-vault', '_blank');
				};
				frag.appendText(' addon for Blender, or other tools that care about redirect files.');
				return frag;
			})());

		new Setting(containerEl)
			.setName('Redirect file suffix')
			.setDesc('The suffix for redirect files. Don\'t include periods or the .md extension.')
			.addText(text => {
				text.setPlaceholder('redirect')
					.setValue(this.plugin.settings.redirectFileSuffix);

				const validateAndSaveRedirectSuffix = async () => {
					const currentValue = text.inputEl.value.trim();
					if (currentValue.length > 0 && !currentValue.includes('.') && !currentValue.toLowerCase().includes('md') && !currentValue.includes(' ')) {
						if (this.plugin.settings.redirectFileSuffix !== currentValue) {
							this.plugin.settings.redirectFileSuffix = currentValue;
							await this.plugin.saveSettings();
						}
						text.inputEl.removeClass('sidecar-setting-error');
					} else if (currentValue.length > 0) { // Only show error if not empty but invalid
						text.inputEl.addClass('sidecar-setting-error');
						new Notice('Invalid suffix: Cannot be empty, contain periods, spaces, or "md".', 4000);
					} else { // Is empty
						text.inputEl.addClass('sidecar-setting-error');
						new Notice('Suffix cannot be empty.', 3000);
					}
				}; text.inputEl.onblur = validateAndSaveRedirectSuffix; // Save on blur
				text.inputEl.onkeydown = (event) => { // Save on Enter
					if (event.key === 'Enter') {
						event.preventDefault();
						validateAndSaveRedirectSuffix();
					}
				};
			});
		new Setting(containerEl)
			.setName('Hide redirect files')
			.setDesc('Completely hide redirect files in Obsidian\'s File Explorer.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.hideRedirectFilesInExplorer)
				.onChange(async (value) => {
					this.plugin.settings.hideRedirectFilesInExplorer = value;
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
			.setName('Show redirect file decorator')
			.setDesc('Show a decorator icon at the beginning of file names when a redirect file exists for that file.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showRedirectDecorator)
				.onChange(async (value) => {
					this.plugin.settings.showRedirectDecorator = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Show redirect decorator on sidecars')
			.setDesc('Also show the redirect decorator on sidecar files themselves when their main file has a redirect file.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showRedirectDecoratorOnSidecars)
				.onChange(async (value) => {
					this.plugin.settings.showRedirectDecoratorOnSidecars = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl).setName("Danger zone").setHeading();

		new Setting(containerEl)
			.setName('Reset all settings')
			.setDesc('Restore all Sidecar settings to their default values. This cannot be undone.')
			.addButton((button) => {
				button.setButtonText('Reset to defaults')
					.onClick(() => {
						new ConfirmResetModal(this.app, async () => {
							Object.assign(this.plugin.settings, DEFAULT_SETTINGS);
							await this.plugin.saveSettings();
							new Notice('Sidecar settings reset to defaults.');
							this.display();
						}).open();
					});
				button.buttonEl.classList.add('sidecar-reset-destructive-text');
			});

		new Setting(containerEl)
			.setName('Delete all sidecar files')
			.setDesc('Delete all sidecar files in this vault. This cannot be undone and will remove all sidecar files managed by this plugin.')
			.addButton((button) => {
				button.setButtonText('Delete all sidecars')
					.onClick(() => {
						new ConfirmDeleteAllSidecarsModal(this.app, async () => {
							// Find and delete all sidecar files using plugin logic
							const deleted: string[] = [];
							const files = this.app.vault.getFiles();
							for (const file of files) {
								if (this.plugin.isSidecarFile(file.path)) {
									try {
										await this.app.fileManager.trashFile(file);
										deleted.push(file.path);
									} catch (err) {
										console.error(`Failed to delete sidecar file: ${file.path}`, err);
									}
								}
							}
							new Notice(`Deleted ${deleted.length} sidecar file(s).`);
						}).open();
					});
				button.buttonEl.classList.add('sidecar-reset-destructive-text');
			});
	}
}
