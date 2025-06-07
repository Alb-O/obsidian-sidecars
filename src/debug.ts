// Debug logging system using namespace-based debugging
// Users can enable debug messages by running: window.DEBUG?.enable('sidecars') in the console
// Or enable Console > Verbose mode to see console.debug() messages

// Type-safe window interface extension
interface SidecarsWindow {
	DEBUG?: {
		enable(namespace: string): string;
		disable(namespace: string): string;
		enabled(namespace: string): boolean;
	};
	_sidecarDebugEnabled?: boolean;
}

// Type-safe window casting
type WindowWithSidecars = Window & SidecarsWindow;

// Simple debug namespace implementation
const DEBUG_NAMESPACE = 'sidecars';

// Simple flag-based approach for more reliability
function isDebugEnabledSimple(): boolean {
	if (typeof window === 'undefined') return false;
	return !!(window as unknown as WindowWithSidecars)._sidecarDebugEnabled;
}

function setDebugEnabled(enabled: boolean): void {
	if (typeof window !== 'undefined') {
		(window as unknown as WindowWithSidecars)._sidecarDebugEnabled = enabled;
	}
}

// Initialize simple DEBUG controller - force recreation for reliability
function ensureDebugController() {
	if (typeof window === 'undefined') return;
	
	const typedWindow = window as unknown as WindowWithSidecars;
	
	// Create or override the DEBUG controller to ensure it works
	if (!typedWindow.DEBUG) {
		typedWindow.DEBUG = {
			enable: () => '',
			disable: () => '',
			enabled: () => false
		};
	}
	
	// Store original methods if they exist
	const originalEnable = typedWindow.DEBUG!.enable;
	const originalDisable = typedWindow.DEBUG!.disable;
	const originalEnabled = typedWindow.DEBUG!.enabled;
		typedWindow.DEBUG!.enable = function(namespace: string): string {
		// Handle our namespace
		if (namespace === DEBUG_NAMESPACE || namespace === '*') {
			setDebugEnabled(true);
			const message = `Debug enabled for namespace: ${namespace}`;
			return message;
		}
		
		// Call original if it exists for other namespaces
		if (originalEnable && typeof originalEnable === 'function') {
			return originalEnable.call(this, namespace);
		}
		
		return `Debug enabled for namespace: ${namespace}`;
	};
		typedWindow.DEBUG!.disable = function(namespace: string): string {
		// Handle our namespace
		if (namespace === DEBUG_NAMESPACE || namespace === '*') {
			setDebugEnabled(false);
			const message = `Debug disabled for namespace: ${namespace}`;
			return message;
		}
		
		// Call original if it exists for other namespaces
		if (originalDisable && typeof originalDisable === 'function') {
			return originalDisable.call(this, namespace);
		}
		return `Debug disabled for namespace: ${namespace}`;
	};
	
	typedWindow.DEBUG!.enabled = function(namespace: string): boolean {
		// Handle our namespace
		if (namespace === DEBUG_NAMESPACE) {
			return isDebugEnabledSimple();
		}
		if (namespace === '*') {
			return isDebugEnabledSimple(); // For wildcard, return our status
		}
		
		// Call original if it exists for other namespaces
		if (originalEnabled && typeof originalEnabled === 'function') {
			return originalEnabled.call(this, namespace);
		}
		return false;
	};
}

// Check if debugging is enabled for our namespace
function isDebugEnabled(): boolean {
	return isDebugEnabledSimple();
}

// Debug logging functions with color-coded, bracketless namespaces
export function sidecarDebug(...args: any[]) {
	if (isDebugEnabled()) {
		console.debug(`%c${DEBUG_NAMESPACE}`, 'color: #0066cc; font-weight: bold;', ...args);
	}
}

export function sidecarInfo(...args: any[]) {
	if (isDebugEnabled()) {
		console.info(`%c${DEBUG_NAMESPACE}`, 'color: #0066cc; font-weight: bold;', ...args);
	}
}

export function sidecarWarn(...args: any[]) {
	if (isDebugEnabled()) {
		console.warn(`%c${DEBUG_NAMESPACE}`, 'color: #ff8800; font-weight: bold;', ...args);
	}
}

export function sidecarError(...args: any[]) {
	if (isDebugEnabled()) {
		console.error(`%c${DEBUG_NAMESPACE}`, 'color: #cc0000; font-weight: bold;', ...args);
	}
}

// Initialize the debug controller when this module loads
ensureDebugController();
