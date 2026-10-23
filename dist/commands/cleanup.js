import { BaseCommand } from "./base.js";
import fs from 'fs';
import path from 'path';
import os from 'os';
import config from "../config.js";
import logger from '../utils/logger.js';
export default class CleanupCommand extends BaseCommand {
    name = "cleanup";
    description = "حذف جميع الملفات المؤقتة والكاش";
    usage = "cleanup";
    aliases = ["clean", "purge"];
    async execute(context) {
        try {
            let totalDeleted = 0;
            let totalSize = 0;
            let cacheDeleted = 0;
            let tempDeleted = 0;
            if (fs.existsSync(config.previewCacheDir)) {
                const cacheFiles = fs.readdirSync(config.previewCacheDir);
                for (const file of cacheFiles) {
                    try {
                        const filePath = path.join(config.previewCacheDir, file);
                        const stats = fs.statSync(filePath);
                        totalSize += stats.size;
                        fs.unlinkSync(filePath);
                        cacheDeleted++;
                        totalDeleted++;
                    }
                    catch (error) {
                        logger.error(`Failed to delete cache file ${file}:`, error);
                    }
                }
            }
            const tempDir = os.tmpdir();
            const tempFiles = fs.readdirSync(tempDir);
            const ytdlpFiles = tempFiles.filter(file => file.startsWith('ytdlp_temp_'));
            for (const file of ytdlpFiles) {
                try {
                    const filePath = path.join(tempDir, file);
                    if (fs.existsSync(filePath)) {
                        const stats = fs.statSync(filePath);
                        totalSize += stats.size;
                        fs.unlinkSync(filePath);
                        tempDeleted++;
                        totalDeleted++;
                    }
                }
                catch (error) {
                    logger.error(`Failed to delete temp file ${file}:`, error);
                }
            }
            const sizeInMB = (totalSize / (1024 * 1024)).toFixed(2);
            if (totalDeleted === 0) {
                await context.message.reply('النظام نظيف بالفعل');
            }
            else {
                await context.message.reply(`تم التنظيف: ${totalDeleted} ملف (كاش: ${cacheDeleted}, مؤقت: ${tempDeleted}) - ${sizeInMB} MB`);
            }
            logger.info(`Cleanup completed: ${totalDeleted} files deleted, ${sizeInMB} MB freed (Cache: ${cacheDeleted}, Temp: ${tempDeleted})`);
        }
        catch (error) {
            logger.error('Error during cleanup:', error);
            await this.sendError(context.message, 'حدث خطأ أثناء التنظيف');
        }
    }
}
//# sourceMappingURL=cleanup.js.map