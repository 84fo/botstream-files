import { getStream, getVod } from 'twitch-m3u8';
import { TwitchStream, MediaSource } from '../types/index.js';
import config from "../config.js";
import logger from '../utils/logger.js';
import { Youtube } from '../utils/youtube.js';
import ytdl, { downloadToTempFile } from '../utils/yt-dlp.js';
import { GeneralUtils } from '../utils/shared.js';
import { YTResponse } from '../types/index.js';
import path from 'path';

export class MediaService {
	public youtube: Youtube;

	constructor() {
		this.youtube = new Youtube();
	}

	public async resolveMediaSource(url: string): Promise<MediaSource | null> {
		try {
			if (url.includes('youtube.com/') || url.includes('youtu.be/')) {
				return await this._resolveYouTubeSource(url);
			} else if (url.includes('twitch.tv/')) {
				return await this._resolveTwitchSource(url);
			} else if (GeneralUtils.isLocalFile(url)) {
				return this._resolveLocalSource(url);
			} else if (GeneralUtils.isValidUrl(url)) {
				return this._resolveDirectUrlSource(url);
			} else {
				return this.searchAndPlayYouTube(url);
			}

			return null;
		} catch (error) {
			logger.error("Failed to resolve media source:", error);
			return null;
		}
	}

	private async _resolveYouTubeSource(url: string): Promise<MediaSource | null> {
		const videoDetails = await this.youtube.getVideoInfo(url);
		if (!videoDetails) return null;

		const isLive = videoDetails.videoDetails?.isLiveContent || false;
		const streamUrl = isLive ? await this.youtube.getLiveStreamUrl(url) : url;

		if (streamUrl) {
			return {
				url: streamUrl,
				title: videoDetails.title,
				type: 'youtube',
				isLive: isLive,
			};
		}
		return null;
	}

	public async getTwitchStreamUrl(url: string): Promise<string | null> {
		try {
			// Handle VODs
			if (url.includes('/videos/')) {
				const vodId = url.split('/videos/').pop() as string;
				const vodInfo = await getVod(vodId);
				const vod = vodInfo.find((stream: TwitchStream) => stream.resolution === `${config.width}x${config.height}`) || vodInfo[0];
				if (vod?.url) {
					return vod.url;
				}
				logger.error("No VOD URL found");
				return null;
			} else {
				const twitchId = url.split('/').pop() as string;
				const streams = await getStream(twitchId);
				const stream = streams.find((stream: TwitchStream) => stream.resolution === `${config.width}x${config.height}`) || streams[0];
				if (stream?.url) {
					return stream.url;
				}
				logger.error("No Stream URL found");
				return null;
			}
		} catch (error) {
			logger.error("Failed to get Twitch stream URL:", error);
			return null;
		}
	}

	public async downloadYouTubeVideo(url: string): Promise<string | null> {
		try {
			// Format 18 = 360p mp4 (video+audio merged)
			// mp4 formats with video+audio: 18(360p), 22(720p)
			// Use 22 first for 720p, fallback to 18 for 360p, then any best with both streams
			const ytDlpDownloadOptions = {
				format: '22/18/best[ext=mp4][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]/best',
				noPlaylist: true,
				mergeOutputFormat: 'mp4',
			};

			logger.info('Starting download with format: 22/18/best mp4 (video+audio)');
			const tempFilePath = await downloadToTempFile(url, ytDlpDownloadOptions);
			
			// Verify file exists and is readable
			if (tempFilePath) {
				const fs = await import('fs');
				if (fs.existsSync(tempFilePath)) {
					const stats = fs.statSync(tempFilePath);
					const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
					logger.info(`Downloaded: ${sizeMB} MB`);
					
					if (stats.size < 1024) {
						logger.error('Downloaded file too small, likely corrupted');
						return null;
					}
					
					return tempFilePath;
				}
			}
			
			logger.error('Downloaded file not found');
			return null;
		} catch (error) {
			logger.error("Download failed:", error);
			return null;
		}
	
	}

	private async _resolveTwitchSource(url: string): Promise<MediaSource | null> {
		const streamUrl = await this.getTwitchStreamUrl(url);
		if (streamUrl) {
			const twitchId = url.split('/').pop() as string;
			return {
				url: streamUrl,
				title: `twitch.tv/${twitchId}`,
				type: 'twitch'
			};
		}
		return null;
	}

	private _resolveLocalSource(url: string): MediaSource {
		return {
			url,
			title: path.basename(url, path.extname(url)),
			type: 'local'
		};
	}

	private async _resolveDirectUrlSource(url: string): Promise<MediaSource> {
		// First try to get metadata using yt-dlp
		try {
			const metadata = await ytdl(url, {
				dumpJson: true,
				skipDownload: true,
				noWarnings: true,
				quiet: true
			}) as YTResponse;

			// If yt-dlp succeeds, use the extracted metadata
			if (metadata && metadata.title) {
				// Get the best available format URL
				let streamUrl = url;
				if (metadata.formats && Array.isArray(metadata.formats) && metadata.formats.length > 0) {
					// Find the format with both audio and video, preferring higher quality
					const bestFormat = metadata.formats
						.filter((format) => format.url && format.ext !== 'm3u8') // Avoid HLS streams
						.sort((a, b) => {
							// Prefer formats with both audio and video
							const aScore = (a.vcodec && a.vcodec !== 'none' ? 1 : 0) + (a.acodec && a.acodec !== 'none' ? 1 : 0) + (a.height || 0) / 1000;
							const bScore = (b.vcodec && b.vcodec !== 'none' ? 1 : 0) + (b.acodec && b.acodec !== 'none' ? 1 : 0) + (b.height || 0) / 1000;
							return bScore - aScore;
						})[0];

					if (bestFormat && bestFormat.url) {
						streamUrl = bestFormat.url;
					}
				}

				return {
					url: streamUrl,
					title: metadata.title,
					type: 'url'
				};
			}
		} catch (error) {
			// yt-dlp failed, log debug info and continue to fallback
			logger.debug("yt-dlp failed to extract metadata for URL:", url, error);
		}

		// Fallback to original URL parsing logic
		let title = "Direct URL";
		try {
			const urlObj = new URL(url);
			const pathname = urlObj.pathname;
			const filename = pathname.split('/').pop();

			if (filename && filename.includes('.')) {
				title = decodeURIComponent(filename.replace(/\.[^/.]+$/, ""));
			} else if (pathname !== '/' && pathname.length > 1) {
				const pathSegment = pathname.split('/').pop();
				if (pathSegment) {
					title = decodeURIComponent(pathSegment);
				}
			}
		} catch (e) {
			logger.debug("Could not parse URL for title extraction:", url);
		}

		return {
			url,
			title,
			type: 'url'
		};
	}

	public async searchYouTube(query: string, limit: number = 5): Promise<string[]> {
		try {
			return await this.youtube.search(query, limit);
		} catch (error) {
			logger.error("Failed to search YouTube:", error);
			return [];
		}
	}

	public async searchAndPlayYouTube(query: string): Promise<MediaSource | null> {
		try {
			const searchResult = await this.youtube.searchAndGetPageUrl(query);
			if (searchResult.pageUrl && searchResult.title) {
				return {
					url: searchResult.pageUrl,
					title: searchResult.title,
					type: 'youtube'
				};
			}
			return null;
		} catch (error) {
			logger.error("Failed to search and play YouTube:", error);
			return null;
		}
	}
}