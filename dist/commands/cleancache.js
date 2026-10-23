import { BaseCommand } from "./base.js";
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import config from '../config.js';
import logger from '../utils/logger.js';
export default class CleanCacheCommand extends BaseCommand {
    name = "cleancache";
    description = "تنظيف ملفات الكاش والملفات المؤقتة";
    usage = "cleancache";
    aliases = ["cc", "clean", "cleanup"];
    async execute(context) {
        await context.message.reply('🧹 جاري تنظيف الملفات المؤقتة...');
        let totalDeleted = 0;
        let totalSize = 0;
        const deletedFiles = [];
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
                        deletedFiles.push(`Preview: ${file}`);
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
                        totalDeleted++;
                        deletedFiles.push(`Temp: ${file}`);
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
            await context.message.reply('✨ النظام نظيف بالفعل! لا توجد ملفات مؤقتة.');
        }
        else {
            let resultMsg = `✅ **تم التنظيف بنجاح!**\n\n`;
            resultMsg += `📊 **الإحصائيات:**\n`;
            resultMsg += `• عدد الملفات: ${totalDeleted}\n`;
            resultMsg += `• المساحة المحررة: ${sizeDisplay}\n`;
            if (deletedFiles.length > 0) {
                resultMsg += `\n📁 **بعض الملفات المحذوفة:**\n`;
                const filesToShow = deletedFiles.slice(0, 5);
                filesToShow.forEach(file => {
                    resultMsg += `• ${file}\n`;
                });
                if (deletedFiles.length > 5) {
                    resultMsg += `• ... و ${deletedFiles.length - 5} ملف آخر\n`;
                }
            }
            await context.message.reply(resultMsg);
        }
        logger.info(`Cache cleanup completed: ${totalDeleted} files, ${sizeDisplay} freed`);
    }
}
//# sourceMappingURL=cleancache.js.map