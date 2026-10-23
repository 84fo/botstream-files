// Promise.withResolvers polyfill for Node.js < 22 (required by node-av v6)
if (typeof (Promise as any).withResolvers === 'undefined') {
	(Promise as any).withResolvers = function<T>() {
		let resolve!: (value: T | PromiseLike<T>) => void;
		let reject!: (reason?: any) => void;
		const promise = new Promise<T>((res, rej) => {
			resolve = res;
			reject = rej;
		});
		return { promise, resolve, reject };
	};
}

// WebSocket polyfill for Node.js < 21
import { WebSocket as WS } from 'ws';
if (typeof globalThis.WebSocket === 'undefined') {
	(globalThis as any).WebSocket = WS;
}
