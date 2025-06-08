import { App, Plugin, PluginSettingTab, Setting, Notice } from 'obsidian';
import { debug, info, warn, error } from '@/utils';
import { ConfirmResetModal, ConfirmDeleteAllSidecarsModal } from '@/modals';
import type { PluginWithSettings, SidecarPluginSettings } from '@/types';
import { DEFAULT_SETTINGS } from '@/types';

export class SettingsManager {
	private plugin: PluginWithSettings;
	private settings: SidecarPluginSettings;

	constructor(plugin: PluginWithSettings) {
		this.plugin = plugin;
		this.settings = DEFAULT_SETTINGS;
	}
	async loadSettings(): Promise<void> {
		debug(this, 'Loading plugin settings from data.json');
		const loadedData = await this.plugin.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
		this.plugin.settings = this.settings; // Ensure plugin settings reference is updated
		debug(this, 'Settings loaded successfully', { settingsCount: Object.keys(this.settings).length });
	}

	async saveSettings(): Promise<void> {
		debug(this, 'Saving plugin settings to data.json');
		await this.plugin.saveData(this.settings);
		debug(this, 'Settings saved successfully');
	}

	getSettings(): SidecarPluginSettings {
		return this.settings;
	}
	getSettingTab(): PluginSettingTab {
		return new SidecarPluginSettingTab(this.plugin.app, this.plugin);
	}

	async initialize() {
		debug(this, 'Initializing settings manager - preparing UI components');
		
		debug(this, 'Registering settings tab with Obsidian app');
		this.plugin.addSettingTab(new SidecarPluginSettingTab(this.plugin.app, this.plugin));
		
		debug(this, 'Settings manager fully initialized and ready for user interactions');
	}

	async updateSetting<K extends keyof SidecarPluginSettings>(
		key: K, 
		value: SidecarPluginSettings[K]
	): Promise<void> {
		debug(this, `Updating setting: ${String(key)}`, { oldValue: this.settings[key], newValue: value });
		
		// Validate setting value before applying
		if (key === 'sidecarSuffix' && typeof value === 'string' && value.length > 20) {
			warn(this, 'Sidecar suffix exceeds recommended length', { 
				key: String(key), 
				length: value.length, 
				maxRecommended: 20 
			});
		}
        try {
			this.settings[key] = value;
			this.plugin.settings[key] = value;
			
			debug(this, 'Persisting updated settings and refreshing UI');
			await this.plugin.saveSettings();
			debug(this, 'Setting update completed successfully');
			
			info(this, 'Setting successfully updated', { 
				key: String(key), 
				newValue: typeof value === 'string' && value.length > 50 ? `${value.substring(0, 50)}...` : value 
			});
		} catch (updateError) {
			error(this, 'Failed to update plugin setting', { 
				key: String(key), 
				error: updateError instanceof Error ? updateError.message : String(updateError),
				attemptedValue: value 
			});
			throw updateError;
		}
	}
}

class SidecarPluginSettingTab extends PluginSettingTab {
	plugin: PluginWithSettings;

	constructor(app: App, plugin: PluginWithSettings) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		debug(this, 'Rendering settings tab UI - building comprehensive user interface');
		const { containerEl } = this;

		debug(this, 'Clearing existing settings container content');
		containerEl.empty();

		debug(this, 'Creating sidecar suffix setting');
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
							debug(this, 'User modified sidecar suffix', { newValue: currentValue });
							await this.plugin.settingsManager.updateSetting('sidecarSuffix', currentValue);
							// Update example tags in settings UI
							const exampleTags = this.containerEl.querySelectorAll('.sidecar-tag-example');
							exampleTags.forEach(tag => {
								if (tag instanceof HTMLElement) {
									tag.textContent = this.plugin.settings.sidecarSuffix;
								}
							});
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

		debug(this, 'Creating auto-create sidecars toggle');
		new Setting(containerEl)
			.setName('Automatically create new sidecars')
			.setDesc('If enabled, new sidecars will be created automatically for monitored files. If disabled, only existing sidecars will be managed. To manually create sidecars, use the context menu in the File Explorer.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoCreateSidecars)
				.onChange(async (value) => {
					debug(this, 'User toggled auto-create sidecars', { newValue: value });
					await this.plugin.settingsManager.updateSetting('autoCreateSidecars', value);
				})
			);

		debug(this, 'Creating revalidate on startup toggle');
		new Setting(containerEl)
			.setName('Revalidate sidecars on startup')
			.setDesc('Automatically re-scan all files and manage sidecars when Obsidian starts or the plugin is loaded.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.revalidateOnStartup)
				.onChange(async (value) => {
					debug(this, 'User toggled revalidate on startup', { newValue: value });
					await this.plugin.settingsManager.updateSetting('revalidateOnStartup', value);
				}));

		debug(this, 'Creating manual revalidate button');
		new Setting(containerEl)
			.setName('Revalidate sidecars')
			.setDesc('Manually re-scan all files to create missing sidecars and remove orphaned or invalid ones. This can be useful after bulk file operations or if you suspect inconsistencies.')
			.addButton(button => button
				.setButtonText('Revalidate now')
				.setCta()
				.onClick(() => {
					debug(this, 'User triggered manual revalidation');
					new Notice('Starting sidecar revalidation...');
					this.plugin.revalidateSidecars();
				}));

		debug(this, 'Creating file types section');
		new Setting(containerEl).setName('File types').setHeading()

		debug(this, 'Creating image files toggle');
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
							debug(this, 'User enabled image file management');
							const imageExts = ['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp'];
							const current = new Set(this.plugin.settings.monitoredExtensions.map(e => e.toLowerCase()));
							let changed = false;
							for (const ext of imageExts) {
								if (!current.has(ext)) {
									this.plugin.settings.monitoredExtensions.push(ext);
									changed = true;
								}
							}
							if (changed) await this.plugin.settingsManager.updateSetting('monitoredExtensions', this.plugin.settings.monitoredExtensions);
						}
					})
				);
			});

		debug(this, 'Creating video files toggle');
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
							debug(this, 'User enabled video file management');
							const videoExts = ['mkv', 'mov', 'mp4', 'ogv', 'webm'];
							const current = new Set(this.plugin.settings.monitoredExtensions.map(e => e.toLowerCase()));
							let changed = false;
							for (const ext of videoExts) {
								if (!current.has(ext)) {
									this.plugin.settings.monitoredExtensions.push(ext);
									changed = true;
								}
							}
							if (changed) await this.plugin.settingsManager.updateSetting('monitoredExtensions', this.plugin.settings.monitoredExtensions);
						}
					})
				);
			});

		debug(this, 'Creating audio files toggle');
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
							debug(this, 'User enabled audio file management');
							const audioExts = ['flac', 'm4a', 'mp3', 'ogg', 'wav', 'webm', '3gp'];
							const current = new Set(this.plugin.settings.monitoredExtensions.map(e => e.toLowerCase()));
							let changed = false;
							for (const ext of audioExts) {
								if (!current.has(ext)) {
									this.plugin.settings.monitoredExtensions.push(ext);
									changed = true;
								}
							}
							if (changed) await this.plugin.settingsManager.updateSetting('monitoredExtensions', this.plugin.settings.monitoredExtensions);
						}
					})
				);
			});

		debug(this, 'Creating extra file types setting');
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
					debug(this, 'User modified extra file types');
					const extensions = textarea.value
						.split(/\r?\n/)
						.map(item => item.trim())
						.filter(item => item.length > 0)
						.map(ext => ext.replace(/^\./, '').toLowerCase());
					await this.plugin.settingsManager.updateSetting('monitoredExtensions', extensions);
				});
				// Assign class to parent
				setting.controlEl.classList.add('multiple-text-component');
				setting.controlEl.appendChild(textarea);
			});

		debug(this, 'Creating File Explorer behavior section');
		new Setting(containerEl).setName('File Explorer behavior').setHeading();

		debug(this, 'Creating prevent dragging toggle');
		new Setting(containerEl)
			.setName('Prevent dragging of sidecar files')
			.setDesc('If enabled, sidecar files cannot be dragged in the File Explorer. This helps prevent accidental moves.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.preventDraggingSidecars)
				.onChange(async (value) => {
					debug(this, 'User toggled prevent dragging sidecars', { newValue: value });
					await this.plugin.settingsManager.updateSetting('preventDraggingSidecars', value);
				}));

		debug(this, 'Creating hide sidecar files toggle');
		new Setting(containerEl)
			.setName('Hide sidecar files')
			.setDesc("Completely hide sidecar files in Obsidian's File Explorer.")
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.hideSidecarsInExplorer)
					.onChange(async (value) => {
						debug(this, 'User toggled hide sidecars in explorer', { newValue: value });
						await this.plugin.settingsManager.updateSetting('hideSidecarsInExplorer', value);
					});
			});

		debug(this, 'Creating management scope section');
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

		debug(this, 'Creating blacklist folders setting');
		new Setting(containerEl)
			.setName('Blacklist folders')
			.setDesc('List of folders to exclude from sidecar management. Exclusions take precedence over inclusions when resolving blacklist subfolders inside whitelist folders.')
			.then(setting => {
				setting.controlEl.empty();
				const textarea = document.createElement('textarea');
				textarea.placeholder = '/Templates/\n*/archive/*';
				textarea.value = (this.plugin.settings.blacklistFolders || []).join('\n');
				textarea.addEventListener('change', async () => {
					debug(this, 'User modified blacklist folders');
					const folders = textarea.value
						.split(/\r?\n/)
						.map(item => item.trim())
						.filter(item => item.length > 0);
					await this.plugin.settingsManager.updateSetting('blacklistFolders', folders);
				});
				setting.controlEl.classList.add('multiple-text-component');
				setting.controlEl.appendChild(textarea);
			});

		debug(this, 'Creating whitelist folders setting');
		new Setting(containerEl)
			.setName('Whitelist folders')
			.setDesc('List of folders to include for sidecar management. If set to at least one folder, only files in these folders will be managed.')
			.then(setting => {
				setting.controlEl.empty();
				const textarea = document.createElement('textarea');
				textarea.placeholder = '*/attachments/*';
				textarea.value = (this.plugin.settings.whitelistFolders || []).join('\n');
				textarea.addEventListener('change', async () => {
					debug(this, 'User modified whitelist folders');
					const folders = textarea.value
						.split(/\r?\n/)
						.map(item => item.trim())
						.filter(item => item.length > 0);
					await this.plugin.settingsManager.updateSetting('whitelistFolders', folders);
				});
				setting.controlEl.classList.add('multiple-text-component');
				setting.controlEl.appendChild(textarea);
			});

		debug(this, 'Creating use regex toggle');
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
					debug(this, 'User toggled regex folder patterns', { newValue: value });
					await this.plugin.settingsManager.updateSetting('useRegexForFolderLists', value);
				})
			);

		debug(this, 'Creating File Explorer styles section');
		new Setting(containerEl).setName('File Explorer styles').setHeading();

		debug(this, 'Creating dim sidecar files toggle');
		new Setting(containerEl)
			.setName('Dim sidecar files')
			.setDesc('Visually dim sidecar files in the File Explorer.')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.dimSidecarsInExplorer)
					.onChange(async (value) => {
						debug(this, 'User toggled dim sidecars in explorer', { newValue: value });
						await this.plugin.settingsManager.updateSetting('dimSidecarsInExplorer', value);
					});
			});

		debug(this, 'Creating arrow indicators toggle');
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
					debug(this, 'User toggled arrow indicators', { newValue: value });
					await this.plugin.settingsManager.updateSetting('prependSidecarIndicator', value);
				}));

		debug(this, 'Creating colored sidecar extension toggle');
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
					debug(this, 'User toggled colored sidecar extension', { newValue: value });
					await this.plugin.settingsManager.updateSetting('colorSidecarExtension', value);
				}));

		debug(this, 'Creating show .md in sidecar extension toggle');
		new Setting(containerEl)
			.setName('Show .md in sidecar extension')
			.setDesc('Visually append .md to the sidecar extension tag in the File Explorer (e.g. side.md).')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showMdInSidecarTag)
				.onChange(async (value) => {
					debug(this, 'User toggled show .md in sidecar tag', { newValue: value });
					await this.plugin.settingsManager.updateSetting('showMdInSidecarTag', value);
				}));

		debug(this, 'Creating hide main file extension toggle');
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
					debug(this, 'User toggled hide main extension in explorer', { newValue: value });
					await this.plugin.settingsManager.updateSetting('hideMainExtensionInExplorer', value);
				}));

		debug(this, 'Creating hide base name of sidecar files toggle');
		new Setting(containerEl)
			.setName('Hide base name of sidecar files')
			.setDesc('If enabled, only the extension tags or arrow indicators will be visible for sidecar files. The base file name will be hidden (visual only).')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.hideSidecarBaseNameInExplorer ?? false)
					.onChange(async (value) => {
						debug(this, 'User toggled hide sidecar base name in explorer', { newValue: value });
						await this.plugin.settingsManager.updateSetting('hideSidecarBaseNameInExplorer', value);
					});
			});

		debug(this, 'Creating redirect files section');
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

		debug(this, 'Creating redirect file suffix setting');
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
							debug(this, 'User modified redirect file suffix', { newValue: currentValue });
							await this.plugin.settingsManager.updateSetting('redirectFileSuffix', currentValue);
						}
						text.inputEl.removeClass('sidecar-setting-error');
					} else if (currentValue.length > 0) { // Only show error if not empty but invalid
						text.inputEl.addClass('sidecar-setting-error');
						new Notice('Invalid suffix: Cannot be empty, contain periods, spaces, or "md".', 4000);
					} else { // Is empty
						text.inputEl.addClass('sidecar-setting-error');
						new Notice('Suffix cannot be empty.', 3000);
					}
				}; 
				text.inputEl.onblur = validateAndSaveRedirectSuffix; // Save on blur
				text.inputEl.onkeydown = (event) => { // Save on Enter
					if (event.key === 'Enter') {
						event.preventDefault();
						validateAndSaveRedirectSuffix();
					}
				};
			});

		debug(this, 'Creating hide redirect files toggle');
		new Setting(containerEl)
			.setName('Hide redirect files')
			.setDesc('Completely hide redirect files in Obsidian\'s File Explorer.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.hideRedirectFilesInExplorer)
				.onChange(async (value) => {
					debug(this, 'User toggled hide redirect files in explorer', { newValue: value });
					await this.plugin.settingsManager.updateSetting('hideRedirectFilesInExplorer', value);
				}));

		debug(this, 'Creating show redirect file decorator toggle');
		new Setting(containerEl)
			.setName('Show redirect file decorator')
			.setDesc('Show a decorator icon at the beginning of file names when a redirect file exists for that file.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showRedirectDecorator)
				.onChange(async (value) => {
					debug(this, 'User toggled show redirect decorator', { newValue: value });
					await this.plugin.settingsManager.updateSetting('showRedirectDecorator', value);
				}));

		debug(this, 'Creating show redirect decorator on sidecars toggle');
		new Setting(containerEl)
			.setName('Show redirect decorator on sidecars')
			.setDesc('Also show the redirect decorator on sidecar files themselves when their main file has a redirect file.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showRedirectDecoratorOnSidecars)
				.onChange(async (value) => {
					debug(this, 'User toggled show redirect decorator on sidecars', { newValue: value });
					await this.plugin.settingsManager.updateSetting('showRedirectDecoratorOnSidecars', value);
				}));

		debug(this, 'Creating danger zone section');
		new Setting(containerEl).setName("Danger zone").setHeading();

		debug(this, 'Creating reset settings button');
		new Setting(containerEl)
			.setName('Reset all settings')
			.setDesc('Restore all Sidecar settings to their default values. This cannot be undone.')
			.addButton((button) => {
				button.setButtonText('Reset to defaults')
					.onClick(() => {
						debug(this, 'User requested settings reset');
						new ConfirmResetModal(this.app, async () => {
							debug(this, 'Resetting all settings to defaults');
							Object.assign(this.plugin.settings, DEFAULT_SETTINGS);
							await this.plugin.saveSettings();
							new Notice('Sidecar settings reset to defaults.');
							this.display();
							info(this, 'All settings reset to default values');
						}).open();
					});
				button.buttonEl.classList.add('sidecar-reset-destructive-text');
			});

		debug(this, 'Creating delete all sidecars button');
		new Setting(containerEl)
			.setName('Delete all sidecar files')
			.setDesc('Delete all sidecar files in this vault. This cannot be undone and will remove all sidecar files managed by this plugin.')
			.addButton((button) => {
				button.setButtonText('Delete all sidecars')
					.onClick(() => {
						debug(this, 'User requested deletion of all sidecars');
						new ConfirmDeleteAllSidecarsModal(this.app, async () => {
							debug(this, 'User confirmed deletion of all sidecars');
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
							info(this, `Deleted ${deleted.length} sidecar files`);
						}).open();
					});
				button.buttonEl.classList.add('sidecar-reset-destructive-text');
			});

		debug(this, 'Settings tab UI rendering completed - comprehensive interface ready');
	}
}
