// Debug logging system using namespace-based debugging
// Users can enable debug messages by running: window.DEBUG?.enable('sidecars') in the console
// Or enable Console > Verbose mode to see console.debug() messages

// Global debug controller interface
declare global {
	interface Window {
		DEBUG?: {
			enable(namespace: string): string;
			disable(namespace: string): string;
			enabled(namespace: string): boolean;
		};
		testSidecarsDebug?: () => string;
		_sidecarDebugEnabled?: boolean;
	}
}

// Simple debug namespace implementation
const DEBUG_NAMESPACE = 'sidecars';

// Simple flag-based approach for more reliability
function isDebugEnabledSimple(): boolean {
	if (typeof window === 'undefined') return false;
	return !!(window as any)._sidecarDebugEnabled;
}

function setDebugEnabled(enabled: boolean): void {
	if (typeof window !== 'undefined') {
		(window as any)._sidecarDebugEnabled = enabled;
	}
}

// Initialize simple DEBUG controller - force recreation for reliability
function ensureDebugController() {
	if (typeof window === 'undefined') return;
	
	// Create or override the DEBUG controller to ensure it works
	if (!window.DEBUG) {
		window.DEBUG = {
			enable: () => '',
			disable: () => '',
			enabled: () => false
		};
	}
	
	// Store original methods if they exist
	const originalEnable = window.DEBUG!.enable;
	const originalDisable = window.DEBUG!.disable;
	const originalEnabled = window.DEBUG!.enabled;
		window.DEBUG!.enable = function(namespace: string): string {
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
		window.DEBUG!.disable = function(namespace: string): string {
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
	
	window.DEBUG!.enabled = function(namespace: string): boolean {
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

// Debug logging functions - use console.debug() so they can be controlled by Console settings
export function sidecarDebug(...args: any[]) {
	if (isDebugEnabled()) {
		console.debug(`[${DEBUG_NAMESPACE}]`, ...args);
	}
}

export function sidecarWarn(...args: any[]) {
	if (isDebugEnabled()) {
		console.warn(`[${DEBUG_NAMESPACE}]`, ...args);
	}
}

// Initialize the debug controller when this module loads
ensureDebugController();
