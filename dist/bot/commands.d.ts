import { Message } from 'discord.js';
import { StreamStatus } from '../types/index.js';
export declare class BotCommandHandler {
    private streamStatus;
    private streamingService;
    private videos;
    constructor(streamStatus: StreamStatus, streamingService: any, videos: any[]);
    handleCommand(message: Message): Promise<boolean>;
    private handlePlay;
    private isValidMediaLink;
    private handleSkip;
    private handleStop;
    private handleList;
    private handleCleanup;
    private handleQueue;
    private handleStatus;
    private handleHelp;
}
