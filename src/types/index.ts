// Export all types from this barrel file
import type { Plugin } from "obsidian";

// Plugin interface for dependency injection and better type safety
export interface SidecarPluginInterface extends Plugin {
	settings: SidecarPluginSettings;
	isInitialRevalidating: boolean;
	hasFinishedInitialLoad: boolean;

	// Core plugin methods
	saveSettings(refreshStyles?: boolean): Promise<void>;
	revalidateSidecars(): Promise<void>;

	// File type checking methods
	isMonitoredFile(filePath: string): boolean;
	isSidecarFile(filePath: string): boolean;
	isRedirectFile(filePath: string): boolean;
	isPreviewFile(filePath: string): boolean;

	// Path generation methods
	getSidecarPath(filePath: string): string;
	getRedirectPath(filePath: string): string;
	getPreviewPath(filePath: string, extension?: string): string;
	getSourcePathFromSidecar(sidecarPath: string): string | null;
	getSourcePathFromRedirect(redirectPath: string): string | null;
	getSourcePathFromPreview(previewPath: string): string | null;

	// Helper methods
	hasRedirectFile(filePath: string): boolean;
	hasPreviewFile(filePath: string): boolean;
	sidecarMainFileHasRedirect(sidecarPath: string): boolean;
	sidecarMainFileHasPreview(sidecarPath: string): boolean;

	// UI update methods
	updateSidecarFileAppearance(): void;
	updateSidecarCss(): void;
}

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
	showActualExtension: boolean;
	redirectFileSuffix: string;
	hideRedirectFilesInExplorer: boolean;
	showRedirectDecorator: boolean;
	showRedirectDecoratorOnSidecars: boolean;
	previewFileSuffix: string;
	hidePreviewFilesInExplorer: boolean;
	showPreviewDecorator: boolean;
	showPreviewDecoratorOnSidecars: boolean;
	autoCreateSidecars: boolean;
	hideSidecarBaseNameInExplorer: boolean;
}

export const DEFAULT_SETTINGS: SidecarPluginSettings = {
	monitoredExtensions: [],
	sidecarSuffix: "side",
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
	showActualExtension: false,
	redirectFileSuffix: "redirect",
	hideRedirectFilesInExplorer: true,
	showRedirectDecorator: true,
	showRedirectDecoratorOnSidecars: false,
	previewFileSuffix: "preview",
	hidePreviewFilesInExplorer: false,
	showPreviewDecorator: true,
	showPreviewDecoratorOnSidecars: false,
	autoCreateSidecars: true,
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
	isSidecarFile(filePath: string): boolean;
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
	FileView,
} from "obsidian";
