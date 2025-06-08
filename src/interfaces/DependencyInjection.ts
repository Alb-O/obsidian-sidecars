import type { App, Plugin } from 'obsidian';
import type { SidecarPluginSettings } from '@/types';

/**
 * Interface for dependency injection in the plugin
 * Allows for better testing and loose coupling between components
 */
export interface PluginDependencies {
	app: App;
	plugin: Plugin;
	settings: SidecarPluginSettings;
}

/**
 * Interface for service dependencies
 * Allows services to be easily mocked or replaced for testing
 */
export interface ServiceDependencies {
	filePathService?: any; // Type would be FilePathService but avoiding circular imports
	commandService?: any;
	menuService?: any;
}

/**
 * Factory interface for creating services
 * Enables dependency injection and easier testing
 */
export interface ServiceFactory {
	createFilePathService(settings: SidecarPluginSettings): any;
	createCommandService(plugin: any): any;
	createMenuService(plugin: any): any;
}
