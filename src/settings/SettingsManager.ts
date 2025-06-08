import { App, Plugin, PluginSettingTab, Setting, Notice } from 'obsidian';
import { debug, info, warn, error } from '@/utils';
import { ConfirmResetModal } from '@/modals/ConfirmResetModal';
import { ConfirmDeleteAllSidecarsModal } from '@/modals/ConfirmDeleteAllSidecarsModal';
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
			
			debug(this, 'Persisting updated settings to storage');
			await this.plugin.saveData(this.plugin.settings);
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
		debug(this, 'Rendering settings tab UI - building user interface elements');
		const { containerEl } = this;

		debug(this, 'Clearing existing settings container content');
		containerEl.empty();

		debug(this, 'Creating monitored file extensions setting');
		new Setting(containerEl)
			.setName('Monitored file extensions')
			.setDesc('Extensions to monitor for sidecar creation. Enter comma-separated extensions (e.g., pdf,png,jpg)')
			.addText(text => text
				.setPlaceholder('pdf,png,jpg,docx')
				.setValue(this.plugin.settings.monitoredExtensions.join(','))
				.onChange(async (value) => {
					debug(this, 'User modified monitored extensions', { newValue: value });
					const extensions = value.split(',').map(ext => ext.trim().toLowerCase()).filter(ext => ext);
					await this.plugin.settingsManager.updateSetting('monitoredExtensions', extensions);
				}));

		debug(this, 'Creating sidecar suffix setting');
		new Setting(containerEl)
			.setName('Sidecar file suffix')
			.setDesc('Suffix added to sidecar files before .md extension')
			.addText(text => text
				.setPlaceholder('side')
				.setValue(this.plugin.settings.sidecarSuffix)
				.onChange(async (value) => {
					debug(this, 'User modified sidecar suffix', { newValue: value });
					await this.plugin.settingsManager.updateSetting('sidecarSuffix', value.trim() || 'side');
				}));

		debug(this, 'Creating auto-create sidecars toggle');
		new Setting(containerEl)
			.setName('Auto-create sidecars')
			.setDesc('Automatically create sidecar files when monitored files are created')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoCreateSidecars)
				.onChange(async (value) => {
					debug(this, 'User toggled auto-create sidecars', { newValue: value });
					await this.plugin.settingsManager.updateSetting('autoCreateSidecars', value);
				}));

		debug(this, 'Creating revalidate on startup toggle');
		new Setting(containerEl)
			.setName('Revalidate on startup')
			.setDesc('Check and fix orphaned sidecars when Obsidian starts')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.revalidateOnStartup)
				.onChange(async (value) => {
					debug(this, 'User toggled revalidate on startup', { newValue: value });
					await this.plugin.settingsManager.updateSetting('revalidateOnStartup', value);
				}));

		debug(this, 'Creating folder whitelist setting');
		new Setting(containerEl)
			.setName('Whitelist folders')
			.setDesc('Only monitor files in these folders (leave empty to monitor all). Use /* for recursive patterns')
			.addTextArea(text => text
				.setPlaceholder('Documents/*\nProjects/active/')
				.setValue(this.plugin.settings.whitelistFolders.join('\n'))
				.onChange(async (value) => {
					debug(this, 'User modified whitelist folders', { newValue: value });
					const folders = value.split('\n').map(f => f.trim()).filter(f => f);
					await this.plugin.settingsManager.updateSetting('whitelistFolders', folders);
				}));

		debug(this, 'Creating folder blacklist setting');
		new Setting(containerEl)
			.setName('Blacklist folders')
			.setDesc('Never monitor files in these folders. Use /* for recursive patterns')
			.addTextArea(text => text
				.setPlaceholder('.obsidian/*\nArchive/*')
				.setValue(this.plugin.settings.blacklistFolders.join('\n'))
				.onChange(async (value) => {
					debug(this, 'User modified blacklist folders', { newValue: value });
					const folders = value.split('\n').map(f => f.trim()).filter(f => f);
					await this.plugin.settingsManager.updateSetting('blacklistFolders', folders);
				}));

		debug(this, 'Creating use regex toggle');
		new Setting(containerEl)
			.setName('Use regex for folder patterns')
			.setDesc('Treat folder patterns as regular expressions instead of simple wildcards')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.useRegexForFolderLists)
				.onChange(async (value) => {
					debug(this, 'User toggled regex folder patterns', { newValue: value });
					await this.plugin.settingsManager.updateSetting('useRegexForFolderLists', value);
				}));

		debug(this, 'Creating appearance settings section');
		containerEl.createEl('h3', { text: 'Appearance Settings' });

		debug(this, 'Creating hide sidecars toggle');
		new Setting(containerEl)
			.setName('Hide sidecars in explorer')
			.setDesc('Hide sidecar files from the file explorer')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.hideSidecarsInExplorer)
				.onChange(async (value) => {
					debug(this, 'User toggled hide sidecars in explorer', { newValue: value });
					await this.plugin.settingsManager.updateSetting('hideSidecarsInExplorer', value);
				}));

		debug(this, 'Creating dim sidecars toggle');
		new Setting(containerEl)
			.setName('Dim sidecars in explorer')
			.setDesc('Reduce opacity of sidecar files in the file explorer')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.dimSidecarsInExplorer)
				.onChange(async (value) => {
					debug(this, 'User toggled dim sidecars in explorer', { newValue: value });
					await this.plugin.settingsManager.updateSetting('dimSidecarsInExplorer', value);
				}));

		debug(this, 'Creating color sidecar extension toggle');
		new Setting(containerEl)
			.setName('Color sidecar extension')
			.setDesc('Apply different styling to sidecar file extensions')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.colorSidecarExtension)
				.onChange(async (value) => {
					debug(this, 'User toggled color sidecar extension', { newValue: value });
					await this.plugin.settingsManager.updateSetting('colorSidecarExtension', value);
				}));

		debug(this, 'Creating management actions section');
		containerEl.createEl('h3', { text: 'Management Actions' });

		debug(this, 'Creating revalidate button');
		new Setting(containerEl)
			.setName('Revalidate all sidecars')
			.setDesc('Check for orphaned sidecars and offer to delete them')
			.addButton(button => button
				.setButtonText('Revalidate now')
				.onClick(async () => {
					debug(this, 'User triggered manual revalidation');
					await this.plugin.revalidateSidecars();
				}));

		debug(this, 'Creating reset settings button');
		new Setting(containerEl)
			.setName('Reset all settings')
			.setDesc('Reset all settings to their default values')
			.addButton(button => button
				.setButtonText('Reset to defaults')
				.setWarning()
				.onClick(() => {
					debug(this, 'User requested settings reset');
					new ConfirmResetModal(this.app, async () => {
						debug(this, 'Resetting all settings to defaults');
						Object.assign(this.plugin.settings, DEFAULT_SETTINGS);
						await this.plugin.saveSettings();
						this.display();
						info(this, 'All settings reset to default values');
						new Notice('Settings reset to defaults');
					}).open();
				}));

		debug(this, 'Creating delete all sidecars button');
		new Setting(containerEl)
			.setName('Delete all sidecars')
			.setDesc('Remove all sidecar files from the vault (cannot be undone)')
			.addButton(button => button
				.setButtonText('Delete all sidecars')
				.setWarning()
				.onClick(() => {
					debug(this, 'User requested deletion of all sidecars');
					new ConfirmDeleteAllSidecarsModal(this.app, async () => {
						debug(this, 'User confirmed deletion of all sidecars');
						await this.plugin.sidecarManager.deleteAllSidecars();
						info(this, 'All sidecar files deleted successfully');
					}).open();
				}));

		debug(this, 'Settings tab UI rendering completed - all controls configured');
	}
}
