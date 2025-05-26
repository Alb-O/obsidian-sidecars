import { FSWatcher, watch } from 'chokidar';
import { stat } from 'fs/promises';
import { Notice, TFile, FileSystemAdapter, normalizePath, App, TAbstractFile } from 'obsidian';
import SidecarPlugin from '../main';
import { PathInoMapService } from './PathInoMapService';
import { toPosixPath } from '../utils';

export class ExternalFileHandler {
    private plugin: SidecarPlugin;
    private app: App;
    private pathInoMapService: PathInoMapService;
    private fileSystemAdapter: FileSystemAdapter;
    private watcher: FSWatcher | null = null;
    private renameInProgress: Map<string, { oldPath: string; timestamp: number }> = new Map();
    private readonly obsidianVaultPath: string;
    private staleRenameCleanupInterval: NodeJS.Timeout | null = null;
    private readonly STALE_RENAME_THRESHOLD_MS = 2000;

    constructor(plugin: SidecarPlugin, pathInoMapService: PathInoMapService, fileSystemAdapter: FileSystemAdapter) {
        this.plugin = plugin;
        this.app = plugin.app;
        this.pathInoMapService = pathInoMapService;
        this.fileSystemAdapter = fileSystemAdapter;
        this.obsidianVaultPath = toPosixPath(this.fileSystemAdapter.getBasePath());
        console.log('Sidecar Plugin: ExternalFileHandler constructed. Vault path:', this.obsidianVaultPath);
    }

    async init() {
        console.log('Sidecar Plugin: ExternalFileHandler init called.');

        if (!this.plugin.settings.enableExternalRenameDetection) {
            console.log('Sidecar Plugin: External rename detection is disabled in settings. ExternalFileHandler will not initialize.');
            return;
        }

        if (!this.fileSystemAdapter) {
            new Notice("Sidecar Plugin: FileSystemAdapter not available. External file move/rename detection will not work.");
            console.warn('Sidecar Plugin: FileSystemAdapter not available in ExternalFileHandler.init()');
            return;
        }
        await this.initializePathInoMap();
        this.registerExternalFileWatcher();
        if (this.staleRenameCleanupInterval) clearInterval(this.staleRenameCleanupInterval);
        this.staleRenameCleanupInterval = setInterval(() => this.cleanupStaleRenameEntries(), this.STALE_RENAME_THRESHOLD_MS);
        console.log(`Sidecar Plugin: Started stale rename cleanup interval (${this.STALE_RENAME_THRESHOLD_MS}ms).`);
    }

    cleanup() {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
            console.log('Sidecar Plugin: External file watcher stopped.');
        }
        this.renameInProgress.clear();
        if (this.staleRenameCleanupInterval) {
            clearInterval(this.staleRenameCleanupInterval);
            this.staleRenameCleanupInterval = null;
            console.log('Sidecar Plugin: Stopped stale rename cleanup interval.');
        }
    }

    private getVaultRelativePath(fullPathPosix: string): string | null {
        if (fullPathPosix.startsWith(this.obsidianVaultPath + '/')) {
            return fullPathPosix.substring(this.obsidianVaultPath.length + 1);
        }
        if (fullPathPosix === this.obsidianVaultPath) return ''; 
        return null;
    }

    private async initializePathInoMap(): Promise<void> {
        if (!this.fileSystemAdapter) return;
        console.log('Sidecar Plugin: Initializing path to inode map for external changes...');
        
        const files = this.app.vault.getFiles();
        const currentFilePaths = new Set<string>();

        for (const file of files) {
            const fullPath = toPosixPath(this.fileSystemAdapter.getFullPath(file.path));
            currentFilePaths.add(fullPath);
            try {
                const stats = await stat(fullPath);
                await this.pathInoMapService.set(fullPath, stats.ino);
            } catch (err) {
                console.warn(`Sidecar Plugin: Error getting stats for ${fullPath} during init, removing from map if exists.`, err);
                await this.pathInoMapService.deletePath(fullPath);
            }
        }
        
        const allMappedPaths = await this.pathInoMapService.getPaths();
        for (const mappedPath of allMappedPaths) {
            if (!currentFilePaths.has(mappedPath)) {
                console.log(`Sidecar Plugin: Removing stale entry from inode map: ${mappedPath}`);
                await this.pathInoMapService.deletePath(mappedPath);
            }
        }
        console.log('Sidecar Plugin: Path to inode map initialized.');
    }

    private registerExternalFileWatcher(): void {
        if (!this.fileSystemAdapter) return;
        const watchPath = this.fileSystemAdapter.getBasePath();
        console.log(`Sidecar Plugin: Registering external file watcher for path: ${watchPath}`);
        if (this.watcher) {
            console.log('Sidecar Plugin: Closing existing external file watcher.');
            this.watcher.close();
        }
        try {
            const ignoredPatterns: (string | RegExp)[] = [
                /(^|[\/\\])\../, 
                '**/.obsidian/**',
                '**/.trash/**',
                this.obsidianVaultPath + '/node_modules/**',
                this.obsidianVaultPath + '/.git/**', 
            ];

            if (this.plugin.settings.blacklistFolders) {
                this.plugin.settings.blacklistFolders.forEach((folder: string) => {
                    if (folder.trim() !== '') {
                        ignoredPatterns.push('**/' + folder.trim().replace(/^\/+/, '').replace(/\/+$/, '') + '/**');
                    }
                });
            }

            this.watcher = watch(watchPath, {
                ignored: ignoredPatterns,
                persistent: true,
                ignoreInitial: true,
                awaitWriteFinish: {
                    stabilityThreshold: 500,
                    pollInterval: 100
                },
                depth: undefined,
                ignorePermissionErrors: true,
            });
            console.log('Sidecar Plugin: Chokidar watcher instance created.');

            this.watcher
                .on('add', async (path) => {
                    const fullPathPosix = toPosixPath(path);
                    console.log(`Sidecar (external CHOKIDAR): 'add' event for ${fullPathPosix}`);
                    if (this.isDotFileOrFolder(fullPathPosix)) {
                        console.log(`Sidecar (external CHOKIDAR): Ignoring 'add' for dot file/folder: ${fullPathPosix}`);
                        return;
                    }
                    await this.handleExternalCreate(fullPathPosix);
                })
                .on('unlink', async (path) => {
                    const fullPathPosix = toPosixPath(path);
                    console.log(`Sidecar (external CHOKIDAR): 'unlink' event for ${fullPathPosix}`);
                    if (this.isDotFileOrFolder(fullPathPosix)) {
                        console.log(`Sidecar (external CHOKIDAR): Ignoring 'unlink' for dot file/folder: ${fullPathPosix}`);
                        return;
                    }
                    await this.handleExternalDelete(fullPathPosix);
                })
                .on('error', error => {
                    console.error(`Sidecar Plugin: External file watcher error:`, error);
                    new Notice(`Sidecar Plugin: Watcher error. See console.`);
                })
                .on('ready', () => { 
                    console.log('Sidecar Plugin: External file watcher ready and watching.');
                 });

            console.log(`Sidecar Plugin: External file watcher event listeners attached.`);

        } catch (error) {
            new Notice(`Sidecar Plugin: Error starting external file watcher: ${error}`);
            console.error(`Sidecar Plugin: Error starting external file watcher:`, error);
            this.watcher = null;
        }
    }
    
    private isDotFileOrFolder(filePath: string): boolean {
        const relativePath = filePath.substring(this.obsidianVaultPath.length);
        const isDot = relativePath.split('/').some(segment => segment.startsWith('.') && segment !== '.');
        return isDot;
    }

    private async handleExternalCreate(fullPathPosix: string): Promise<void> {
        console.log(`Sidecar (external): handleExternalCreate called for ${fullPathPosix}`);
        try {
            const stats = await stat(fullPathPosix);
            const inoKey = stats.ino.toString();
            console.log(`Sidecar (external): Stat successful for ${fullPathPosix}, inode: ${inoKey}`);

            if (this.renameInProgress.has(inoKey)) {
                const renameEntry = this.renameInProgress.get(inoKey)!;
                this.renameInProgress.delete(inoKey);
                console.log(`Sidecar (external): Detected rename (create part) via inode ${inoKey}: ${renameEntry.oldPath} -> ${fullPathPosix}`);
                await this.handleExternalRename(renameEntry.oldPath, fullPathPosix, stats.ino);
            } else {
                console.log(`Sidecar (external): Genuine create for ${fullPathPosix}, inode: ${stats.ino}. Adding to map.`);
                await this.pathInoMapService.set(fullPathPosix, stats.ino);
                console.log(`Sidecar (external): Added ${fullPathPosix} (inode: ${stats.ino}) to map.`);
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                console.warn(`Sidecar (external): File ${fullPathPosix} disappeared before it could be processed for creation.`);
            } else {
                console.warn(`Sidecar (external): Error in handleExternalCreate for ${fullPathPosix}:`, error);
            }
        }
    }

    private async handleExternalDelete(fullPathPosix: string): Promise<void> {
        console.log(`Sidecar (external): handleExternalDelete called for ${fullPathPosix}`);
        const ino = await this.pathInoMapService.getIno(fullPathPosix);
        if (ino === undefined) {
            console.log(`Sidecar (external): File ${fullPathPosix} not in inode map during delete, likely already processed or irrelevant.`);
            return;
        }
        console.log(`Sidecar (external): File ${fullPathPosix} (inode: ${ino}) deleted. Marking for potential rename.`);
        this.renameInProgress.set(ino.toString(), { oldPath: fullPathPosix, timestamp: Date.now() });
        await this.pathInoMapService.deletePath(fullPathPosix);
        console.log(`Sidecar (external): Removed ${fullPathPosix} from inode map, added to renameInProgress for potential rename.`);
    }

    private async handleExternalRename(oldFullPathPosix: string, newFullPathPosix: string, ino: number): Promise<void> {
        console.log(`Sidecar (external): Handling confirmed rename from ${oldFullPathPosix} to ${newFullPathPosix} (inode: ${ino})`);
        await this.pathInoMapService.set(newFullPathPosix, ino); 
        console.log(`Sidecar (external): Ensured inode map for renamed source file: ${newFullPathPosix} (inode: ${ino})`);

        const oldVaultRelativePath = this.getVaultRelativePath(oldFullPathPosix);
        const newVaultRelativePath = this.getVaultRelativePath(newFullPathPosix);

        if (oldVaultRelativePath === null || newVaultRelativePath === null) {
            console.warn("Sidecar (external): Could not determine vault relative path during rename.", {oldFullPathPosix, newFullPathPosix});
            return;
        }
        console.log(`Sidecar (external): Relative paths for rename: ${oldVaultRelativePath} -> ${newVaultRelativePath}`);

        if (this.plugin.isMonitoredFile(oldVaultRelativePath) && 
            !this.plugin.isSidecarFile(oldVaultRelativePath)) {
            
            console.log(`Sidecar (external): Source file ${oldVaultRelativePath} was renamed to ${newVaultRelativePath}. Processing sidecar rename/creation.`);
            const oldSidecarVaultRelativePath = this.plugin.getSidecarPath(oldVaultRelativePath);
            const newSidecarVaultRelativePath = this.plugin.getSidecarPath(newVaultRelativePath);

            const oldSidecarObsidianPath = normalizePath(oldSidecarVaultRelativePath);
            const newSidecarObsidianPath = normalizePath(newSidecarVaultRelativePath);
            console.log(`Sidecar (external): Sidecar rename/creation paths: ${oldSidecarObsidianPath} -> ${newSidecarObsidianPath}`);

            const oldSidecarFile = this.app.vault.getAbstractFileByPath(oldSidecarObsidianPath);

            if (oldSidecarFile instanceof TFile) {
                console.log(`Sidecar (external): Found old sidecar ${oldSidecarObsidianPath}. Attempting rename.`);
                try {
                    await this.app.fileManager.renameFile(oldSidecarFile, newSidecarObsidianPath);
                    console.log(`Sidecar (external): Successfully renamed sidecar file from ${oldSidecarObsidianPath} to ${newSidecarObsidianPath}.`);

                    const oldSidecarFullPosix = toPosixPath(this.fileSystemAdapter.getFullPath(oldSidecarObsidianPath)); 
                    const newSidecarFullPosix = toPosixPath(this.fileSystemAdapter.getFullPath(newSidecarObsidianPath));

                    const sidecarIno = await this.pathInoMapService.getIno(oldSidecarFullPosix);
                    if (sidecarIno !== undefined) {
                        console.log(`Sidecar (external): Updating inode map for renamed sidecar (original ino: ${sidecarIno}). From ${oldSidecarFullPosix} to ${newSidecarFullPosix}`);
                        await this.pathInoMapService.deletePath(oldSidecarFullPosix);
                        await this.pathInoMapService.set(newSidecarFullPosix, sidecarIno);
                    } else {
                        console.log(`Sidecar (external): Old sidecar path ${oldSidecarFullPosix} not in map or ino unknown. Statting new path ${newSidecarFullPosix}.`);
                        try {
                            const sidecarStats = await stat(newSidecarFullPosix);
                            await this.pathInoMapService.set(newSidecarFullPosix, sidecarStats.ino);
                            console.log(`Sidecar (external): Updated inode map for new sidecar ${newSidecarFullPosix} with new inode ${sidecarStats.ino}.`);
                        } catch (e) { 
                            console.warn(`Sidecar (external): Error statting new sidecar path ${newSidecarFullPosix} after rename. Map may be incomplete.`, e);
                        }
                    }
                } catch (error) {
                    console.error(`Sidecar (external): Error renaming sidecar file ${oldSidecarObsidianPath} to ${newSidecarObsidianPath}:`, error);
                    new Notice(`Sidecar: Error renaming sidecar for ${newVaultRelativePath}. Please check manually.`);
                }
            } else {
                console.log(`Sidecar (external): Old sidecar for ${oldFullPathPosix} did not exist.`);
                if (this.plugin.isMonitoredFile(newVaultRelativePath) &&
                    !this.plugin.isSidecarFile(newVaultRelativePath)) {
                    console.log(`Sidecar (external): Creating new sidecar for moved source file ${newFullPathPosix} at ${newSidecarObsidianPath}.`);
                    try {
                        await this.app.vault.create(newSidecarObsidianPath, '');
                        console.log(`Sidecar (external): Created new sidecar ${newSidecarObsidianPath}.`);
                        const newSidecarFullPosix = toPosixPath(this.fileSystemAdapter.getFullPath(newSidecarObsidianPath));
                        try {
                            const sidecarStats = await stat(newSidecarFullPosix);
                            await this.pathInoMapService.set(newSidecarFullPosix, sidecarStats.ino);
                            console.log(`Sidecar (external): Added new sidecar ${newSidecarFullPosix} (inode ${sidecarStats.ino}) to map.`);
                        } catch (e) {
                            console.warn(`Sidecar (external): Error statting or mapping newly created sidecar ${newSidecarFullPosix}`, e);
                        }
                    } catch (error) {
                        console.error(`Sidecar (external): Error creating new sidecar ${newSidecarObsidianPath} for moved source file:`, error);
                    }
                } else {
                     console.log(`Sidecar (external): New source path ${newVaultRelativePath} is not monitored or is a sidecar/redirect. No new sidecar created.`);
                }
            }
        } else if (this.plugin.isSidecarFile(oldVaultRelativePath)) {
            console.log(`Sidecar (external): Sidecar file ${oldVaultRelativePath} was itself renamed to ${newVaultRelativePath}. Its inode map entry was updated by create/set earlier.`);
        } else {
            console.log(`Sidecar (external): Renamed file ${oldVaultRelativePath} is not a monitored source file. No sidecar action needed.`);
        }
    }

    private async cleanupStaleRenameEntries(): Promise<void> {
        const now = Date.now();
        if (this.renameInProgress.size > 0) {
            console.log(`Sidecar (external): Running stale rename cleanup. ${this.renameInProgress.size} entries to check.`);
        }
        for (const [inoKey, entry] of this.renameInProgress.entries()) {
            if (now - entry.timestamp > this.STALE_RENAME_THRESHOLD_MS) {
                console.log(`Sidecar (external): Stale rename entry for inode ${inoKey}, old path ${entry.oldPath}. Assuming true delete.`);
                this.renameInProgress.delete(inoKey);
                const vaultRelativePath = this.getVaultRelativePath(entry.oldPath);
                if (vaultRelativePath && this.plugin.isMonitoredFile(vaultRelativePath) &&
                    !this.plugin.isSidecarFile(vaultRelativePath)) {

                    const sidecarVaultRelativePath = this.plugin.getSidecarPath(vaultRelativePath);
                    const sidecarObsidianPath = normalizePath(sidecarVaultRelativePath);
                    console.log(`Sidecar (external): Source file ${vaultRelativePath} confirmed truly deleted (stale). Attempting to delete its sidecar: ${sidecarObsidianPath}`);
                    try {
                        const sidecarFile = this.app.vault.getAbstractFileByPath(sidecarObsidianPath);
                        if (sidecarFile instanceof TFile) {
                            console.log(`Sidecar (external): Deleting sidecar ${sidecarObsidianPath} for truly deleted source ${vaultRelativePath} (stale).`);
                            await this.app.vault.delete(sidecarFile);
                            const sidecarFullPathPosix = toPosixPath(this.fileSystemAdapter.getFullPath(sidecarObsidianPath));
                            await this.pathInoMapService.deletePath(sidecarFullPathPosix);
                            console.log(`Sidecar (external): Deleted sidecar ${sidecarObsidianPath} and its inode map entry (if existed).`);
                        } else {
                             console.log(`Sidecar (external): Sidecar ${sidecarObsidianPath} not found or not a TFile for stale deleted source ${vaultRelativePath}.`);
                        }
                    } catch (error) {
                        console.warn(`Sidecar (external): Error deleting sidecar for truly deleted file ${vaultRelativePath} (stale):`, error);
                    }
                } else {
                    console.log(`Sidecar (external): Stale deleted file ${entry.oldPath} (relative: ${vaultRelativePath}) was not a monitored source file. No sidecar action.`);
                }
            }
        }
    }

    public isWatcherActive(): boolean {
        return !!this.watcher;
    }
}
