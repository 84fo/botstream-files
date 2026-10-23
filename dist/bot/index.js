import { Client, GatewayIntentBits, EmbedBuilder, ActivityType, PresenceUpdateStatus } from 'discord.js';
import config from '../config.js';
import logger from '../utils/logger.js';
import { BotCommandHandler } from './commands.js';
export class DiscordBot {
    client;
    streamStatus;
    commandHandler = null;
    constructor(streamStatus) {
        this.streamStatus = streamStatus;
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildVoiceStates
            ]
        });
        this.setupEventHandlers();
    }
    setCommandHandler(streamingService, videos) {
        this.commandHandler = new BotCommandHandler(this.streamStatus, streamingService, videos);
    }
    setupEventHandlers() {
        this.client.on('ready', () => {
            logger.info(`Bot ${this.client.user?.tag} is ready!`);
            this.updatePresence();
        });
        this.client.on('messageCreate', async (message) => {
            if (message.author.bot)
                return;
            if (message.guildId !== config.guildId)
                return;
            const originalContent = message.content;
            const content = message.content.toLowerCase();
            if (this.commandHandler && originalContent.startsWith(config.prefix)) {
                logger.info(`Bot received command: ${originalContent}`);
                const handled = await this.commandHandler.handleCommand(message);
                logger.info(`Command handled: ${handled}`);
                if (handled)
                    return;
            }
            if (content.includes('status') || content.includes('حالة') || content.includes('الحالة')) {
                await this.sendStatusEmbed(message);
            }
            else if (content.includes('queue') || content.includes('قائمة') || content.includes('الطابور')) {
                await this.sendQueueEmbed(message);
            }
            else if (content.includes('current') || content.includes('الحالي') || content.includes('الآن')) {
                await this.sendCurrentVideoEmbed(message);
            }
            if (this.isValidMediaLink(originalContent)) {
                logger.info(`Direct link detected from ${message.author.tag}: ${originalContent}`);
            }
        });
    }
    async sendStatusEmbed(message) {
        const embed = new EmbedBuilder()
            .setColor(0x000000)
            .setTitle('حالة البث')
            .addFields({ name: 'متصل بالقناة', value: this.streamStatus.joined ? 'نعم' : 'لا', inline: true }, { name: 'يتم التشغيل', value: this.streamStatus.playing ? 'نعم' : 'لا', inline: true }, { name: 'عدد الفيديوهات', value: `${this.streamStatus.queue.items.length}`, inline: true })
            .setTimestamp()
            .setFooter({ text: 'Blinders Studio Live' });
        await message.reply({ embeds: [embed] });
    }
    async sendQueueEmbed(message) {
        const queueItems = this.streamStatus.queue.items;
        const currentIndex = this.streamStatus.queue.currentIndex;
        const embed = new EmbedBuilder()
            .setColor(0x000000)
            .setTitle('قائمة الانتظار')
            .setTimestamp()
            .setFooter({ text: `Blinders Studio Live - ${queueItems.length} فيديو` });
        if (queueItems.length === 0) {
            embed.setDescription('القائمة فارغة حالياً');
        }
        else {
            let description = '';
            queueItems.forEach((item, index) => {
                const isCurrent = index === currentIndex && this.streamStatus.playing;
                const prefix = isCurrent ? '> ' : `${index + 1}. `;
                const status = isCurrent ? ' (يتم التشغيل)' : '';
                description += `${prefix}${item.title}${status}\n`;
            });
            embed.setDescription(description.substring(0, 4096));
        }
        await message.reply({ embeds: [embed] });
    }
    async sendCurrentVideoEmbed(message) {
        if (!this.streamStatus.playing) {
            const embed = new EmbedBuilder()
                .setColor(0x000000)
                .setTitle('لا يوجد تشغيل حالياً')
                .setDescription('لا يتم تشغيل أي فيديو في الوقت الحالي')
                .setTimestamp()
                .setFooter({ text: 'Blinders Studio Live' });
            await message.reply({ embeds: [embed] });
            return;
        }
        const currentItem = this.streamStatus.queue.items[this.streamStatus.queue.currentIndex];
        if (!currentItem) {
            await message.reply('لا يمكن العثور على معلومات الفيديو الحالي');
            return;
        }
        const embed = new EmbedBuilder()
            .setColor(0x000000)
            .setTitle('يتم التشغيل الآن')
            .addFields({ name: 'العنوان', value: currentItem.title, inline: false }, { name: 'طلب بواسطة', value: currentItem.requestedBy, inline: true }, { name: 'النوع', value: currentItem.type, inline: true }, { name: 'مباشر', value: currentItem.isLive ? 'نعم' : 'لا', inline: true })
            .setTimestamp()
            .setFooter({ text: 'Blinders Studio Live' });
        await message.reply({ embeds: [embed] });
    }
    updatePresence() {
        if (!this.client.user)
            return;
        if (this.streamStatus.playing) {
            const currentItem = this.streamStatus.queue.items[this.streamStatus.queue.currentIndex];
            const title = currentItem?.title || 'Unknown';
            this.client.user.setPresence({
                activities: [{
                        name: title,
                        type: ActivityType.Streaming,
                        url: 'https://twitch.tv/blindersstudio'
                    }],
                status: PresenceUpdateStatus.Online
            });
        }
        else {
            this.client.user.setPresence({
                activities: [{
                        name: 'Blinders Studio Live',
                        type: ActivityType.Watching
                    }],
                status: PresenceUpdateStatus.Idle
            });
        }
    }
    async login() {
        if (!config.botToken) {
            logger.warn('Bot token not provided, bot will not start');
            return;
        }
        try {
            await this.client.login(config.botToken);
        }
        catch (error) {
            logger.error('Failed to login bot:', error);
        }
    }
    getClient() {
        return this.client;
    }
    isValidMediaLink(text) {
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
}
//# sourceMappingURL=index.js.map