import { Streamer, Utils, prepareStream, playStream } from "@dank074/discord-video-stream";
import fs from 'fs';
import config from "../config.js";
import { MediaService } from './media.js';
import { QueueService } from './queue.js';
import { getVideoParams } from "../utils/ffmpeg.js";
import logger from '../utils/logger.js';
import { DiscordUtils, ErrorUtils } from '../utils/shared.js';
export class StreamingService {
    streamer;
    mediaService;
    queueService;
    controller = null;
    streamStatus;
    failedVideos = new Set();
    isSkipping = false;
    botUpdateCallback;
    constructor(client, streamStatus) {
        this.streamer = new Streamer(client);
        this.mediaService = new MediaService();
        this.queueService = new QueueService();
        this.streamStatus = streamStatus;
    }
    setBotUpdateCallback(callback) {
        this.botUpdateCallback = callback;
    }
    notifyBotUpdate() {
        if (this.botUpdateCallback) {
            this.botUpdateCallback();
        }
    }
    getStreamer() {
        return this.streamer;
    }
    getQueueService() {
        return this.queueService;
    }
    markVideoAsFailed(videoSource) {
        this.failedVideos.add(videoSource);
        logger.info(`Marked video as failed: ${videoSource}`);
    }
    async addToQueue(message, videoSource, title) {
        try {
            const username = message.author.username;
            let statusMsg = await message.reply('⏳ جاري معالجة الرابط...');
            const mediaSource = await this.mediaService.resolveMediaSource(videoSource);
            if (mediaSource) {
                if (mediaSource.type === 'youtube' && !mediaSource.isLive) {
                    await statusMsg.edit('📥 جاري تنزيل الفيديو من YouTube...');
                }
                else if (mediaSource.type === 'youtube' && mediaSource.isLive) {
                    await statusMsg.edit('🔴 جاري الاتصال بالبث المباشر...');
                }
                else if (mediaSource.type === 'twitch') {
                    await statusMsg.edit('🟣 جاري الاتصال ببث Twitch...');
                }
                else {
                    await statusMsg.edit('🔗 جاري معالجة الرابط...');
                }
                const queueItem = await this.queueService.addToQueue(mediaSource, username);
                await statusMsg.edit(`✅ تمت الإضافة للقائمة: **${mediaSource.title}**`);
                return true;
            }
            else {
                const queueItem = await this.queueService.add(videoSource, title || videoSource, username, 'url', false, videoSource);
                await statusMsg.edit(`✅ تمت الإضافة للقائمة`);
                return true;
            }
        }
        catch (error) {
            await ErrorUtils.handleError(error, `adding to queue: ${videoSource}`, message);
            await message.reply('❌ فشلت معالجة الرابط');
            return false;
        }
    }
    async playFromQueue(message) {
        if (this.streamStatus.playing) {
            await DiscordUtils.sendError(message, 'يتم تشغيل فيديو حالياً');
            return;
        }
        const nextItem = this.queueService.getNext();
        if (!nextItem) {
            await DiscordUtils.sendError(message, 'القائمة فارغة');
            return;
        }
        this.queueService.setPlaying(true);
        await this.playVideoFromQueueItem(message, nextItem);
    }
    async skipCurrent(message) {
        if (!this.streamStatus.playing) {
            await DiscordUtils.sendError(message, 'لا يوجد فيديو قيد التشغيل');
            return;
        }
        const queueLength = this.queueService.getLength();
        const isLastItem = queueLength <= 1;
        if (this.isSkipping && !isLastItem) {
            await DiscordUtils.sendError(message, 'جاري التخطي');
            return;
        }
        this.isSkipping = true;
        try {
            this.streamStatus.manualStop = true;
            this.controller?.abort();
            this.streamer.stopStream();
            const currentItem = this.queueService.getCurrent();
            const nextItem = this.queueService.skip();
            if (!nextItem) {
                await message.channel.send('انتهت القائمة');
                this.queueService.setPlaying(false);
                await this.cleanupStreamStatus();
                return;
            }
            this.streamStatus.manualStop = false;
            await this.playVideoFromQueueItem(message, nextItem);
        }
        finally {
            this.isSkipping = false;
        }
    }
    async playVideoFromQueueItem(message, queueItem) {
        this.queueService.setPlaying(true);
        let videoParams = undefined;
        if (config.respect_video_params) {
            videoParams = await this.getVideoParameters(queueItem.url);
        }
        logger.info(`Playing from queue: ${queueItem.title} (${queueItem.url})`);
        await this.playVideo(message, queueItem.url, queueItem.title, videoParams);
    }
    async getVideoParameters(videoUrl) {
        try {
            const resolution = await getVideoParams(videoUrl);
            logger.info(`Video parameters: ${resolution.width}x${resolution.height}, FPS: ${resolution.fps || 'unknown'}`);
            return {
                width: resolution.width,
                height: resolution.height,
                fps: resolution.fps
            };
        }
        catch (error) {
            await ErrorUtils.handleError(error, 'determining video parameters');
            return undefined;
        }
    }
    async ensureVoiceConnection(guildId, channelId, title) {
        try {
            if (this.streamer.voiceConnection) {
                logger.info('Voice connection already exists, reusing it');
                this.streamStatus.joined = true;
            }
            else {
                logger.info(`Joining voice channel: guild=${guildId}, channel=${channelId}`);
                const joinWithTimeout = Promise.race([
                    this.streamer.joinVoice(guildId, channelId),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Join timeout')), 5000))
                ]);
                try {
                    await joinWithTimeout;
                    logger.info('joinVoice completed');
                }
                catch (err) {
                    if (err.message === 'Join timeout') {
                        logger.warn('joinVoice timed out, checking if connected anyway...');
                        await new Promise(r => setTimeout(r, 2000));
                    }
                    else {
                        throw err;
                    }
                }
                this.streamStatus.joined = true;
            }
            this.streamStatus.playing = true;
            this.streamStatus.channelInfo = { guildId, channelId, cmdChannelId: config.cmdChannelId };
            if (title) {
                this.streamer.client.user?.setActivity(DiscordUtils.status_watch(title));
            }
            this.notifyBotUpdate();
            logger.info('Waiting for voice connection to stabilize...');
            await new Promise(resolve => setTimeout(resolve, 2000));
            if (!this.streamer.voiceConnection) {
                throw new Error('Voice connection was not established properly');
            }
            logger.info('Voice connection is ready for streaming');
        }
        catch (error) {
            logger.error('Failed to setup voice connection:', error);
            this.streamStatus.joined = false;
            throw new Error(`Cannot join voice channel: ${error.message || 'Unknown error'}`);
        }
    }
    setupStreamConfiguration(videoParams) {
        return {
            width: 1280,
            height: 720,
            frameRate: 30,
            bitrateVideo: 2500,
            bitrateVideoMax: 4000,
            hardwareAcceleratedDecoding: false,
            videoCodec: Utils.normalizeVideoCodec('H264')
        };
    }
    async executeStream(inputForFfmpeg, streamOpts, message, title, videoSource) {
        logger.info(`=== Starting Stream Execution ===`);
        logger.info(`Title: ${title}`);
        logger.info(`Input type: ${typeof inputForFfmpeg === 'string' ? 'URL/Path' : 'Buffer/Stream'}`);
        logger.info(`Stream dimensions: ${streamOpts.width}x${streamOpts.height} @ ${streamOpts.frameRate}fps`);
        logger.info(`Video codec: ${streamOpts.videoCodec}`);
        if (!this.streamer.voiceConnection) {
            throw new Error('No voice connection available for streaming');
        }
        logger.info('Voice connection verified, preparing FFmpeg...');
        const { command, output: ffmpegOutput } = prepareStream(inputForFfmpeg, streamOpts, this.controller.signal);
        let hasError = false;
        command.on("error", (err, stdout, stderr) => {
            if (!this.streamStatus.manualStop && this.controller && !this.controller.signal.aborted) {
                hasError = true;
                logger.error("=== FFmpeg Error ===");
                logger.error("Error message:", err.message);
                logger.error("Error stack:", err.stack);
                if (stderr && stderr.length > 0) {
                    const stderrStr = stderr.toString();
                    const errorSnippet = stderrStr.slice(-1000);
                    logger.error("FFmpeg stderr:", errorSnippet);
                }
                if (stdout && stdout.length > 0) {
                    const stdoutStr = stdout.toString();
                    logger.error("FFmpeg stdout:", stdoutStr.slice(-500));
                }
                const errorMsg = this.getFriendlyErrorMessage(err.message, stderr?.toString());
                DiscordUtils.sendError(message, errorMsg).catch(e => logger.error('Failed to send error message:', e));
                this.controller.abort();
            }
        });
        command.on("start", (commandLine) => {
            logger.info(`=== FFmpeg Started ===`);
            logger.info(`Full command: ${commandLine}`);
        });
        command.on("end", (stdout, stderr) => {
            logger.info(`=== FFmpeg Ended Normally ===`);
        });
        command.on("stderr", (stderrLine) => {
            if (stderrLine.includes('frame=') || stderrLine.includes('time=')) {
                logger.debug(`FFmpeg: ${stderrLine}`);
            }
        });
        try {
            logger.info(`=== Starting playStream ===`);
            logger.info(`Voice connection status: ${this.streamer.voiceConnection ? 'Connected' : 'Disconnected'}`);
            await playStream(ffmpegOutput, this.streamer, undefined, this.controller.signal);
            logger.info(`=== playStream completed successfully ===`);
        }
        catch (err) {
            if (this.controller && !this.controller.signal.aborted && !this.streamStatus.manualStop) {
                hasError = true;
                logger.error('playStream error:', err.message);
                const errorMsg = this.getFriendlyErrorMessage(err.message);
                DiscordUtils.sendError(message, errorMsg).catch(e => logger.error('Failed to send error message:', e));
            }
            if (this.controller && !this.controller.signal.aborted)
                this.controller.abort();
        }
        if (!hasError && !this.streamStatus.manualStop && this.controller && !this.controller.signal.aborted) {
            logger.info(`Finished playing: ${title || videoSource}`);
        }
        else if (this.streamStatus.manualStop) {
            logger.info(`Stopped playing: ${title || videoSource}`);
        }
        else if (hasError) {
            logger.warn(`Failed playing: ${title || videoSource}`);
        }
    }
    getFriendlyErrorMessage(errorMsg, stderr) {
        const msg = (errorMsg + ' ' + (stderr || '')).toLowerCase();
        if (msg.includes('no such file') || msg.includes('does not exist')) {
            return 'الملف غير موجود';
        }
        else if (msg.includes('invalid data') || msg.includes('invalid argument') || msg.includes('invalid stream')) {
            return 'الفيديو تالف أو غير صالح';
        }
        else if (msg.includes('connection') || msg.includes('network') || msg.includes('i/o error')) {
            return 'خطأ في الاتصال';
        }
        else if (msg.includes('codec') || msg.includes('format') || msg.includes('not supported')) {
            return 'صيغة الفيديو غير مدعومة';
        }
        else if (msg.includes('permission denied') || msg.includes('access denied')) {
            return 'لا توجد صلاحيات';
        }
        else if (msg.includes('timeout') || msg.includes('timed out')) {
            return 'انتهت المهلة';
        }
        else if (msg.includes('moov atom not found') || msg.includes('could not find codec')) {
            return 'الفيديو غير مكتمل أو تالف';
        }
        else {
            return 'خطأ في معالجة الفيديو';
        }
    }
    async handleQueueAdvancement(message, wasError = false) {
        if (!wasError) {
            await DiscordUtils.sendFinishMessage(message);
        }
        const finishedItem = this.queueService.getCurrent();
        if (finishedItem) {
            this.queueService.removeFromQueue(finishedItem.id);
        }
        const nextItem = this.queueService.getNext();
        if (nextItem) {
            logger.info(`Auto-playing next item from queue: ${nextItem.title}`);
            const delay = wasError ? 2000 : 1000;
            setTimeout(() => {
                this.playVideoFromQueueItem(message, nextItem).catch(err => {
                    ErrorUtils.handleError(err, 'auto-playing next item');
                    this.handleQueueAdvancement(message, true).catch(e => logger.error('Failed to advance queue after error:', e));
                });
            }, delay);
        }
        else {
            this.queueService.setPlaying(false);
            logger.info('No more items in queue, playback stopped');
            await this.cleanupStreamStatus();
        }
    }
    async handleDownload(message, videoSource, title) {
        try {
            logger.info(`Downloading ${title || videoSource}...`);
            await message.channel.send(`📥 جاري تنزيل: **${title || 'الفيديو'}**`);
            const tempFilePath = await this.mediaService.downloadYouTubeVideo(videoSource);
            if (tempFilePath) {
                logger.info(`Finished downloading ${title || videoSource}`);
                await message.channel.send(`✅ اكتمل التنزيل: **${title || 'الفيديو'}**`);
                return tempFilePath;
            }
            throw new Error('Download failed, no temp file path returned.');
        }
        catch (error) {
            logger.error(`Failed to download YouTube video: ${videoSource}`, error);
            await message.channel.send(`❌ فشل التنزيل: **${title || 'الفيديو'}**`);
            return null;
        }
    }
    async prepareVideoSource(message, videoSource, title) {
        const mediaSource = await this.mediaService.resolveMediaSource(videoSource);
        if (mediaSource && mediaSource.type === 'youtube') {
            logger.info('Extracting direct video URL from YouTube');
            try {
                const { exec } = await import('child_process');
                const { promisify } = await import('util');
                const execAsync = promisify(exec);
                const ytDlpPath = './scripts/yt-dlp';
                const format = mediaSource.isLive ? 'best' : '18/best[height<=720]/best';
                const { stdout } = await execAsync(`${ytDlpPath} -f "${format}" -g "${videoSource}"`, { maxBuffer: 1024 * 1024 * 10 });
                const directUrl = stdout.trim().split('\n')[0];
                logger.info('Got direct URL for streaming');
                return { inputForFfmpeg: directUrl, tempFilePath: null };
            }
            catch (error) {
                logger.error('Failed to extract direct URL, falling back to download');
                const tempFilePath = await this.handleDownload(message, videoSource, title);
                if (tempFilePath) {
                    return { inputForFfmpeg: tempFilePath, tempFilePath };
                }
                throw new Error('Failed to prepare video source');
            }
        }
        logger.info('Using direct stream URL');
        return { inputForFfmpeg: mediaSource ? mediaSource.url : videoSource, tempFilePath: null };
    }
    async executeStreamWorkflow(input, options, message, title, source) {
        this.controller = new AbortController();
        await this.executeStream(input, options, message, title, source);
    }
    async finalizeStream(message, tempFile, hadError = false) {
        if (!this.streamStatus.manualStop && this.controller && !this.controller.signal.aborted) {
            await this.handleQueueAdvancement(message, hadError);
        }
        else {
            this.queueService.setPlaying(false);
            this.queueService.resetCurrentIndex();
            await this.cleanupStreamStatus();
        }
        if (tempFile) {
            try {
                if (fs.existsSync(tempFile)) {
                    fs.unlinkSync(tempFile);
                    logger.info(`Deleted temp file: ${tempFile}`);
                }
            }
            catch (cleanupError) {
                logger.error(`Failed to delete temp file ${tempFile}:`, cleanupError);
            }
        }
    }
    async playVideo(message, videoSource, title, videoParams) {
        const [guildId, channelId] = [config.guildId, config.videoChannelId];
        this.streamStatus.manualStop = false;
        if (title) {
            const currentQueueItem = this.queueService.getCurrent();
            if (currentQueueItem?.title === title) {
                this.queueService.setPlaying(true);
            }
        }
        let tempFile = null;
        let hadError = false;
        try {
            const { inputForFfmpeg, tempFilePath } = await this.prepareVideoSource(message, videoSource, title);
            tempFile = tempFilePath;
            await this.ensureVoiceConnection(guildId, channelId, title);
            await DiscordUtils.sendPlaying(message, title || videoSource);
            const streamOpts = this.setupStreamConfiguration(videoParams);
            await this.executeStreamWorkflow(inputForFfmpeg, streamOpts, message, title || videoSource, videoSource);
        }
        catch (error) {
            hadError = true;
            await ErrorUtils.handleError(error, `playing video: ${title || videoSource}`);
            if (this.controller && !this.controller.signal.aborted)
                this.controller.abort();
            this.markVideoAsFailed(videoSource);
            let errorText = `╔═══════════════════════════════════╗\n⚠️ **فشل التشغيل**\n╚═══════════════════════════════════╝\n`;
            errorText += `🎬 \`${title || videoSource}\`\n`;
            errorText += `❌ حدث خطأ أثناء التشغيل\n`;
            const queueLength = this.queueService.getLength();
            if (queueLength > 0) {
                errorText += `\n⏭️ سيتم تشغيل الفيديو التالي...\n`;
            }
            errorText += `\n═══════════════════════════════════`;
            await message.channel.send(errorText).catch(e => logger.error('Failed to send error notification:', e));
        }
        finally {
            await this.finalizeStream(message, tempFile, hadError);
        }
    }
    async cleanupStreamStatus() {
        try {
            this.controller?.abort();
            this.streamer.stopStream();
            const hasQueueItems = !this.queueService.isEmpty();
            if (!hasQueueItems) {
                this.streamer.leaveVoice();
                this.streamStatus.joined = false;
                this.streamStatus.joinsucc = false;
            }
            this.streamer.client.user?.setActivity(DiscordUtils.status_idle());
            this.streamStatus.playing = false;
            this.streamStatus.manualStop = false;
            this.streamStatus.channelInfo = {
                guildId: "",
                channelId: "",
                cmdChannelId: "",
            };
            this.notifyBotUpdate();
        }
        catch (error) {
            await ErrorUtils.handleError(error, "cleanup stream status");
        }
    }
    async stopAndClearQueue() {
        this.queueService.clearQueue();
        logger.info("Queue cleared by stop command");
        await this.cleanupStreamStatus();
    }
}
//# sourceMappingURL=streaming.js.map