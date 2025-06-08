// Export all types from this barrel file
import type { Plugin } from 'obsidian';

// Settings types - forward declaration to avoid circular imports
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
	showMdInSidecarTag: false,
	redirectFileSuffix: 'redirect',
	hideRedirectFilesInExplorer: true,
	showRedirectDecorator: true,
	showRedirectDecoratorOnSidecars: false,
	autoCreateSidecars: true,
	prependPeriodToExtTags: false,
	hideSidecarBaseNameInExplorer: false,
};

// Plugin interface for components
export interface PluginWithSettings extends Plugin {
	settings: SidecarPluginSettings;
	settingsManager: any; // Use any to avoid circular reference
	sidecarManager: any;
	saveData(data: any): Promise<void>;
	saveSettings(): Promise<void>;
	revalidateSidecars(): Promise<void>;
}

// Re-export Obsidian types for convenience
export type {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	TAbstractFile,
	Vault,
	Notice,
	WorkspaceLeaf,
	FileView
} from 'obsidian';
