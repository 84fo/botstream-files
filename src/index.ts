import { Client } from "discord.js-selfbot-v13";
import config from "./config.js";
import fs from 'fs';
import path from 'path';
import logger from './utils/logger.js';
import { downloadExecutable, checkForUpdatesAndUpdate } from './utils/yt-dlp.js';

// WebSocket polyfill for Node.js < 21 (required by discord-video-stream v6)
import { WebSocket } from 'ws';
if (typeof globalThis.WebSocket === 'undefined') {
	(globalThis as any).WebSocket = WebSocket;
}

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
	logger.info('Applied Promise.withResolvers polyfill for Node.js < 22');
}

// Set ffmpeg path for discord-video-stream before importing it
const localFfmpegBin = path.resolve(process.cwd(), 'ffmpeg_extracted', 'ffmpeg-master-latest-win64-gpl', 'bin');
if (fs.existsSync(localFfmpegBin)) {
	const currentPath = process.env.PATH || '';
	if (!currentPath.includes(localFfmpegBin)) {
		process.env.PATH = `${localFfmpegBin};${currentPath}`;
	}
	logger.info(`FFmpeg bin added to PATH: ${localFfmpegBin}`);
}

// Import event handlers
import { handleReady } from './events/client/ready.js';
import { handleMessageCreate } from './events/messageCreate.js';
import { handleVoiceStateUpdate } from './events/voiceStateUpdate.js';

// Import services
import { StreamingService } from './services/streaming.js';
import { MediaService } from './services/media.js';
import { CommandManager } from './commands/manager.js';
import { QueueService } from './services/queue.js';
import { DiscordBot } from './bot/index.js';

// Download yt-dlp and check for updates
(async () => {
	try {
		await downloadExecutable();
		// Disabled auto-update to keep yt-dlp version compatible with Python 3.9
		// await checkForUpdatesAndUpdate();
	} catch (error) {
		logger.error("Error during initial yt-dlp setup/update:", error);
	}
})();

// Create a new instance of Client
const client = new Client();

// Stream status object
const queueService = new QueueService();
const streamStatus = {
	joined: false,
	joinsucc: false,
	playing: false,
	manualStop: false,
	channelInfo: {
		guildId: config.guildId,
		channelId: config.videoChannelId,
		cmdChannelId: config.cmdChannelId
	},
	queue: queueService.getQueueStatus()
}

// Create the videosFolder dir if it doesn't exist
if (!fs.existsSync(config.videosDir)) {
	fs.mkdirSync(config.videosDir);
}

// Create previewCache parent dir if it doesn't exist
if (!fs.existsSync(path.dirname(config.previewCacheDir))) {
	fs.mkdirSync(path.dirname(config.previewCacheDir), { recursive: true });
}

// Create the previewCache dir if it doesn't exist
if (!fs.existsSync(config.previewCacheDir)) {
	fs.mkdirSync(config.previewCacheDir);
}

// Get all video files
const videoFiles = fs.readdirSync(config.videosDir);

// Create an array of video objects
let videos = videoFiles.map(file => {
	const fileName = path.parse(file).name;
	return { name: fileName, path: path.join(config.videosDir, file) };
});

// Create services
const streamingService = new StreamingService(client, streamStatus);
const mediaService = new MediaService();
const commandManager = new CommandManager();

// Create Discord bot if enabled
let discordBot: DiscordBot | null = null;
if (config.botEnabled) {
	discordBot = new DiscordBot(streamStatus);
	// Set command handler for bot
	discordBot.setCommandHandler(streamingService, videos);
	// Connect bot updates with streaming service
	streamingService.setBotUpdateCallback(() => {
		if (discordBot) {
			discordBot.updatePresence();
		}
	});
	// Connect bot notifications
	streamingService.setBotNotifyCallbacks(
		(title) => discordBot?.notifyNowPlaying(title),
		(title) => discordBot?.notifyFinished(title),
		(title) => discordBot?.notifyError(title)
	);

	// AutoPlay callback — uses regular bot client to get a real message then starts playback
	streamingService.setAutoPlayCallback(async () => {
		try {
			const activeClient = discordBot ? discordBot.getClient() : client;
			const channel = await activeClient.channels.fetch(config.cmdChannelId);
			if (channel && 'send' in channel) {
				// Send a silent trigger message then start playback with the real channel
				const msg = {
					author: { username: 'AutoPlay', id: activeClient.user?.id || '0' },
					channel,
					reply: async (_c: any) => ({ edit: async (_c2: any) => {} }),
					guildId: config.guildId
				};
				await streamingService.playFromQueue(msg);
			} else {
				await streamingService.playFromQueue();
			}
		} catch (e) {
			logger.error('AutoPlay callback error:', e);
			await streamingService.playFromQueue();
		}
	});
}

// Print available videos
if (videos.length > 0) {
	logger.info(`Available videos:\n${videos.map(m => m.name).join('\n')}`);
}

// Event handlers
client.on("ready", async () => {
	await handleReady(client);
});

client.on('voiceStateUpdate', async (oldState, newState) => {
	await handleVoiceStateUpdate(oldState, newState, streamStatus, client);
});

client.on('messageCreate', async (message) => {
	await handleMessageCreate(message, videos, streamStatus, streamingService, commandManager);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
	if (!(error instanceof Error && error.message.includes('SIGTERM'))) {
		logger.error('Uncaught Exception:', error.message);
		logger.error('Stack:', error.stack);
		return
	}
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason: any, promise) => {
	console.error('UNHANDLED REJECTION:', reason);
	console.error('REASON KEYS:', reason ? Object.keys(reason) : 'null/undefined');
	if (reason?.name === 'AbortError' || String(reason).includes('abort')) return;
});

// Run server if enabled in config
if (config.server_enabled) {
	// Run server.ts
	import('./server/index.js');
}

// Login to Discord
client.login(config.token);

// Login bot if enabled
if (config.botEnabled && discordBot) {
	discordBot.login();
}