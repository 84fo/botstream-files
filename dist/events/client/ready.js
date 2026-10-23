import logger from "../../utils/logger.js";
import { DiscordUtils } from "../../utils/shared.js";
export async function handleReady(client) {
    if (client.user) {
        logger.info(`${client.user.tag} is ready`);
        client.user.setActivity(DiscordUtils.status_idle());
        const guild = client.guilds.cache.get(process.env.GUILD_ID || '');
        if (guild) {
            logger.info(`Connected to guild: ${guild.name} (${guild.id})`);
            const voiceChannel = guild.channels.cache.get(process.env.VIDEO_CHANNEL_ID || '');
            if (voiceChannel) {
                logger.info(`Voice channel found: ${voiceChannel.name} (type: ${voiceChannel.type})`);
                const permissions = voiceChannel.permissionsFor(client.user);
                if (permissions) {
                    logger.info(`Permissions - Connect: ${permissions.has('CONNECT')}, Speak: ${permissions.has('SPEAK')}, Video: ${permissions.has('STREAM')}`);
                }
            }
            else {
                logger.warn(`Voice channel ${process.env.VIDEO_CHANNEL_ID} not found!`);
            }
        }
        else {
            logger.warn(`Guild ${process.env.GUILD_ID} not found!`);
        }
    }
}
//# sourceMappingURL=ready.js.map