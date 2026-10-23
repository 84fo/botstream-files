import { Client } from 'discord.js';
import { StreamStatus } from '../types/index.js';
export declare class DiscordBot {
    private client;
    private streamStatus;
    private commandHandler;
    constructor(streamStatus: StreamStatus);
    setCommandHandler(streamingService: any, videos: any[]): void;
    private setupEventHandlers;
    private sendStatusEmbed;
    private sendQueueEmbed;
    private sendCurrentVideoEmbed;
    updatePresence(): void;
    login(): Promise<void>;
    getClient(): Client;
    private isValidMediaLink;
}
