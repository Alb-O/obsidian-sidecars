import type { App } from "obsidian";
import {
	Setting,
	Notice,
	PluginSettingTab,
	AbstractInputSuggest,
} from "obsidian";
import { loggerInfo, loggerWarn, loggerError } from "@/utils";
import { ConfirmResetModal, ConfirmDeleteAllSidecarsModal } from "@/modals";
import type { PluginWithSettings, SidecarPluginSettings } from "@/types";
import { DEFAULT_SETTINGS } from "@/types";

export class SettingsManager {
	private plugin: PluginWithSettings;
	private settings: SidecarPluginSettings;

	constructor(plugin: PluginWithSettings) {
		this.plugin = plugin;
		this.settings = DEFAULT_SETTINGS;
	}
	async loadSettings(): Promise<void> {
		const loadedData = await this.plugin.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
		this.plugin.settings = this.settings; // Ensure plugin settings reference is updated
	}

	async saveSettings(): Promise<void> {
		await this.plugin.saveData(this.settings);
	}

	getSettings(): SidecarPluginSettings {
		return this.settings;
	}
	getSettingTab(): PluginSettingTab {
		return new SidecarPluginSettingTab(this.plugin.app, this.plugin);
	}

	async initialize() {
		this.plugin.addSettingTab(
			new SidecarPluginSettingTab(this.plugin.app, this.plugin),
		);
	}

	async updateSetting<K extends keyof SidecarPluginSettings>(
		key: K,
		value: SidecarPluginSettings[K],
	): Promise<void> {
		// Validate setting value before applying
		if (
			key === "sidecarSuffix" &&
			typeof value === "string" &&
			value.length > 20
		) {
			loggerWarn(this, "Sidecar suffix exceeds recommended length", {
				key: String(key),
				length: value.length,
				maxRecommended: 20,
			});
		}
		try {
			this.settings[key] = value;
			this.plugin.settings[key] = value;

			await this.plugin.saveSettings();

			loggerInfo(this, "Setting successfully updated", {
				key: String(key),
				newValue:
					typeof value === "string" && value.length > 50
						? `${value.substring(0, 50)}...`
						: value,
			});
		} catch (updateError) {
			loggerError(this, "Failed to update plugin setting", {
				key: String(key),
				error:
					updateError instanceof Error
						? updateError.message
						: String(updateError),
				attemptedValue: value,
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
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("Sidecar file suffix")
			.setDesc(
				"The suffix to use for sidecar files. Don't include periods or the .md extension.",
			)
			.addText((text) => {
				text
					.setPlaceholder("side")
					.setValue(this.plugin.settings.sidecarSuffix);

				const handleValidation = async () => {
					const currentValue = text.inputEl.value;
					if (
						currentValue.length > 0 &&
						!currentValue.includes(".") &&
						!currentValue.toLowerCase().includes("md")
					) {
						// Only save if the value has actually changed from the last saved valid state
						if (this.plugin.settings.sidecarSuffix !== currentValue) {
							await this.plugin.settingsManager.updateSetting(
								"sidecarSuffix",
								currentValue,
							);
							// Update example tags in settings UI
							const exampleTags = this.containerEl.querySelectorAll(
								".sidecar-tag-example",
							);
							exampleTags.forEach((tag) => {
								if (tag instanceof HTMLElement) {
									tag.textContent = this.plugin.settings.sidecarSuffix;
								}
							});
						}
					} else {
						new Notice(
							"Sidecar suffix must not be empty and cannot contain periods or 'md'.",
						);
						// Revert the input field to the last saved (and valid) value
						text.setValue(this.plugin.settings.sidecarSuffix);
					}
				};

				text.inputEl.addEventListener("blur", async () => {
					await handleValidation();
				});

				text.inputEl.addEventListener(
					"keydown",
					async (event: KeyboardEvent) => {
						if (event.key === "Enter") {
							event.preventDefault(); // Prevent default Enter behavior (e.g., form submission)
							await handleValidation();
						}
					},
				);
			});

		new Setting(containerEl)
			.setName("Automatically create new sidecars")
			.setDesc(
				"If enabled, new sidecars will be created automatically for monitored files. If disabled, only existing sidecars will be managed. To manually create sidecars, use the context menu in the File Explorer.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoCreateSidecars)
					.onChange(async (value) => {
						await this.plugin.settingsManager.updateSetting(
							"autoCreateSidecars",
							value,
						);
					}),
			);

		new Setting(containerEl)
			.setName("Revalidate sidecars on startup")
			.setDesc(
				"Automatically re-scan all files and manage sidecars when Obsidian starts or the plugin is loaded.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.revalidateOnStartup)
					.onChange(async (value) => {
						await this.plugin.settingsManager.updateSetting(
							"revalidateOnStartup",
							value,
						);
					}),
			);

		new Setting(containerEl)
			.setName("Default sidecar template note")
			.setDesc(
				"Pick a note from your vault to use as the template for new sidecar files. \
				You can use the Templater plugin with the 'Trigger Templater on new file creation' option enabled to automatically apply templates on sidecar creation.",
			)
			.then((setting) => {
				setting.controlEl.empty();
				const input = document.createElement("input");
				input.type = "text";
				input.placeholder = "Templates/Sidecar Template";
				input.value = this.plugin.settings.templateNotePath || "";
				setting.controlEl.appendChild(input);

				class NoteSuggest extends AbstractInputSuggest<string> {
					plugin: PluginWithSettings;
					constructor(
						app: App,
						plugin: PluginWithSettings,
						inputEl: HTMLInputElement,
					) {
						super(app, inputEl);
						this.plugin = plugin;
					}
					getSuggestions(query: string): string[] {
						const files = this.plugin.app.vault.getMarkdownFiles();
						const suffix = `.${this.plugin.settings.sidecarSuffix}.md`;
						return files
							.map((f) => f.path)
							.filter(
								(p) =>
									// Filter out sidecars
									!p.endsWith(suffix) &&
									p.toLowerCase().includes(query.toLowerCase()),
							);
					}
					renderSuggestion(notePath: string, el: HTMLElement) {
						const displayName = notePath.endsWith(".md")
							? notePath.slice(0, -3)
							: notePath;
						el.setText(displayName);
					}
					selectSuggestion(notePath: string) {
						// Show without .md in input, but store full path
						const displayName = notePath.endsWith(".md")
							? notePath.slice(0, -3)
							: notePath;
						input.value = displayName;
						this.plugin.settingsManager.updateSetting(
							"templateNotePath",
							notePath,
						);
						this.close();
					}
				}
				new NoteSuggest(this.plugin.app, this.plugin, input);
				input.addEventListener("change", async () => {
					// When user types, try to match to a markdown file and store full path
					const files = this.plugin.app.vault.getMarkdownFiles();
					const match = files.find((f) => {
						const base = f.path.endsWith(".md") ? f.path.slice(0, -3) : f.path;
						return base === input.value;
					});
					const valueToStore = match ? match.path : input.value;
					await this.plugin.settingsManager.updateSetting(
						"templateNotePath",
						valueToStore,
					);
				});
			});

		new Setting(containerEl)
			.setName("Revalidate sidecars")
			.setDesc(
				"Manually re-scan all files to create missing sidecars and remove orphaned or invalid ones. This can be useful after bulk file operations or if you suspect inconsistencies.",
			)
			.addButton((button) =>
				button
					.setButtonText("Revalidate now")
					.setCta()
					.onClick(() => {
						new Notice("Starting sidecar revalidation...");
						this.plugin.revalidateSidecars();
					}),
			);

		new Setting(containerEl).setName("File types").setHeading();

		new Setting(containerEl)
			.setName("Manage image files")
			.setDesc(
				"Create and manage sidecars for image formats supported by Obsidian:",
			)
			.then((setting) => {
				const desc = setting.descEl;
				const ex = document.createElement("div");
				ex.classList.add("sidecar-margin-top");
				["avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"].forEach(
					(ext, i, arr) => {
						const code = document.createElement("code");
						code.textContent = ext;
						ex.appendChild(code);
						if (i < arr.length - 1)
							ex.appendChild(document.createTextNode(", "));
					},
				);
				desc.appendChild(ex);
				setting.addToggle((toggle) =>
					toggle.setValue(false).onChange(async (value) => {
						if (value) {
							const imageExts = [
								"avif",
								"bmp",
								"gif",
								"jpeg",
								"jpg",
								"png",
								"svg",
								"webp",
							];
							const current = new Set(
								this.plugin.settings.monitoredExtensions.map((e) =>
									e.toLowerCase(),
								),
							);
							let changed = false;
							for (const ext of imageExts) {
								if (!current.has(ext)) {
									this.plugin.settings.monitoredExtensions.push(ext);
									changed = true;
								}
							}
							if (changed)
								await this.plugin.settingsManager.updateSetting(
									"monitoredExtensions",
									this.plugin.settings.monitoredExtensions,
								);
						}
					}),
				);
			});

		new Setting(containerEl)
			.setName("Manage video files")
			.setDesc(
				"Create and manage sidecars for video formats supported by Obsidian:",
			)
			.then((setting) => {
				const desc = setting.descEl;
				const ex = document.createElement("div");
				ex.classList.add("sidecar-margin-top");
				["mkv", "mov", "mp4", "ogv", "webm"].forEach((ext, i, arr) => {
					const code = document.createElement("code");
					code.textContent = ext;
					ex.appendChild(code);
					if (i < arr.length - 1) ex.appendChild(document.createTextNode(", "));
				});
				desc.appendChild(ex);
				setting.addToggle((toggle) =>
					toggle.setValue(false).onChange(async (value) => {
						if (value) {
							const videoExts = ["mkv", "mov", "mp4", "ogv", "webm"];
							const current = new Set(
								this.plugin.settings.monitoredExtensions.map((e) =>
									e.toLowerCase(),
								),
							);
							let changed = false;
							for (const ext of videoExts) {
								if (!current.has(ext)) {
									this.plugin.settings.monitoredExtensions.push(ext);
									changed = true;
								}
							}
							if (changed)
								await this.plugin.settingsManager.updateSetting(
									"monitoredExtensions",
									this.plugin.settings.monitoredExtensions,
								);
						}
					}),
				);
			});

		new Setting(containerEl)
			.setName("Manage audio files")
			.setDesc(
				"Create and manage sidecars for audio formats supported by Obsidian:",
			)
			.then((setting) => {
				const desc = setting.descEl;
				const ex = document.createElement("div");
				ex.classList.add("sidecar-margin-top");
				["flac", "m4a", "mp3", "ogg", "wav", "webm", "3gp"].forEach(
					(ext, i, arr) => {
						const code = document.createElement("code");
						code.textContent = ext;
						ex.appendChild(code);
						if (i < arr.length - 1)
							ex.appendChild(document.createTextNode(", "));
					},
				);
				desc.appendChild(ex);
				setting.addToggle((toggle) =>
					toggle.setValue(false).onChange(async (value) => {
						if (value) {
							const audioExts = [
								"flac",
								"m4a",
								"mp3",
								"ogg",
								"wav",
								"webm",
								"3gp",
							];
							const current = new Set(
								this.plugin.settings.monitoredExtensions.map((e) =>
									e.toLowerCase(),
								),
							);
							let changed = false;
							for (const ext of audioExts) {
								if (!current.has(ext)) {
									this.plugin.settings.monitoredExtensions.push(ext);
									changed = true;
								}
							}
							if (changed)
								await this.plugin.settingsManager.updateSetting(
									"monitoredExtensions",
									this.plugin.settings.monitoredExtensions,
								);
						}
					}),
				);
			});

		new Setting(containerEl)
			.setName("Extra file types")
			.setDesc("List extra file types to manage (one per line).")
			.then((setting) => {
				// Remove any existing content
				setting.controlEl.empty();
				// Create textarea
				const textarea = document.createElement("textarea");
				textarea.placeholder = "pdf\ncanvas";
				textarea.value = this.plugin.settings.monitoredExtensions.join("\n");
				textarea.addEventListener("change", async () => {
					const extensions = textarea.value
						.split(/\r?\n/)
						.map((item) => item.trim())
						.filter((item) => item.length > 0)
						.map((ext) => ext.replace(/^\./, "").toLowerCase());
					await this.plugin.settingsManager.updateSetting(
						"monitoredExtensions",
						extensions,
					);
				});
				// Assign class to parent
				setting.controlEl.classList.add("multiple-text-component");
				setting.controlEl.appendChild(textarea);
			});

		new Setting(containerEl).setName("File Explorer behavior").setHeading();

		new Setting(containerEl)
			.setName("Prevent dragging of sidecar files")
			.setDesc(
				"If enabled, sidecar files cannot be dragged in the File Explorer. This helps prevent accidental moves.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.preventDraggingSidecars)
					.onChange(async (value) => {
						await this.plugin.settingsManager.updateSetting(
							"preventDraggingSidecars",
							value,
						);
					}),
			);

		new Setting(containerEl)
			.setName("Hide sidecar files")
			.setDesc("Completely hide sidecar files in Obsidian's File Explorer.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.hideSidecarsInExplorer)
					.onChange(async (value) => {
						await this.plugin.settingsManager.updateSetting(
							"hideSidecarsInExplorer",
							value,
						);
					});
			});

		new Setting(containerEl)
			.setName("Management scope")
			.setHeading()
			.setDesc(
				(() => {
					const fragment = document.createDocumentFragment();
					fragment.createSpan({
						text: "Configure which folders are included or excluded from sidecar management. You can use vault-absolute paths (e.g. ",
					});
					fragment.appendChild(document.createElement("code")).textContent =
						"/Templates/";
					fragment.appendChild(document.createTextNode(") or asterisk ("));
					fragment.appendChild(document.createElement("code")).textContent =
						"*";
					fragment.appendChild(
						document.createTextNode(
							") wildcards. For more advanced control, an option to use full regex syntax is provided at the bottom.",
						),
					);
					return fragment;
				})(),
			);

		new Setting(containerEl)
			.setName("Blacklist folders")
			.setDesc(
				"List of folders to exclude from sidecar management. Exclusions take precedence over inclusions when resolving blacklist subfolders inside whitelist folders.",
			)
			.then((setting) => {
				setting.controlEl.empty();
				const textarea = document.createElement("textarea");
				textarea.placeholder = "/Templates/\n*/archive/*";
				textarea.value = (this.plugin.settings.blacklistFolders || []).join(
					"\n",
				);
				textarea.addEventListener("change", async () => {
					const folders = textarea.value
						.split(/\r?\n/)
						.map((item) => item.trim())
						.filter((item) => item.length > 0);
					await this.plugin.settingsManager.updateSetting(
						"blacklistFolders",
						folders,
					);
				});
				setting.controlEl.classList.add("multiple-text-component");
				setting.controlEl.appendChild(textarea);
			});

		new Setting(containerEl)
			.setName("Whitelist folders")
			.setDesc(
				"List of folders to include for sidecar management. If set to at least one folder, only files in these folders will be managed.",
			)
			.then((setting) => {
				setting.controlEl.empty();
				const textarea = document.createElement("textarea");
				textarea.placeholder = "*/attachments/*";
				textarea.value = (this.plugin.settings.whitelistFolders || []).join(
					"\n",
				);
				textarea.addEventListener("change", async () => {
					const folders = textarea.value
						.split(/\r?\n/)
						.map((item) => item.trim())
						.filter((item) => item.length > 0);
					await this.plugin.settingsManager.updateSetting(
						"whitelistFolders",
						folders,
					);
				});
				setting.controlEl.classList.add("multiple-text-component");
				setting.controlEl.appendChild(textarea);
			});

		new Setting(containerEl)
			.setName("Use regular expressions for folder lists")
			.setDesc(
				(() => {
					const frag = document.createDocumentFragment();
					frag.append(
						"If enabled, folder patterns are treated as full regular expressions (e.g. ",
					);
					frag.appendChild(document.createElement("code")).textContent = ".";
					frag.append(" and ");
					frag.appendChild(document.createElement("code")).textContent = "^";
					frag.append(" are supported). If disabled, only ");
					frag.appendChild(document.createElement("code")).textContent = "*";
					frag.append(" is supported as a wildcard for any depth (e.g. ");
					frag.appendChild(document.createElement("code")).textContent =
						"*/Media/*";
					frag.append(" matches any Media folder at any depth).");
					return frag;
				})(),
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.useRegexForFolderLists)
					.onChange(async (value) => {
						await this.plugin.settingsManager.updateSetting(
							"useRegexForFolderLists",
							value,
						);
					}),
			);

		new Setting(containerEl).setName("File Explorer styles").setHeading();

		new Setting(containerEl)
			.setName("Dim sidecar files")
			.setDesc("Visually dim sidecar files in the File Explorer.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.dimSidecarsInExplorer)
					.onChange(async (value) => {
						await this.plugin.settingsManager.updateSetting(
							"dimSidecarsInExplorer",
							value,
						);
					});
			});

		new Setting(containerEl)
			.setName("Arrow indicators")
			.setDesc(
				(() => {
					const frag = document.createDocumentFragment();
					frag.append("Prepend ");
					frag.appendChild(document.createElement("code")).textContent = "⮡";
					frag.append(
						" to sidecar file names (visual only) and adjust padding to indicate the sidecar is a child of the main file.",
					);
					return frag;
				})(),
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.prependSidecarIndicator)
					.onChange(async (value) => {
						await this.plugin.settingsManager.updateSetting(
							"prependSidecarIndicator",
							value,
						);
					}),
			);

		new Setting(containerEl)
			.setName("Colored sidecar extension")
			.setDesc(
				(() => {
					const frag = document.createDocumentFragment();
					frag.append("Toggle coloring of the sidecar extension (e.g. ");
					const codeTag = document.createElement("span");
					codeTag.className = "nav-file-tag sidecar-tag sidecar-tag-example";
					codeTag.textContent = this.plugin.settings.sidecarSuffix;
					frag.appendChild(codeTag);
					frag.append(") in the File Explorer.");
					return frag;
				})(),
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.colorSidecarExtension)
					.onChange(async (value) => {
						await this.plugin.settingsManager.updateSetting(
							"colorSidecarExtension",
							value,
						);
					}),
			);

		new Setting(containerEl)
			.setName("Append actual file extensions")
			.setDesc(
				"Visually append the actual file extension (e.g. .md) to sidecars in the File Explorer.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showActualExtension)
					.onChange(async (value) => {
						await this.plugin.settingsManager.updateSetting(
							"showActualExtension",
							value,
						);
					}),
			);

		new Setting(containerEl)
			.setName("Hide main file extension")
			.setDesc(
				(() => {
					const frag = document.createDocumentFragment();
					frag.append(
						"Hide the main file extension from sidecar items in the File Explorer, leaving only the ",
					);
					const codeTag = document.createElement("span");
					codeTag.className =
						"nav-file-tag sidecar-tag sidecar-tag-example no-color";
					codeTag.textContent = this.plugin.settings.sidecarSuffix;
					frag.appendChild(codeTag);
					frag.append(" suffix.");
					return frag;
				})(),
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.hideMainExtensionInExplorer)
					.onChange(async (value) => {
						await this.plugin.settingsManager.updateSetting(
							"hideMainExtensionInExplorer",
							value,
						);
					}),
			);

		new Setting(containerEl)
			.setName("Hide base name of sidecar files")
			.setDesc(
				"If enabled, only the extension tags or arrow indicators will be visible for sidecar files. The base file name will be hidden (visual only).",
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.hideSidecarBaseNameInExplorer ?? false)
					.onChange(async (value) => {
						await this.plugin.settingsManager.updateSetting(
							"hideSidecarBaseNameInExplorer",
							value,
						);
					});
			});
		// Create a details element for Blend Vault integration
		const blendVaultDetails = containerEl.createEl("details", {
			cls: "setting-item setting-item-heading setting-collapsible",
		});
		const blendVaultSummaryEl = blendVaultDetails.createEl("summary");

		// Add title directly to the summary element
		blendVaultSummaryEl.createSpan({
			text: "Blend Vault integration",
			cls: "setting-item-name",
		});

		// Add description below the title, still within the summary
		const blendVaultDesc = blendVaultSummaryEl.createDiv({
			cls: "setting-item-description",
		});
		const descFrag = document.createDocumentFragment();
		descFrag.appendText("Only relevant if you use the ");
		const link = descFrag.createEl("span", {
			text: "Blend Vault",
			cls: "external-link",
		});
		link.onclick = () => {
			window.open("https://github.com/Alb-O/blend-vault", "_blank");
		};
		descFrag.appendText(
			" addon for Blender, or other tools that care about redirect files or preview files.",
		);
		blendVaultDesc.appendChild(descFrag);

		const blendVaultContainer = blendVaultDetails.createDiv();

		new Setting(blendVaultContainer).setName("Redirect files").setHeading();

		new Setting(blendVaultContainer)
			.setName("Redirect file suffix")
			.setDesc(
				"The suffix for redirect files. Don't include periods or the .md extension.",
			)
			.addText((text) => {
				text
					.setPlaceholder("redirect")
					.setValue(this.plugin.settings.redirectFileSuffix ?? ".redirect");
				text.inputEl.addEventListener("blur", async () => {
					await this.plugin.settingsManager.updateSetting(
						"redirectFileSuffix",
						text.getValue(),
					);
				});
			});

		new Setting(blendVaultContainer)
			.setName("Hide redirect files")
			.setDesc("Completely hide redirect files in Obsidian's File Explorer.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.hideRedirectFilesInExplorer)
					.onChange(async (value) => {
						await this.plugin.settingsManager.updateSetting(
							"hideRedirectFilesInExplorer",
							value,
						);
						this.plugin.app.workspace.trigger("css-change");
					}),
			);

		new Setting(blendVaultContainer)
			.setName("Show redirect file decorator")
			.setDesc(
				"Show a decorator icon at the beginning of file names when a redirect file exists for that file.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showRedirectDecorator)
					.onChange(async (value) => {
						await this.plugin.settingsManager.updateSetting(
							"showRedirectDecorator",
							value,
						);
						this.plugin.app.workspace.trigger("css-change");
					}),
			);
		new Setting(blendVaultContainer)
			.setName("Show redirect decorator on sidecars")
			.setDesc(
				"Also show the redirect decorator on sidecar files themselves when their main file has a redirect file.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showRedirectDecoratorOnSidecars)
					.onChange(async (value) => {
						await this.plugin.settingsManager.updateSetting(
							"showRedirectDecoratorOnSidecars",
							value,
						);
						this.plugin.app.workspace.trigger("css-change");
					}),
			);

		new Setting(blendVaultContainer).setName("Preview files").setHeading();

		new Setting(blendVaultContainer)
			.setName("Preview file suffix")
			.setDesc(
				"The suffix for preview files. Don't include periods or file extensions.",
			)
			.addText((text) => {
				text
					.setPlaceholder("preview")
					.setValue(this.plugin.settings.previewFileSuffix ?? ".preview");
				text.inputEl.addEventListener("blur", async () => {
					await this.plugin.settingsManager.updateSetting(
						"previewFileSuffix",
						text.getValue(),
					);
				});
			});

		new Setting(blendVaultContainer)
			.setName("Hide preview files")
			.setDesc("Completely hide preview files in Obsidian's File Explorer.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.hidePreviewFilesInExplorer)
					.onChange(async (value) => {
						await this.plugin.settingsManager.updateSetting(
							"hidePreviewFilesInExplorer",
							value,
						);
						this.plugin.app.workspace.trigger("css-change");
					}),
			);

		new Setting(containerEl).setName("Danger zone").setHeading();

		new Setting(containerEl)
			.setName("Reset all settings")
			.setDesc(
				"Restore all Sidecar settings to their default values. This cannot be undone.",
			)
			.addButton((button) => {
				button.setButtonText("Reset to defaults").onClick(() => {
					new ConfirmResetModal(this.app, async () => {
						Object.assign(this.plugin.settings, DEFAULT_SETTINGS);
						await this.plugin.saveSettings();
						new Notice("Sidecar settings reset to defaults.");
						this.display();
						loggerInfo(this, "All settings reset to default values");
					}).open();
				});
				button.buttonEl.classList.add("sidecar-reset-destructive-text");
			});

		new Setting(containerEl)
			.setName("Delete all sidecar files")
			.setDesc(
				"Delete all sidecar files in this vault. This cannot be undone and will remove all sidecar files managed by this plugin.",
			)
			.addButton((button) => {
				button.setButtonText("Delete all sidecars").onClick(() => {
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
									console.error(
										`Failed to delete sidecar file: ${file.path}`,
										err,
									);
								}
							}
						}
						new Notice(`Deleted ${deleted.length} sidecar file(s).`);
						loggerInfo(this, `Deleted ${deleted.length} sidecar files`);
					}).open();
				});
				button.buttonEl.classList.add("sidecar-reset-destructive-text");
			});
	}
}
