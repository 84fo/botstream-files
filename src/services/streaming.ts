import { Client, Message } from "discord.js-selfbot-v13";
import { Streamer, Utils, prepareStream, playStream, Encoders } from "@dank074/discord-video-stream";
import fs from 'fs';
import path from 'path';
import config from "../config.js";
import { MediaService } from './media.js';
import { QueueService } from './queue.js';
import { getVideoParams } from "../utils/ffmpeg.js";
import logger from '../utils/logger.js';
import { DiscordUtils, ErrorUtils, GeneralUtils } from '../utils/shared.js';
import { QueueItem, StreamStatus } from '../types/index.js';

export class StreamingService {
 	private streamer: Streamer;
 	private mediaService: MediaService;
 	private queueService: QueueService;
 	private controller: AbortController | null = null;
 	private streamStatus: StreamStatus;
 	private failedVideos: Set<string> = new Set();
 	private isSkipping: boolean = false;
 	private botUpdateCallback?: () => void;
	private botNotifyPlaying?: (title: string) => void;
	private botNotifyFinished?: (title: string) => void;
	private botNotifyError?: (title: string) => void;
	private autoPlayCallback?: () => void;

 	constructor(client: Client, streamStatus: StreamStatus) {
 		// Use default settings like official example (no custom options)
 		this.streamer = new Streamer(client);
 		this.mediaService = new MediaService();
 		this.queueService = new QueueService();
 		this.streamStatus = streamStatus;
 	}

	public setBotUpdateCallback(callback: () => void): void {
		this.botUpdateCallback = callback;
	}

	public setBotNotifyCallbacks(
		onPlaying: (title: string) => void,
		onFinished: (title: string) => void,
		onError: (title: string) => void
	): void {
		this.botNotifyPlaying = onPlaying;
		this.botNotifyFinished = onFinished;
		this.botNotifyError = onError;
	}

	public setAutoPlayCallback(cb: () => void): void {
		this.autoPlayCallback = cb;
	}

	private notifyBotUpdate(): void {
		if (this.botUpdateCallback) {
			this.botUpdateCallback();
		}
	}

	public getStreamer(): Streamer {
		return this.streamer;
	}

	public getQueueService(): QueueService {
		return this.queueService;
	}

	private markVideoAsFailed(videoSource: string): void {
		this.failedVideos.add(videoSource);
		logger.info(`Marked video as failed: ${videoSource}`);
	}

	public async addToQueue(
		message: Message,
		videoSource: string,
		title?: string
	): Promise<{ title: string } | null> {
		try {
			const username = message.author.username;
			const mediaSource = await this.mediaService.resolveMediaSource(videoSource);

			let queueItem;
			if (mediaSource) {
				queueItem = await this.queueService.addToQueue(mediaSource, username);
			} else {
				// Only fall back if it is a valid URL or local file
				if (GeneralUtils.isValidUrl(videoSource) || GeneralUtils.isLocalFile(videoSource)) {
					queueItem = await this.queueService.add(
						videoSource,
						title || videoSource,
						username,
						'url',
						false,
						videoSource
					);
				} else {
					logger.warn(`Failed to resolve non-URL/local source: ${videoSource}`);
					return null;
				}
			}

			// Auto-play if nothing is currently playing
			if (!this.streamStatus.playing && this.autoPlayCallback) {
				logger.info(`Auto-play triggered for: ${queueItem.title}`);
				setTimeout(() => this.autoPlayCallback!(), 100);
			}

			return { title: queueItem.title };
		} catch (error) {
			await ErrorUtils.handleError(error, `adding to queue: ${videoSource}`);
			return null;
		}
	}


	public async playFromQueue(message?: any): Promise<void> {
		if (this.streamStatus.playing) {
			logger.info('playFromQueue: already playing, skipping');
			return;
		}

		const nextItem = this.queueService.getNext();
		if (!nextItem) {
			logger.info('playFromQueue: queue is empty');
			return;
		}

		logger.info(`playFromQueue: starting ${nextItem.title}`);
		this.streamStatus.playing = true; // Immediate concurrency lock
		this.queueService.setPlaying(true);
		const msg = message || await this.createChannelProxy();
		await this.playVideoFromQueueItem(msg, nextItem);
	}

	private async createChannelProxy(): Promise<any> {
		const client = this.streamer.client;
		try {
			const channel = await client.channels.fetch(config.cmdChannelId);
			if (channel && 'send' in channel) {
				const proxy = {
					author: { username: 'AutoPlay', id: '0' },
					channel,
					reply: async (_content: any) => {
						return { edit: async (_c: any) => {} };
					}
				};
				return proxy;
			}
		} catch (e) {
			logger.warn('Could not fetch channel for proxy:', e);
		}
		return {
			author: { username: 'AutoPlay', id: '0' },
			channel: { send: async (_c: any) => {} },
			reply: async (_c: any) => ({ edit: async (_c: any) => {} })
		};
	}

	public async skipCurrent(message: Message): Promise<void> {
		if (!this.streamStatus.playing) return;

		const queueLength = this.queueService.getLength();
		const isLastItem = queueLength <= 1;

		if (this.isSkipping && !isLastItem) return;

		this.isSkipping = true;
		try {
			this.streamStatus.manualStop = true;
			this.controller?.abort();
			this.streamer.stopStream();

			const nextItem = this.queueService.skip();

			if (!nextItem) {
				this.queueService.setPlaying(false);
				await this.cleanupStreamStatus();
				return;
			}

			this.streamStatus.manualStop = false;
			await this.playVideoFromQueueItem(message, nextItem);
		} finally {
			this.isSkipping = false;
		}
	}

	private async playVideoFromQueueItem(message: Message, queueItem: QueueItem): Promise<void> {
		// Ensure queue is marked as playing
		this.queueService.setPlaying(true);

		// Collect video parameters if respect_video_params is enabled
		let videoParams = undefined;
		if (config.respect_video_params) {
			videoParams = await this.getVideoParameters(queueItem.url);
		}

		// Log playing video
		logger.info(`Playing from queue: ${queueItem.title} (${queueItem.url})`);

		// Use streaming service to play the video with video parameters
		await this.playVideo(message, queueItem.url, queueItem.title, videoParams);
	}

	private async getVideoParameters(videoUrl: string): Promise<{ width: number, height: number, fps?: number, bitrate?: string } | undefined> {
		try {
			const resolution = await getVideoParams(videoUrl);
			logger.info(`Video parameters: ${resolution.width}x${resolution.height}, FPS: ${resolution.fps || 'unknown'}`);
			return {
				width: resolution.width,
				height: resolution.height,
				fps: resolution.fps
			};
		} catch (error) {
			await ErrorUtils.handleError(error, 'determining video parameters');
			return undefined;
		}
	}

	private async ensureVoiceConnection(guildId: string, channelId: string, title?: string): Promise<void> {
		try {
			// Check if already have a valid connection
			if (this.streamer.voiceConnection) {
				logger.info('Voice connection already exists, reusing it');
				this.streamStatus.joined = true;
			} else {
				// Join voice channel with timeout
				logger.info(`Joining voice channel: guild=${guildId}, channel=${channelId}`);
				
				// Wrap joinVoice with timeout
				const joinWithTimeout = Promise.race([
					this.streamer.joinVoice(guildId, channelId),
					new Promise((_, reject) => 
						setTimeout(() => reject(new Error('Join timeout')), 5000)
					)
				]);
				
				try {
					await joinWithTimeout;
					logger.info('joinVoice completed');
				} catch (err: any) {
					if (err.message === 'Join timeout') {
						logger.warn('joinVoice timed out, checking if connected anyway...');
						await new Promise(r => setTimeout(r, 2000));
					} else {
						throw err;
					}
				}
				
				// Mark as joined
				this.streamStatus.joined = true;
			}
			
			// Set playing status
			this.streamStatus.playing = true;
			this.streamStatus.channelInfo = { guildId, channelId, cmdChannelId: config.cmdChannelId! };

			if (title) {
				this.streamer.client.user?.setActivity(DiscordUtils.status_watch(title));
			}

			// Notify bot to update presence
			this.notifyBotUpdate();

			// Wait for voice connection to be fully ready
			logger.info('Waiting for voice connection to stabilize...');
			await new Promise(resolve => setTimeout(resolve, 2000));

			// Verify voice connection exists
			if (!this.streamer.voiceConnection) {
				throw new Error('Voice connection was not established properly');
			}
			
			logger.info('Voice connection is ready for streaming');
			
		} catch (error: any) {
			logger.error('Failed to setup voice connection:', error);
			this.streamStatus.joined = false;
			throw new Error(`Cannot join voice channel: ${error.message || 'Unknown error'}`);
		}
	}

	private setupStreamConfiguration(videoParams?: { width: number, height: number, fps?: number, bitrate?: string }): any {
		const width = videoParams?.width || config.width;
		const height = videoParams?.height || config.height;
		const frameRate = videoParams?.fps || config.fps;
		const preset = config.h26xPreset || 'ultrafast';

		return {
			encoder: Encoders.software({ x264: { preset }, x265: { preset } }),
			width,
			height,
			frameRate,
			bitrateVideo: config.bitrateKbps,
			bitrateVideoMax: config.maxBitrateKbps,
			videoCodec: Utils.normalizeVideoCodec(config.videoCodec),
			hardwareAcceleratedDecoding: config.hardwareAcceleratedDecoding,
			minimizeLatency: true,
		};
	}

	private async executeStream(inputForFfmpeg: any, streamOpts: any, message: Message, title: string, videoSource: string): Promise<void> {
		logger.info(`=== Starting Stream: ${title} ===`);
		
		if (!this.streamer.voiceConnection) {
			throw new Error('No voice connection available for streaming');
		}

		let hasError = false;
		let transcodedFile: string | null = null;

		try {
			const isLocalFile = typeof inputForFfmpeg === 'string' && 
				!inputForFfmpeg.startsWith('http') && 
				fs.existsSync(inputForFfmpeg);

			const isHlsStream = typeof inputForFfmpeg === 'string' &&
				(inputForFfmpeg.includes('.m3u8') || inputForFfmpeg.includes('hls_playlist') || inputForFfmpeg.includes('/manifest/'));

			let streamInput: any;
			let hlsProc: any = null;

			if (isLocalFile) {
				// Transcode to mp4 with h264+aac, then let the library handle h264_mp4toannexb
				// This keeps the AVCC extradata intact so dump_extra works correctly
				logger.info(`Transcoding to mp4 for streaming: ${inputForFfmpeg}`);
				transcodedFile = await this.transcodeToFile(inputForFfmpeg, streamOpts);
				logger.info(`Transcoded file ready: ${transcodedFile}`);
				const { createReadStream } = await import('fs');
				streamInput = createReadStream(transcodedFile);
			} else if (isHlsStream) {
				// HLS/Live streams need special FFmpeg handling with reconnect flags
				logger.info(`Starting HLS live stream: ${inputForFfmpeg.substring(0, 80)}...`);
				const { spawn } = await import('child_process');
				const ffmpegBin = path.resolve(process.cwd(), 'ffmpeg_extracted', 'ffmpeg-master-latest-win64-gpl', 'bin', 'ffmpeg.exe');
				const ffmpegCmd = fs.existsSync(ffmpegBin) ? ffmpegBin : 'ffmpeg';
				const preset = config.h26xPreset || 'ultrafast';

				const hlsArgs = [
					'-reconnect', '1',
					'-reconnect_streamed', '1',
					'-reconnect_delay_max', '5',
					'-i', inputForFfmpeg,
					'-c:v', 'libx264',
					'-preset', preset,
					'-tune', 'zerolatency',
					'-b:v', `${streamOpts.bitrateVideo || config.bitrateKbps}k`,
					'-maxrate', `${streamOpts.bitrateVideoMax || config.maxBitrateKbps}k`,
					'-bufsize', `${(streamOpts.bitrateVideoMax || config.maxBitrateKbps) * 2}k`,
					'-bf', '0',
					'-pix_fmt', 'yuv420p',
					'-vf', `scale=${streamOpts.width || config.width}:${streamOpts.height || config.height}`,
					'-c:a', 'libopus',
					'-b:a', '128k',
					'-ar', '48000',
					'-ac', '2',
					'-f', 'matroska',
					'-'
				];

				hlsProc = spawn(ffmpegCmd, hlsArgs, {
					windowsHide: true,
					stdio: ['ignore', 'pipe', 'pipe']
				});

				hlsProc.stderr?.on('data', (d: Buffer) => {
					const msg = d.toString();
					if (msg.includes('Error') && !msg.includes('Non-monoton')) {
						logger.error(`FFmpeg HLS: ${msg.trim().substring(0, 200)}`);
					}
				});

				hlsProc.on('error', (err: any) => {
					if (!this.streamStatus.manualStop && this.controller && !this.controller.signal.aborted) {
						hasError = true;
						logger.error(`FFmpeg HLS process error: ${err.message}`);
						this.controller.abort();
					}
				});

				// Kill FFmpeg on abort
				this.controller!.signal.addEventListener('abort', () => {
					try { hlsProc?.kill('SIGTERM'); } catch {}
				});

				logger.info('FFmpeg started for HLS live stream');
				streamInput = hlsProc.stdout;
			} else {
				const { command, output: ffmpegOutput } = prepareStream(inputForFfmpeg, streamOpts, this.controller!.signal);
				command.on("error", (err: any) => {
					if (!this.streamStatus.manualStop && this.controller && !this.controller.signal.aborted) {
						hasError = true;
						logger.error("FFmpeg Error:", err.message);
						this.controller.abort();
					}
				});
				command.on("start", () => logger.info(`FFmpeg started for URL stream`));
				streamInput = ffmpegOutput;
			}

			await playStream(streamInput, this.streamer, {
				type: "go-live",
				format: "matroska"
			}, this.controller!.signal);

			logger.info(`=== Stream finished: ${title} ===`);

		} catch (err: any) {
			if (this.controller && !this.controller.signal.aborted && !this.streamStatus.manualStop) {
				hasError = true;
				logger.error('Stream error:', err.message || String(err));
			}
			if (this.controller && !this.controller.signal.aborted) this.controller.abort();
		} finally {
			// cleanup transcoded file
			if (transcodedFile) {
				try { fs.existsSync(transcodedFile) && fs.unlinkSync(transcodedFile); } catch {}
			}
		}

		if (this.streamStatus.manualStop) logger.info(`Stopped: ${title}`);
		else if (hasError) logger.warn(`Failed: ${title}`);
		else logger.info(`Done: ${title}`);
	}

	private async transcodeToFile(inputPath: string, streamOpts: any): Promise<string> {
		const os = await import('os');
		const crypto = await import('crypto');
		const { spawn } = await import('child_process');

		const ffmpegBin = path.resolve(process.cwd(), 'ffmpeg_extracted', 'ffmpeg-master-latest-win64-gpl', 'bin', 'ffmpeg.exe');
		// Output mp4 with AVCC — library's h264_mp4toannexb converts it correctly
		const outPath = path.join(os.tmpdir(), `transcode_${crypto.randomBytes(6).toString('hex')}.mkv`);
		const preset = streamOpts.h26xPreset || config.h26xPreset || 'ultrafast';
		const width = streamOpts.width || config.width;
		const height = streamOpts.height || config.height;
		const bitrate = streamOpts.bitrateVideo || config.bitrateKbps;
		const maxBitrate = streamOpts.bitrateVideoMax || config.maxBitrateKbps;

		return new Promise((resolve, reject) => {
			const args = [
				'-i', inputPath,
				'-c:v', 'libx264',
				'-preset', preset,
				'-tune', 'zerolatency',
				'-b:v', `${bitrate}k`,
				'-maxrate', `${maxBitrate}k`,
				'-bufsize', `${maxBitrate * 2}k`,
				'-bf', '0',
				'-pix_fmt', 'yuv420p',
				'-vf', `scale=${width}:${height}`,
				'-force_key_frames', 'expr:gte(t,n_forced*1)',
				// NO -bsf:v — keep AVCC extradata so library's h264_mp4toannexb works correctly
				'-c:a', 'libopus',
				'-b:a', '128k',
				'-ar', '48000',
				'-ac', '2',
				'-f', 'matroska',
				'-y',
				outPath
			];

			const proc = spawn(ffmpegBin, args, {
				windowsHide: true,
				stdio: ['ignore', 'ignore', 'pipe']
			});

			let stderr = '';
			proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
			proc.on('close', (code: number) => {
				if (code === 0 && fs.existsSync(outPath)) {
					const sizeMB = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1);
					logger.info(`Transcoded: ${sizeMB}MB → ${outPath}`);
					resolve(outPath);
				} else {
					reject(new Error(`ffmpeg transcode failed (${code}): ${stderr.slice(-500)}`));
				}
			});
			proc.on('error', reject);
		});
	}

	private getFriendlyErrorMessage(errorMsg: string, stderr?: string): string {
		const msg = (errorMsg + ' ' + (stderr || '')).toLowerCase();
		
		if (msg.includes('no such file') || msg.includes('does not exist')) {
			return 'الملف غير موجود';
		} else if (msg.includes('invalid data') || msg.includes('invalid argument') || msg.includes('invalid stream')) {
			return 'الفيديو تالف أو غير صالح';
		} else if (msg.includes('connection') || msg.includes('network') || msg.includes('i/o error')) {
			return 'خطأ في الاتصال';
		} else if (msg.includes('codec') || msg.includes('format') || msg.includes('not supported')) {
			return 'صيغة الفيديو غير مدعومة';
		} else if (msg.includes('permission denied') || msg.includes('access denied')) {
			return 'لا توجد صلاحيات';
		} else if (msg.includes('timeout') || msg.includes('timed out')) {
			return 'انتهت المهلة';
		} else if (msg.includes('moov atom not found') || msg.includes('could not find codec')) {
			return 'الفيديو غير مكتمل أو تالف';
		} else {
			// Return generic error
			return 'خطأ في معالجة الفيديو';
		}
	}

	private async handleQueueAdvancement(message: Message, wasError: boolean = false): Promise<void> {
		const finishedItem = this.queueService.getCurrent();
		if (finishedItem) {
			// Notify bot: finished
			if (!wasError && this.botNotifyFinished) this.botNotifyFinished(finishedItem.title);
			this.queueService.removeFromQueue(finishedItem.id);
		}

		const nextItem = this.queueService.getNext();

		if (nextItem) {
			logger.info(`Auto-playing next item from queue: ${nextItem.title}`);
			const delay = wasError ? 2000 : 1000;
			setTimeout(() => {
				this.playVideoFromQueueItem(message, nextItem).catch(err => {
					ErrorUtils.handleError(err, 'auto-playing next item');
					this.handleQueueAdvancement(message, true).catch(e =>
						logger.error('Failed to advance queue after error:', e)
					);
				});
			}, delay);
		} else {
			this.queueService.setPlaying(false);
			logger.info('No more items in queue, playback stopped');
			await this.cleanupStreamStatus();
		}
	}

	private async handleDownload(message: Message, videoSource: string, title?: string): Promise<string | null> {
		try {
			logger.info(`Downloading ${title || videoSource}...`);
			await message.channel.send(`📥 جاري تنزيل: **${title || 'الفيديو'}**`).catch(e => logger.warn(`Failed to send download start message: ${e.message}`));
			
			const tempFilePath = await this.mediaService.downloadYouTubeVideo(videoSource);

			if (tempFilePath) {
				logger.info(`Finished downloading ${title || videoSource}`);
				await message.channel.send(`✅ اكتمل التنزيل: **${title || 'الفيديو'}**`).catch(e => logger.warn(`Failed to send download complete message: ${e.message}`));
				return tempFilePath;
			}
			throw new Error('Download failed, no temp file path returned.');
		} catch (error: any) {
			logger.error(`Failed to download YouTube video: ${videoSource}`, error);
			await message.channel.send(`❌ فشل التنزيل: **${title || 'الفيديو'}**`).catch(e => logger.warn(`Failed to send download error message: ${e.message}`));
			return null;
		}
	}

	private async prepareVideoSource(message: Message, videoSource: string, title?: string): Promise<{ inputForFfmpeg: any, tempFilePath: string | null }> {
		const mediaSource = await this.mediaService.resolveMediaSource(videoSource);

		if (mediaSource && mediaSource.type === 'youtube') {
			if (mediaSource.isLive) {
				logger.info('Getting live stream URL from YouTube');
				try {
					const { exec: ytdlpExec, downloadExecutable } = await import('../utils/yt-dlp.js');
					await downloadExecutable();

					const liveUrl = await new Promise<string>((resolve, reject) => {
						let stdout = '';
						let stderr = '';
						const proc = ytdlpExec(videoSource, { format: 'best[protocol=m3u8_native]/best', getUrl: true, noPlaylist: true });
						proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
						proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
						proc.on('close', (code: number) => {
							const url = stdout.trim().split('\n')[0].trim();
							if (code === 0 && url.startsWith('http')) resolve(url);
							else reject(new Error(`yt-dlp failed: ${stderr.slice(-300)}`));
						});
						proc.on('error', reject);
					});
					return { inputForFfmpeg: liveUrl, tempFilePath: null };
				} catch (err) {
					logger.error('Failed to get live URL:', err);
					throw new Error('Failed to get live stream URL');
				}
			} else {
				// Download as mp4 with video+audio — prepareStream will transcode it
				logger.info('Downloading YouTube video...');
				const mp4Path = await this.handleDownload(message, videoSource, title);
				if (!mp4Path) throw new Error('Failed to download YouTube video');
				return { inputForFfmpeg: mp4Path, tempFilePath: mp4Path };
			}
		}

		logger.info('Using direct stream URL');
		return { inputForFfmpeg: mediaSource ? mediaSource.url : videoSource, tempFilePath: null };
	}

	private async convertToMkv(inputPath: string): Promise<string> {
		const os = await import('os');
		const crypto = await import('crypto');
		const { spawn } = await import('child_process');
		const mkvPath = path.join(os.tmpdir(), `stream_${crypto.randomBytes(6).toString('hex')}.mkv`);
		
		const ffmpegBin = path.resolve(process.cwd(), 'ffmpeg_extracted', 'ffmpeg-master-latest-win64-gpl', 'bin', 'ffmpeg.exe');
		const ffmpegCmd = fs.existsSync(ffmpegBin) ? ffmpegBin : 'ffmpeg';
		
		return new Promise((resolve, reject) => {
			const proc = spawn(ffmpegCmd, [
				'-i', inputPath,
				'-c:v', 'copy',
				'-c:a', 'copy',
				'-y',
				mkvPath
			], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
			
			let stderr = '';
			proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
			proc.on('close', (code: number) => {
				if (code === 0 && fs.existsSync(mkvPath)) {
					logger.info(`Converted to mkv: ${mkvPath}`);
					resolve(mkvPath);
				} else {
					reject(new Error(`ffmpeg conversion failed (${code}): ${stderr.slice(-300)}`));
				}
			});
			proc.on('error', reject);
		});
	}

	private async executeStreamWorkflow(input: any, options: any, message: Message, title: string, source: string): Promise<void> {
		this.controller = new AbortController();
		await this.executeStream(input, options, message, title, source);
	}

	private async finalizeStream(message: Message, tempFile: string | null, hadError: boolean = false): Promise<void> {
		// Detect stream error even if hadError wasn't set in playVideo
		const streamHadError = hadError || (this.controller?.signal.aborted && !this.streamStatus.manualStop);

		if (this.streamStatus.manualStop) {
			// User manually stopped — clear everything
			this.queueService.setPlaying(false);
			this.queueService.resetCurrentIndex();
			await this.cleanupStreamStatus();
		} else {
			// Stream finished (normally or with error) — advance queue
			if (streamHadError) {
				// Force reset voice connection so next stream starts fresh
				try {
					this.streamer.stopStream();
					this.streamer.leaveVoice();
					this.streamStatus.joined = false;
					this.streamStatus.joinsucc = false;
					this.streamStatus.playing = false;
				} catch (e) { /* ignore cleanup errors */ }
			}
			await this.handleQueueAdvancement(message, !!streamHadError);
		}

		// Reset controller for next stream
		this.controller = null;

		if (tempFile) {
			try {
				if (fs.existsSync(tempFile)) {
					fs.unlinkSync(tempFile);
					logger.info(`Deleted temp file: ${tempFile}`);
				}
			} catch (cleanupError) {
				logger.error(`Failed to delete temp file ${tempFile}:`, cleanupError);
			}
		}
	}

	public async playVideo(message: Message, videoSource: string, title?: string, videoParams?: { width: number, height: number, fps?: number, bitrate?: string }): Promise<void> {
		const [guildId, channelId] = [config.guildId, config.videoChannelId];
		this.streamStatus.manualStop = false;

		if (title) {
			const currentQueueItem = this.queueService.getCurrent();
			if (currentQueueItem?.title === title) {
				this.queueService.setPlaying(true);
			}
		}

		let tempFile: string | null = null;
		let hadError = false;
		
		try {
			const { inputForFfmpeg, tempFilePath } = await this.prepareVideoSource(message, videoSource, title);
			tempFile = tempFilePath;

			await this.ensureVoiceConnection(guildId, channelId, title);

			// Notify bot: now playing
			if (this.botNotifyPlaying) this.botNotifyPlaying(title || videoSource);

			const streamOpts = this.setupStreamConfiguration(videoParams);
			await this.executeStreamWorkflow(inputForFfmpeg, streamOpts, message, title || videoSource, videoSource);
		} catch (error) {
			hadError = true;
			await ErrorUtils.handleError(error, `playing video: ${title || videoSource}`);
			if (this.controller && !this.controller.signal.aborted) this.controller.abort();
			this.markVideoAsFailed(videoSource);
			// Notify bot: error
			if (this.botNotifyError) this.botNotifyError(title || videoSource);
		} finally {
			await this.finalizeStream(message, tempFile, hadError);
		}
	}

	public async cleanupStreamStatus(): Promise<void> {
		try {
			this.controller?.abort();
			this.streamer.stopStream();

			// Only leave voice if we're not playing another video
			// Check if there are items in queue that might be played
			const hasQueueItems = !this.queueService.isEmpty();
			if (!hasQueueItems) {
				this.streamer.leaveVoice();
				this.streamStatus.joined = false;
				this.streamStatus.joinsucc = false;
			}

			this.streamer.client.user?.setActivity(DiscordUtils.status_idle());

			// Reset all status flags
			this.streamStatus.playing = false;
			this.streamStatus.manualStop = false;
			this.streamStatus.channelInfo = {
				guildId: "",
				channelId: "",
				cmdChannelId: "",
			};

			// Notify bot to update presence
			this.notifyBotUpdate();
		} catch (error) {
			await ErrorUtils.handleError(error, "cleanup stream status");
		}
	}

	public async stopAndClearQueue(): Promise<void> {
		// Clear the queue
		this.queueService.clearQueue();
		logger.info("Queue cleared by stop command");

		// Then cleanup the stream
		await this.cleanupStreamStatus();
	}

}