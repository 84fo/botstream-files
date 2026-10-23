import { MediaSource } from '../types/index.js';
import { Youtube } from '../utils/youtube.js';
export declare class MediaService {
    youtube: Youtube;
    constructor();
    resolveMediaSource(url: string): Promise<MediaSource | null>;
    private _resolveYouTubeSource;
    getTwitchStreamUrl(url: string): Promise<string | null>;
    downloadYouTubeVideo(url: string): Promise<string | null>;
    private _resolveTwitchSource;
    private _resolveLocalSource;
    private _resolveDirectUrlSource;
    searchYouTube(query: string, limit?: number): Promise<string[]>;
    searchAndPlayYouTube(query: string): Promise<MediaSource | null>;
}
