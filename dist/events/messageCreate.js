import config from "../config.js";
import logger from "../utils/logger.js";
export async function handleMessageCreate(message, videos, streamStatus, streamingService, commandManager) {
    if (message.author.bot)
        return;
    if (message.guildId !== config.guildId)
        return;
    if (message.channelId !== config.cmdChannelId)
        return;
    if (!config.adminIds.includes(message.author.id))
        return;
    const content = message.content.trim();
    if (content.startsWith(config.prefix)) {
        const args = content.slice(config.prefix.length).trim().split(/ +/);
        const commandName = args.shift()?.toLowerCase();
        if (!commandName)
            return;
        const context = {
            message,
            args,
            videos,
            streamStatus,
            streamingService
        };
        const executed = await commandManager.executeCommand(commandName, context);
        if (!executed) {
            await message.reply(`الأمر غير موجود. استخدم ${config.prefix}help للمساعدة`);
        }
        return;
    }
    if (isValidMediaLink(content)) {
        logger.info(`Direct link detected from ${message.author.username}: ${content}`);
        const success = await streamingService.addToQueue(message, content);
        if (success && !streamStatus.playing) {
            await streamingService.playFromQueue(message);
        }
    }
}
function isValidMediaLink(text) {
    const trimmed = text.trim();
    if (trimmed.includes('youtube.com/') || trimmed.includes('youtu.be/')) {
        return true;
    }
    if (trimmed.includes('twitch.tv/')) {
        return true;
    }
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        return true;
    }
    return false;
}
//# sourceMappingURL=messageCreate.js.map