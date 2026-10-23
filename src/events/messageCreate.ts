import { Message } from "discord.js-selfbot-v13";
import { CommandManager } from "../commands/manager.js";
import { CommandContext, Video, StreamStatus } from "../types/index.js";
import config from "../config.js";
import logger from "../utils/logger.js";

export async function handleMessageCreate(
	message: Message,
	videos: Video[],
	streamStatus: StreamStatus,
	streamingService: any,
	commandManager: CommandManager
): Promise<void> {
	// Ignore messages from bots
	if (message.author.bot) return;

	// Only process messages from the configured guild and command channel
	if (message.guildId !== config.guildId) return;
	if (message.channelId !== config.cmdChannelId) return;

	// The bot (F2 Quest) handles all command responses.
	// The selfbot only handles direct URL messages (without prefix).
	// Commands with prefix are handled exclusively by the bot.
	const content = message.content.trim();

	// Skip prefix commands — bot handles them
	if (content.startsWith(config.prefix)) return;

	// Handle direct URL/link messages only (without prefix) - DISABLED
	// If the user wants to play, they must use the command %play
	/*
	if (config.adminIds.includes(message.author.id) && isValidMediaLink(content)) {
		logger.info(`Direct link from ${message.author.username}: ${content}`);
		const queueItem = await streamingService.addToQueue(message, content);
		if (queueItem && !streamStatus.playing) {
			await streamingService.playFromQueue(message);
		}
	}
	*/
}

/*
function isValidMediaLink(text: string): boolean {
	const trimmed = text.trim();
	
	// Check for YouTube links
	if (trimmed.includes('youtube.com/') || trimmed.includes('youtu.be/')) {
		return true;
	}
	
	// Check for Twitch links
	if (trimmed.includes('twitch.tv/')) {
		return true;
	}
	
	// Check for direct URLs
	if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
		return true;
	}
	
	return false;
}
*/
