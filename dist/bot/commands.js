import config from '../config.js';
import logger from '../utils/logger.js';
import fs from 'fs';
import path from 'path';
export class BotCommandHandler {
    streamStatus;
    streamingService;
    videos;
    constructor(streamStatus, streamingService, videos) {
        this.streamStatus = streamStatus;
        this.streamingService = streamingService;
        this.videos = videos;
    }
    async handleCommand(message) {
        const content = message.content;
        if (!content.startsWith(config.prefix)) {
            return false;
        }
        const args = content.slice(config.prefix.length).trim().split(/ +/);
        const command = args.shift()?.toLowerCase();
        if (!command)
            return false;
        logger.info(`Bot handling command: ${command} from ${message.author.tag}`);
        try {
            switch (command) {
                case 'play':
                    await this.handlePlay(message, args);
                    return true;
                case 'skip':
                    await this.handleSkip(message);
                    return true;
                case 'stop':
                    await this.handleStop(message);
                    return true;
                case 'list':
                    await this.handleList(message);
                    return true;
                case 'cleanup':
                case 'clean':
                case 'cleancache':
                case 'cleartemp':
                case 'cc':
                    await this.handleCleanup(message);
                    return true;
                case 'queue':
                    await this.handleQueue(message);
                    return true;
                case 'status':
                    await this.handleStatus(message);
                    return true;
                case 'help':
                    await this.handleHelp(message);
                    return true;
                default:
                    logger.warn(`Unknown command: ${command}`);
                    return false;
            }
        }
        catch (error) {
            logger.error('Error handling bot command:', error);
            await message.reply('❌ حدث خطأ أثناء تنفيذ الأمر');
            return true;
        }
    }
    async handlePlay(message, args) {
        const input = args.join(' ');
        logger.info(`Play command: input="${input}"`);
        if (!input) {
            await message.reply(`⚠️ **الرجاء إضافة رابط**\n\n` +
                `**الاستخدام:**\n` +
                `${config.prefix}play https://youtube.com/watch?v=...\n\n` +
                `**أو** أرسل الرابط مباشرة بدون أمر!`);
            return;
        }
        if (!this.isValidMediaLink(input)) {
            await message.reply('❌ الرجاء إرسال رابط صحيح (YouTube أو Twitch)');
            return;
        }
        logger.info(`Adding to queue: ${input}`);
        const success = await this.streamingService.addToQueue(message, input);
        logger.info(`Add to queue result: ${success}, playing: ${this.streamStatus.playing}`);
        if (success && !this.streamStatus.playing) {
            logger.info('Starting playback from queue');
            await this.streamingService.playFromQueue(message);
        }
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
    async handleSkip(message) {
        if (!this.streamStatus.playing) {
            await message.reply('لا يوجد فيديو قيد التشغيل');
            return;
        }
        await this.streamingService.skipCurrent(message);
    }
    async handleStop(message) {
        if (!this.streamStatus.joined) {
            await message.reply('البوت غير متصل');
            return;
        }
        this.streamStatus.manualStop = true;
        await message.reply('تم الإيقاف وتفريغ القائمة');
        await this.streamingService.stopAndClearQueue();
    }
    async handleList(message) {
        const videoFiles = fs.readdirSync(config.videosDir);
        const videos = videoFiles.map(file => {
            const fileName = path.parse(file).name;
            return fileName;
        });
        if (videos.length === 0) {
            await message.reply('لا توجد فيديوهات محلية');
            return;
        }
        let listText = `الفيديوهات المحلية (${videos.length}):\n\n`;
        videos.forEach((video, index) => {
            listText += `${index + 1}. ${video}\n`;
        });
        await message.reply(listText);
    }
    async handleCleanup(message) {
        let totalDeleted = 0;
        let totalSize = 0;
        if (fs.existsSync(config.previewCacheDir)) {
            try {
                const cacheFiles = fs.readdirSync(config.previewCacheDir);
                for (const file of cacheFiles) {
                    try {
                        const filePath = path.join(config.previewCacheDir, file);
                        const stats = fs.statSync(filePath);
                        totalSize += stats.size;
                        fs.unlinkSync(filePath);
                        totalDeleted++;
                    }
                    catch (error) {
                        logger.error(`Failed to delete cache file ${file}:`, error);
                    }
                }
            }
            catch (error) {
                logger.error('Failed to read preview cache directory:', error);
            }
        }
        try {
            const tempDir = require('os').tmpdir();
            const tempFiles = fs.readdirSync(tempDir);
            const ytdlpFiles = tempFiles.filter(file => file.startsWith('ytdlp_temp_'));
            for (const file of ytdlpFiles) {
                try {
                    const filePath = path.join(tempDir, file);
                    if (fs.existsSync(filePath)) {
                        const stats = fs.statSync(filePath);
                        totalSize += stats.size;
                        fs.unlinkSync(filePath);
                        totalDeleted++;
                    }
                }
                catch (error) {
                    logger.error(`Failed to delete temp file ${file}:`, error);
                }
            }
        }
        catch (error) {
            logger.error('Failed to clean temp directory:', error);
        }
        const sizeInMB = (totalSize / (1024 * 1024)).toFixed(2);
        const sizeInKB = (totalSize / 1024).toFixed(2);
        const sizeDisplay = totalSize > 1024 * 1024 ? `${sizeInMB} MB` : `${sizeInKB} KB`;
        if (totalDeleted === 0) {
            await message.reply('✨ النظام نظيف بالفعل');
        }
        else {
            await message.reply(`✅ تم التنظيف: ${totalDeleted} ملف - ${sizeDisplay}`);
        }
    }
    async handleQueue(message) {
        const queueItems = this.streamingService.getQueueService().getQueue();
        const currentItem = this.streamingService.getQueueService().getCurrent();
        const queueStatus = this.streamingService.getQueueService().getQueueStatus();
        if (queueItems.length === 0) {
            await message.reply('القائمة فارغة');
            return;
        }
        let queueText = `قائمة الانتظار (${queueItems.length} فيديو):\n\n`;
        if (queueStatus.isPlaying && currentItem) {
            const title = currentItem.resolved ? currentItem.title : `${currentItem.title} (جاري التحميل)`;
            queueText += `> يتم التشغيل: ${title}\n  طلب بواسطة: ${currentItem.requestedBy}\n\n`;
        }
        const upcomingItems = queueItems.filter(item => !queueStatus.isPlaying || item.id !== currentItem?.id);
        if (upcomingItems.length > 0) {
            queueText += 'القادم:\n';
            upcomingItems.forEach((item, index) => {
                const position = queueStatus.isPlaying ? index + 1 : index;
                const title = item.resolved ? item.title : `${item.title} (معلق)`;
                queueText += `${position + 1}. ${title} - ${item.requestedBy}\n`;
            });
        }
        await message.reply(queueText);
    }
    async handleStatus(message) {
        const queueLength = this.streamingService.getQueueService().getLength();
        const currentItem = this.streamingService.getQueueService().getCurrent();
        let statusText = `حالة البوت:\n`;
        statusText += `متصل: ${this.streamStatus.joined ? 'نعم' : 'لا'}\n`;
        statusText += `يتم التشغيل: ${this.streamStatus.playing ? 'نعم' : 'لا'}\n`;
        statusText += `عدد الفيديوهات: ${queueLength}\n`;
        if (this.streamStatus.playing && currentItem) {
            statusText += `\nالفيديو الحالي: ${currentItem.title}\n`;
            statusText += `طلب بواسطة: ${currentItem.requestedBy}`;
        }
        await message.reply(statusText);
    }
    async handleHelp(message) {
        const { EmbedBuilder } = await import('discord.js');
        const embed = new EmbedBuilder()
            .setColor(0x000000)
            .setTitle('📖 المساعدة')
            .setDescription(`**كيفية الاستخدام:**\n` +
            `🔗 لتشغيل فيديو: أرسل رابط YouTube أو Twitch مباشرة\n` +
            `مثال: \`https://youtube.com/watch?v=...\`\n\n` +
            `**الأوامر المتاحة:**\n` +
            `${config.prefix}skip - تخطي الفيديو الحالي\n` +
            `${config.prefix}stop - إيقاف وتفريغ القائمة\n` +
            `${config.prefix}queue - عرض قائمة الانتظار\n` +
            `${config.prefix}status - حالة البث\n` +
            `${config.prefix}list - الفيديوهات المحلية\n` +
            `${config.prefix}cleancache - تنظيف الملفات المؤقتة\n` +
            `${config.prefix}help - عرض المساعدة\n\n` +
            `💡 **نصيحة:** يمكنك إرسال عدة روابط وسيتم إضافتها للقائمة تلقائياً`)
            .setThumbnail('https://i.ibb.co/PGgV1Z5t/482fbc28f6312f50.png')
            .setTimestamp()
            .setFooter({ text: 'Blinders Studio Live' });
        await message.reply({ embeds: [embed] });
    }
}
//# sourceMappingURL=commands.js.map