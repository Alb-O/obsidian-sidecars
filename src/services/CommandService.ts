import { debug, info } from '@/utils';
import type SidecarPlugin from '@/main';

/**
 * Service responsible for registering and handling plugin commands
 * Separates command logic from the main plugin class
 */
export class CommandService {
	private plugin: SidecarPlugin;

	constructor(plugin: SidecarPlugin) {
		this.plugin = plugin;
		debug(this, 'CommandService initialized');
	}

	/**
	 * Register all plugin commands
	 */
	registerCommands(): void {
		debug(this, 'Registering all plugin commands');
		this.registerRevalidateCommand();
		// Add more commands here as needed
	}

	/**
	 * Register the revalidate sidecars command
	 */
	private registerRevalidateCommand(): void {
		debug(this, 'Registering revalidate command');
		this.plugin.addCommand({
			id: 'revalidate-sidecars',
			name: 'Revalidate all sidecars',
			callback: async () => {
				info(this, 'Revalidate command triggered');
				await this.plugin.revalidateSidecars();
			},
		});
	}

	/**
	 * Register a command to create sidecar for current file
	 */
	registerCreateSidecarCommand(): void {
		debug(this, 'Registering create sidecar command');
		this.plugin.addCommand({
			id: 'create-sidecar-current-file',
			name: 'Create sidecar for current file',
			callback: async () => {
				info(this, 'Create sidecar command triggered');
				const activeFile = this.plugin.app.workspace.getActiveFile();
				if (activeFile && !this.plugin.isSidecarFile(activeFile.path)) {
					await this.plugin.sidecarManager.createSidecarForFile(activeFile, true);
				}
			},
		});
	}
}
