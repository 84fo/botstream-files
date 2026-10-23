import { Client, GatewayIntentBits, EmbedBuilder, ActivityType, PresenceUpdateStatus, ButtonInteraction, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ModalSubmitInteraction, MessageFlags } from 'discord.js';
import config from '../config.js';
import logger from '../utils/logger.js';
import { StreamStatus } from '../types/index.js';
import { BotCommandHandler } from './commands.js';

export class DiscordBot {
	private client: Client;
	private streamStatus: StreamStatus;
	private commandHandler: BotCommandHandler | null = null;
	private downloadStatuses: Map<string, { userId: string, status: string, title: string }> = new Map();

	constructor(streamStatus: StreamStatus) {
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

	public setCommandHandler(streamingService: any, videos: any[]): void {
		this.commandHandler = new BotCommandHandler(this.streamStatus, streamingService, videos);
	}

	// Called by streaming service
	public async notifyNowPlaying(title: string): Promise<void> {
		try {
			const channel = await this.client.channels.fetch(config.cmdChannelId) as any;
			if (!channel) return;
			const embed = new EmbedBuilder()
				.setColor(0x00cc44)
				.setTitle('🎬 يتم العرض الآن')
				.setDescription(`**${title}**`)
				.setTimestamp()
				.setFooter({ text: 'Blinders Studio Live' });
			await channel.send({ embeds: [embed] });
		} catch (e) { logger.error('notifyNowPlaying error:', e); }
	}

	public async notifyFinished(title: string): Promise<void> {
		try {
			const channel = await this.client.channels.fetch(config.cmdChannelId) as any;
			if (!channel) return;
			await channel.send(`✅ انتهى تشغيل: **${title}**`);
		} catch (e) { logger.error('notifyFinished error:', e); }
	}

	public async notifyError(title: string): Promise<void> {
		try {
			const channel = await this.client.channels.fetch(config.cmdChannelId) as any;
			if (!channel) return;
			await channel.send(`❌ فشل تشغيل: **${title}**`);
		} catch (e) { logger.error('notifyError error:', e); }
	}

	public updateDownloadStatus(movieId: string, userId: string, status: string, title: string): void {
		this.downloadStatuses.set(movieId, { userId, status, title });
	}

	public getDownloadStatus(movieId: string) {
		return this.downloadStatuses.get(movieId);
	}

	public clearDownloadStatus(movieId: string): void {
		this.downloadStatuses.delete(movieId);
	}

	private setupEventHandlers(): void {
		this.client.on('ready', () => {
			logger.info(`Bot ${this.client.user?.tag} is ready!`);
			this.updatePresence();
		});

		this.client.on('messageCreate', async (message) => {
			if (message.author.bot) return;
			if (message.guildId !== config.guildId) return;

			const originalContent = message.content;
			const content = message.content.toLowerCase();

			if (this.commandHandler && originalContent.startsWith(config.prefix)) {
				logger.info(`Bot received command: ${originalContent}`);
				const handled = await this.commandHandler.handleCommand(message);
				logger.info(`Command handled: ${handled}`);
				if (handled) return;
			}

			if (content.includes('status') || content.includes('حالة') || content.includes('الحالة')) {
				await this.sendStatusEmbed(message);
			} else if (content.includes('queue') || content.includes('قائمة') || content.includes('الطابور')) {
				await this.sendQueueEmbed(message);
			} else if (content.includes('current') || content.includes('الحالي') || content.includes('الآن')) {
				await this.sendCurrentVideoEmbed(message);
			}
		});

		this.client.on('interactionCreate', async (interaction) => {
			if (interaction.guildId !== config.guildId) return;

			try {
				if (interaction.isButton()) {
					if (interaction.customId === 'book_ticket') {
						await this.handleBookTicket(interaction as ButtonInteraction);
					} else if (interaction.customId === 'movie_time') {
						await this.handleMovieTime(interaction as ButtonInteraction);
					} else if (interaction.customId === 'download_status') {
						await this.handleDownloadStatus(interaction as ButtonInteraction);
					} else if (interaction.customId === 'cinema_status') {
						await this.handleCinemaStatus(interaction as ButtonInteraction);
					} else if (interaction.customId === 'movie_list') {
						await this.handleMovieList(interaction as ButtonInteraction);
					}
				} else if (interaction.isModalSubmit()) {
					if (interaction.customId === 'movie_booking_modal') {
						await this.handleMovieBookingSubmit(interaction as ModalSubmitInteraction);
					}
				}
			} catch (error) {
				logger.error('Error handling interaction:', error);
				try {
					if ((interaction as any).isRepliable?.() && !(interaction as any).replied && !(interaction as any).deferred) {
						await (interaction as any).reply({ content: 'صار خطأ، جرب مرة ثانية.', flags: MessageFlags.Ephemeral });
					}
				} catch (e) { /* ignore */ }
			}
		});
	}

	private getQueueData() {
		let queueItems: any[] = [];
		let currentIndex = -1;
		let isPlaying = false;
		try {
			if (this.commandHandler) {
				const qs = this.commandHandler.getQueueService();
				if (qs) {
					queueItems = qs.getQueue();
					const current = qs.getCurrent();
					isPlaying = qs.getQueueStatus().isPlaying;
					if (current) currentIndex = queueItems.findIndex((i: any) => i.id === current.id);
				}
			}
		} catch (e) {
			queueItems = this.streamStatus.queue.items;
			currentIndex = this.streamStatus.queue.currentIndex;
			isPlaying = this.streamStatus.playing;
		}
		return { queueItems, currentIndex, isPlaying };
	}

	private async sendStatusEmbed(message: any): Promise<void> {
		const { queueItems, isPlaying } = this.getQueueData();
		const embed = new EmbedBuilder()
			.setColor(0x000000)
			.setTitle('🎬 حالة البث')
			.addFields(
				{ name: '🔊 متصل بالقناة', value: this.streamStatus.joined ? 'نعم' : 'لا', inline: true },
				{ name: '🎥 يتم التشغيل', value: isPlaying ? 'نعم' : 'لا', inline: true },
				{ name: '🎫 في الانتظار', value: `${queueItems.length}`, inline: true }
			)
			.setTimestamp()
			.setFooter({ text: 'Blinders Studio Live' });
		await message.reply({ embeds: [embed] });
	}

	private async sendQueueEmbed(message: any): Promise<void> {
		const { queueItems, currentIndex, isPlaying } = this.getQueueData();
		const embed = new EmbedBuilder()
			.setColor(0x000000)
			.setTitle('📋 قائمة الانتظار')
			.setTimestamp()
			.setFooter({ text: `Blinders Studio Live - ${queueItems.length} فيديو` });

		if (queueItems.length === 0) {
			embed.setDescription('القائمة فارغة حالياً\nاستخدم `%play` أو زر **حجز فيلم**');
		} else {
			let desc = '';
			queueItems.forEach((item: any, index: number) => {
				const isCurrent = index === currentIndex && isPlaying;
				desc += `${isCurrent ? '🎬 ' : `${index + 1}. `}${item.title}${isCurrent ? ' (يتم التشغيل)' : ''}\n`;
			});
			embed.setDescription(desc.substring(0, 4096));
		}
		await message.reply({ embeds: [embed] });
	}

	private async sendCurrentVideoEmbed(message: any): Promise<void> {
		const { queueItems, currentIndex, isPlaying } = this.getQueueData();
		if (!isPlaying) {
			await message.reply({ embeds: [new EmbedBuilder().setColor(0x000000).setTitle('🎬 لا يوجد تشغيل حالياً').setDescription('استخدم `%play` أو زر **حجز فيلم**').setTimestamp()] });
			return;
		}
		const currentItem = queueItems[currentIndex];
		if (!currentItem) { await message.reply('لا يمكن العثور على الفيديو الحالي'); return; }
		const embed = new EmbedBuilder()
			.setColor(0x000000)
			.setTitle('🎬 يتم التشغيل الآن')
			.addFields(
				{ name: 'العنوان', value: currentItem.title, inline: false },
				{ name: 'طلب بواسطة', value: currentItem.requestedBy, inline: true },
				{ name: 'النوع', value: currentItem.type, inline: true }
			)
			.setTimestamp()
			.setFooter({ text: 'Blinders Studio Live' });
		await message.reply({ embeds: [embed] });
	}

	public updatePresence(): void {
		if (!this.client.user) return;
		if (this.streamStatus.playing) {
			const { queueItems, currentIndex } = this.getQueueData();
			const title = queueItems[currentIndex]?.title || 'Unknown';
			this.client.user.setPresence({
				activities: [{ name: title, type: ActivityType.Streaming, url: 'https://twitch.tv/blindersstudio' }],
				status: PresenceUpdateStatus.Online
			});
		} else {
			this.client.user.setPresence({
				activities: [{ name: 'Blinders Studio Live', type: ActivityType.Watching }],
				status: PresenceUpdateStatus.Idle
			});
		}
	}

	public async login(): Promise<void> {
		if (!config.botToken) { logger.warn('Bot token not provided'); return; }
		try { await this.client.login(config.botToken); }
		catch (error) { logger.error('Failed to login bot:', error); }
	}

	public getClient(): Client { return this.client; }

	// ====== Dashboard Button Handlers ======

	private async handleBookTicket(interaction: ButtonInteraction): Promise<void> {
		const modal = new ModalBuilder()
			.setCustomId('movie_booking_modal')
			.setTitle('🎫 إضافة لقائمة التشغيل');

		const linkInput = new TextInputBuilder()
			.setCustomId('movie_link')
			.setLabel('رابط الفيديو')
			.setStyle(TextInputStyle.Short)
			.setPlaceholder('https://youtube.com/watch?v=...')
			.setRequired(true)
			.setMaxLength(500);

		const titleInput = new TextInputBuilder()
			.setCustomId('movie_title')
			.setLabel('اسم مخصص (اختياري)')
			.setStyle(TextInputStyle.Short)
			.setPlaceholder('اتركه فارغاً للعنوان التلقائي')
			.setRequired(false)
			.setMaxLength(100);

		modal.addComponents(
			new ActionRowBuilder<TextInputBuilder>().addComponents(linkInput),
			new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput)
		);

		await interaction.showModal(modal);
	}

	private async handleMovieBookingSubmit(interaction: ModalSubmitInteraction): Promise<void> {
		const movieLink = interaction.fields.getTextInputValue('movie_link').trim()
			.replace(/^%play\s+/i, '') // remove %play prefix if user added it
			.replace(/^play\s+/i, '');  // remove 'play' prefix
		const customTitle = interaction.fields.getTextInputValue('movie_title') || undefined;

		const isLink = this.isValidMediaLink(movieLink);
		await interaction.reply({ content: isLink ? '⏳ جاري معالجة الرابط...' : `🔎 جاري البحث عن: **${movieLink}**...`, flags: MessageFlags.Ephemeral });

		const mockMessage = {
			author: { username: interaction.user.username, tag: interaction.user.tag, id: interaction.user.id },
			guild: interaction.guild,
			channel: interaction.channel,
			guildId: interaction.guildId,
			reply: async (_content: any) => {
				return { edit: async (_c: any) => {}, createdTimestamp: Date.now() };
			}
		};

		if (!this.commandHandler) {
			await interaction.editReply({ content: '❌ البوت غير جاهز، جرب مرة ثانية.' });
			return;
		}

		try {
			const queueItem = await this.commandHandler.addMovieToQueue(mockMessage, movieLink, customTitle);
			await new Promise(r => setTimeout(r, 300));

			if (queueItem) {
				await interaction.editReply({ content: `✅ تمت الإضافة للقائمة!\n🎬 **${queueItem.title}**\n\nاستخدم زر **القائمة** لمتابعة الترتيب.` });
				// autoPlayCallback in streamingService handles starting playback automatically
			} else {
				await interaction.editReply({ content: isLink ? '❌ فشلت معالجة الرابط، جرب مرة ثانية.' : '❌ لم يتم العثور على نتائج للبحث، جرب مرة ثانية.' });
			}
		} catch (error) {
			logger.error('Booking error:', error);
			await interaction.editReply({ content: '❌ حدث خطأ، جرب مرة ثانية.' });
		}
	}

	private async handleMovieTime(interaction: ButtonInteraction): Promise<void> {
		const { queueItems, currentIndex, isPlaying } = this.getQueueData();
		const userMovies = queueItems.filter((i: any) => i.requestedBy === interaction.user.tag || i.requestedBy === interaction.user.username);

		if (userMovies.length === 0) {
			await interaction.reply({ content: 'ما عندك أي فيديوهات محجوزة. استخدم زر **حجز فيلم** لإضافة واحد.', flags: MessageFlags.Ephemeral });
			return;
		}

		let text = isPlaying && currentIndex >= 0 ? `يتم تشغيل: **${queueItems[currentIndex]?.title}**\n\n` : 'لا يوجد تشغيل حالياً\n\n';
		text += 'فيديوهاتك في القائمة:\n';
		userMovies.forEach((item: any) => {
			const pos = queueItems.findIndex((i: any) => i.id === item.id);
			const isCurrent = isPlaying && pos === currentIndex;
			text += `• ${item.title} - ${isCurrent ? '🎬 يتم التشغيل' : pos === currentIndex + 1 ? '⏭️ التالي' : `رقم ${pos + 1} في القائمة`}\n`;
		});

		await interaction.reply({ content: text, flags: MessageFlags.Ephemeral });
	}

	private async handleDownloadStatus(interaction: ButtonInteraction): Promise<void> {
		const { queueItems, currentIndex, isPlaying } = this.getQueueData();
		const userMovies = queueItems.filter((i: any) => i.requestedBy === interaction.user.tag || i.requestedBy === interaction.user.username);

		if (userMovies.length === 0) {
			await interaction.reply({ content: 'ما عندك أي فيديوهات محجوزة.', flags: MessageFlags.Ephemeral });
			return;
		}

		let text = 'حالة فيديوهاتك:\n\n';
		userMovies.forEach((item: any) => {
			const isCurrent = isPlaying && queueItems[currentIndex]?.id === item.id;
			const ds = this.getDownloadStatus(item.id);
			text += `**${item.title}**\n`;
			text += `الحالة: ${isCurrent ? '🎬 يتم التشغيل الآن' : ds ? ds.status : '⏳ في الانتظار'}\n\n`;
		});

		await interaction.reply({ content: text, flags: MessageFlags.Ephemeral });
	}

	private async handleCinemaStatus(interaction: ButtonInteraction): Promise<void> {
		const { queueItems, currentIndex, isPlaying } = this.getQueueData();
		let text = '**حالة البث:**\n\n';
		text += `متصل: ${this.streamStatus.joined ? '✅' : '❌'}\n`;
		text += `يتم التشغيل: ${isPlaying ? '✅' : '❌'}\n`;
		text += `في القائمة: ${queueItems.length} فيديو\n`;
		if (isPlaying && currentIndex >= 0) {
			text += `\nالحالي: **${queueItems[currentIndex]?.title}**\nطلب بواسطة: ${queueItems[currentIndex]?.requestedBy}`;
		}
		await interaction.reply({ content: text, flags: MessageFlags.Ephemeral });
	}

	private async handleMovieList(interaction: ButtonInteraction): Promise<void> {
		const { queueItems, currentIndex, isPlaying } = this.getQueueData();

		if (queueItems.length === 0) {
			await interaction.reply({ content: 'القائمة فارغة. استخدم زر **حجز فيلم** لإضافة فيديو!', flags: MessageFlags.Ephemeral });
			return;
		}

		let text = `📋 **قائمة التشغيل** - ${queueItems.length} فيديو\n\n`;
		queueItems.forEach((item: any, index: number) => {
			const isCurrent = index === currentIndex && isPlaying;
			text += `${isCurrent ? '🎬 ' : `${index + 1}. `}${item.title}${isCurrent ? ' *(يتم التشغيل)*' : ''}\n   بواسطة: ${item.requestedBy}\n\n`;
		});

		await interaction.reply({ content: text.substring(0, 2000), flags: MessageFlags.Ephemeral });
	}

	private isValidMediaLink(text: string): boolean {
		const t = text.trim();
		return t.includes('youtube.com/') || t.includes('youtu.be/') || t.includes('twitch.tv/') || t.startsWith('http://') || t.startsWith('https://');
	}
}
