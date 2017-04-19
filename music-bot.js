// //////////////////////////////////////////////////////////////////////////////
//    This program is free software: you can redistribute it and/or modify    //
//    it under the terms of the GNU General Public License as published by    //
//    the Free Software Foundation, either version 3 of the License, or       //
//    (at your option) any later version.                                     //
//                                                                            //
//    This program is distributed in the hope that it will be useful,         //
//    but WITHOUT ANY WARRANTY; without even the implied warranty of          //
//    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the           //
//    GNU General Public License for more details.                            //
//                                                                            //
//    You should have received a copy of the GNU General Public License       //
//    along with this program.  If not, see <http://www.gnu.org/licenses/>.   //
// //////////////////////////////////////////////////////////////////////////////

const fs = require('fs');
const Discord = require('discord.js');
const ytdl = require('ytdl-core');
const request = require('request');
const Loggerr = require('loggerr');
const clearRequire = require('clear-require');
const bandcamp = require('node-bandcamp');
const isStream = require('isstream');

const bot = new Discord.Client({
	autoReconnect: true,
	max_message_cache: 0 // eslint-disable-line camelcase
});

const mentionText = 'Use !commands to see the command list.';
let aliasesFilePath = 'aliases.json';
let autoPlaylistFilePath = 'autoplaylist.txt';

let stopped = false;
let paused = false;
let informNp = null;
let autoPlayToggle;

const nowPlayingData = {};
let queue = [];
let aliases = {};

let voiceConnection = null;
let voiceHandler = null;
let textChannel = null;
let voiceChannel = null;
let currentServerId = null;
let playlistQueued = '';
let homeVoiceChannel = null;

let ytApiKey = null;

let permissions;

const logfile = fs.createWriteStream('./log', {
	flags: 'a',
	encoding: 'utf8'
});

const log = new Loggerr({
	streams: Loggerr.levels.map(() => {
		return logfile;
	})
});

// /////////////////////////////////////////////////////////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////////////////////////////////////

const commands = [

	{
		command: 'stop',
		description: 'Stops playlist (will also skip current song!)',
		parameters: [],
		execute(message) {
			if (stopped) {
				message.reply('Playback is already stopped!');
			} else {
				stopped = true;
				if (voiceHandler !== null) {
					voiceHandler.end();
				}
				bot.user.setGame();
				message.reply('Stopping!');
			}
		}
	},

	{
		command: 'resume',
		description: 'Resumes playlist',
		parameters: [],
		execute(message) {
			message.delete();
			if (stopped) {
				stopped = false;
				if (!isQueueEmpty()) {
					playNextSong();
				}
			} else if (paused) {
				voiceHandler.resume();
				paused = false;
				bot.user.setGame(nowPlayingData.title);
			} else {
				message.reply('Playback is already running');
			}
		}
	},

	{
		command: 'request',
		description: 'Adds the requested video to the playlist queue',
		parameters: ['playlist URL, video URL, video ID or alias'],
		execute(message, params) {
			if (Object.prototype.hasOwnProperty.call(aliases, params[1].toLowerCase())) {
				params[1] = aliases[params[1].toLowerCase()];
			}

			if (params[1].indexOf('bandcamp.com') !== -1) {
				addToQueue(params[1], message);
				return;
			}

			const youtubeId = getYoutubeId(params[1]);

			if (youtubeId.length === 34) {
				queuePlaylist(youtubeId, message);
			} else {
				addToQueue(youtubeId, message);
			}
		}
	},

	{
		command: 'search',
		description: 'Searches for a video on YouTube and adds it to the queue',
		parameters: ['query'],
		execute(message, params) {
			if (ytApiKey === null) {
				message.reply('You need a YouTube API key in order to use the !search command. Please see https://github.com/agubelu/discord-music-bot#obtaining-a-youtube-api-key');
			} else {
				let q = '';
				for (let i = 1; i < params.length; i++) {
					q += params[i] + ' ';
				}
				searchVideo(message, q);
			}
		}
	},

	{
		command: 'np',
		description: 'Displays the current song',
		parameters: [],
		execute() {
			if (isBotPlaying()) {
				getDetails(nowPlayingData.url).then(info => {
					const embed = new Discord.RichEmbed()
						.setTitle('Now playing: ' + info.title)
						.setImage(info.image)
						.setURL(info.url)
						.setFooter('Requested by ' + info.user);
					textChannel.sendEmbed(embed);
					bot.user.setGame(info.title);
				});
			}
		}
	},

	{
		command: 'setnp',
		description: 'Sets whether the bot will announce the current song or not',
		parameters: ['on/off'],
		execute(message, params) {
			let response;
			if (params[1].toLowerCase() === 'on') {
				response = 'Will announce song names in chat';
				informNp = true;
			} else if (params[1].toLowerCase() === 'off') {
				response = 'Will no longer announce song names in chat';
				informNp = false;
				bot.user.setGame();
			} else {
				response = 'Sorry?';
			}

			message.reply(response);
		}
	},

	{
		command: 'commands',
		description: 'Displays this message, duh!',
		parameters: [],
		execute(message) {
			let response = 'Available commands:';
			commands.sort((a, b) => {
				const commandA = a.command.toUpperCase();
				const commandB = b.command.toUpperCase();
				if (commandA < commandB) {
					return -1;
				}
				if (commandA > commandB) {
					return 1;
				}
				return 0;
			});
			for (let i = 0; i < commands.length; i++) {
				const c = commands[i];
				if (!permissions.checkPermission(message.author.id, c.command)) {
					continue;
				}
				response += '\n!' + c.command;

				for (let j = 0; j < c.parameters.length; j++) {
					response += ' <' + c.parameters[j] + '>';
				}

				response += ': ' + c.description;
			}

			message.reply(response);
		}
	},

	{
		command: 'skip',
		description: 'Skips the current song',
		parameters: [],
		execute(message) {
			if (voiceHandler === null) {
				message.reply('There is nothing being played.');
			} else {
				message.reply('Skipping...');
				voiceHandler.end();
			}
		}
	},

	{
		command: 'queue',
		description: 'Displays the queue',
		parameters: [],
		execute(message) {
			let response = '';

			if (isQueueEmpty()) {
				response = 'the queue is empty.';
			} else {
				for (let i = 0; i < queue.length; i++) {
					response += '"' + queue[i].title + '" (requested by ' + queue[i].user + ')\n';
				}
			}

			message.reply(response);
		}
	},

	{
		command: 'clearqueue',
		description: 'Removes all songs from the queue',
		parameters: [],
		execute(message) {
			queue = [];
			message.reply('Queue has been cleared!');
		}
	},

	{
		command: 'remove',
		description: 'Removes a song from the queue',
		parameters: ['Request index or \'last\''],
		execute(message, params) {
			let index = params[1];

			if (isQueueEmpty()) {
				message.reply('The queue is empty');
				return;
			} else if (isNaN(index) && index !== 'last') {
				message.reply('Argument \'' + index + '\' is not a valid index.');
				return;
			}

			if (index === 'last') {
				index = queue.length;
			}
			index = parseInt(index, 10);
			if (index < 1 || index > queue.length) {
				message.reply('Cannot remove request #' + index + ' from the queue (there are only ' + queue.length + ' requests currently)');
				return;
			}

			const deleted = queue.splice(index - 1, 1);
			message.reply('Request "' + deleted[0].title + '" was removed from the queue.');
		}
	},

	{
		command: 'aliases',
		description: 'Displays the stored aliases',
		parameters: [],
		execute(message) {
			let response = 'Current aliases:';

			for (const alias in aliases) {
				if (Object.prototype.hasOwnProperty.call(aliases, alias)) {
					response += '\n' + alias + ' -> ' + aliases[alias];
				}
			}

			message.reply(response);
		}
	},

	{
		command: 'setalias',
		description: 'Sets an alias, overriding the previous one if it already exists',
		parameters: ['alias', 'video URL or ID'],
		execute(message, params) {
			const alias = params[1].toLowerCase();
			const val = params[2];

			aliases[alias] = val;
			fs.writeFileSync(aliasesFilePath, JSON.stringify(aliases));

			message.reply('Alias ' + alias + ' -> ' + val + ' set successfully.');
		}
	},

	{
		command: 'deletealias',
		description: 'Deletes an existing alias',
		parameters: ['alias'],
		execute(message, params) {
			const alias = params[1].toLowerCase();
			if (Object.prototype.hasOwnProperty.call(aliases, alias)) {
				delete aliases[alias];
				fs.writeFileSync(aliasesFilePath, JSON.stringify(aliases));
				message.reply('Alias "' + alias + '" deleted successfully.');
			} else {
				message.reply('Alias ' + alias + ' does not exist');
			}
		}
	},

	{
		command: 'setavatar',
		description: 'Set bot avatar, overriding the previous one if it already exists',
		parameters: ['Image URL or alias'],
		execute(message, params) {
			let url = params[1];
			if (Object.prototype.hasOwnProperty.call(aliases, url.toLowerCase())) {
				url = aliases[url.toLowerCase()];
			}

			bot.user.setAvatar(url).then(() => {
				message.reply('✔ Avatar set!');
			})
				.catch(err => {
					message.reply('Error: Unable to set avatar');
					console.log('Error on setavatar command:', err);
				});
		}
	},

	{
		command: 'setusername',
		description: 'Set username of bot',
		parameters: ['username or alias'],
		execute(message, params) {
			params.shift();
			let userName = params.join(' ');
			if (Object.prototype.hasOwnProperty.call(aliases, userName.toLowerCase())) {
				userName = aliases[userName.toLowerCase()];
			}
			bot.user.setUsername(userName).then(
					message.reply('👌 Username set!'),
					message.delete()
					.catch(console.error)
				)
				.catch(err => {
					message.reply('Error: Unable to set username');
					console.log('Error on setusername command:', err);
				});
		}
	},

	{
		command: 'setautoplay',
		description: 'Sets whether the bot will autoplay from ' + autoPlaylistFilePath + ' or not.',
		parameters: ['on/off'],
		execute(message, params) {
			let response;
			if (params[1].toLowerCase() === 'on') {
				response = 'Will autoplay songs';
				autoPlayToggle = true;
				startAutoPlaylist();
			} else if (params[1].toLowerCase() === 'off') {
				response = 'Will no longer autoplay songs';
				autoPlayToggle = false;
			} else {
				response = 'Sorry?';
			}

			message.reply(response);
		}
	},

	{
		command: 'saveplaylist',
		description: 'Send text file containing all video URLs in playlist to channel.',
		parameters: ['playlist/alias'],
		execute(message, params) {
			if (Object.prototype.hasOwnProperty.call(aliases, params[1].toLowerCase())) {
				params[1] = aliases[params[1].toLowerCase()];
			}
			savePlaylist(getYoutubeId(params[1]), message);
		}
	},

	{
		command: 'joinme',
		description: 'Bot will join your channel',
		parameters: [],
		execute(message) {
			const server = bot.guilds.get(currentServerId);
			if (server === null) {
				throw new Error('Couldn\'t find server ' + currentServerId);
			}
			const authorChannel = server.members.get(message.author.id).voiceChannelID;

			voiceChannel = server.channels.find(chn => chn.id === authorChannel && chn.type === 'voice'); // The voice channel the bot will connect to
			if (voiceChannel === null) {
				throw new Error('Couldn\'t find voice channel ' + authorChannel + ' in server');
			}

			message.delete()
				.catch(console.error);

			voiceConnection = null;
			voiceChannel.join().then(connection => {
				voiceConnection = connection;
			}).catch(console.error);
		}
	},

	{
		command: 'purge',
		description: 'Delete all unpinned messages from text channel',
		parameters: [],
		execute(message) {
			message.channel.fetchMessages({
				limit: 100
			}).then(result => {
				result.every(result => {
					if (!result.pinned) {
						result.delete()
							.catch(console.error);
					}
					return true;
				});
			});
		}
	},

	{
		command: 'pin',
		description: 'Pin a message',
		parameters: ['message ID/alias'],
		execute(message, params) {
			if (Object.prototype.hasOwnProperty.call(aliases, params[1].toLowerCase())) {
				params[1] = aliases[params[1].toLowerCase()];
			}
			message.channel.fetchMessage(params[1]).then(result => {
				result.pin()
					.catch(console.error);
			});
		}
	},

	{
		command: 'unpin',
		description: 'Unpin a message',
		parameters: ['message ID/alias'],
		execute(message, params) {
			if (Object.prototype.hasOwnProperty.call(aliases, params[1].toLowerCase())) {
				params[1] = aliases[params[1].toLowerCase()];
			}
			message.channel.fetchMessage(params[1]).then(result => {
				result.unpin()
					.catch(console.error);
			});
		}
	},

	{
		command: 'eval',
		description: 'Run code',
		parameters: ['code'],
		execute(message, params) {
			message.delete();
			if (message.author.id === '299916805466619905' || message.author.id === '98123796283678720') {
				params.shift();
				const evalCode = params.join(' ');
				try {
					eval(evalCode); // eslint-disable-line no-eval
				} catch (err) {
					console.log('eval error: ' + err);
				}
			} else {
				message.author.sendMessage('Fuck off! Do you have any idea how dangerous eval() is?');
			}
		}
	},

	{
		command: 'home',
		description: 'Return bot to initial voice channel',
		parameters: [],
		execute(message) {
			message.delete();
			const server = bot.guilds.get(currentServerId);
			if (server === null) {
				throw new Error('Couldn\'t find server ' + currentServerId);
			}

			voiceChannel = server.channels.find(chn => chn.id === homeVoiceChannel && chn.type === 'voice');
			voiceChannel.join();
		}
	},

	{
		command: 'pause',
		description: 'Pause playback',
		parameters: [],
		dm: false,
		execute(message) {
			message.delete();
			voiceHandler.pause();
			paused = true;
			bot.user.setGame(nowPlayingData.title + ' (Paused)');
		}
	},

	{
		command: 'reload',
		description: 'Reload bot',
		parameters: [],
		execute(message) {
			message.delete();
			permissions = loadPermissions();
			message.reply('👌 Bot reloaded');
		}
	}
];

// /////////////////////////////////////////////////////////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////////////////////////////////////

bot.on('disconnect', event => {
	console.log('Disconnected: ' + event.reason + ' (' + event.code + ')');
});

bot.on('message', message => {
	if ((message.channel.type === 'dm' && message.author.id !== bot.user.id) || (message.channel.type === 'text' && message.channel.name === textChannel.name)) {
		if (message.isMentioned(bot.user)) {
			message.reply(mentionText);
		} else {
			const messageText = message.content;
			if (messageText[0] === '!') { // Command issued
				handleCommand(message, messageText.substring(1));
			}
		}
	}
});

// /////////////////////////////////////////////////////////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////////////////////////////////////

function addToQueue(videoId, message, mute = false, isAutoplay = false) {
	if (Object.prototype.hasOwnProperty.call(aliases, videoId.toLowerCase())) {
		videoId = aliases[videoId.toLowerCase()];
	}
	getDetails(videoId).then(info => {
		if (isAutoplay) {
			info.user = 'AutoPlay';
			queue.push(info);
		} else if (nowPlayingData.user === 'AutoPlay') {
			info.user = message.author.username;
			queue = [info].concat(queue);
		} else {
			info.user = message.author.username;
			queue.push(info);
		}
		if (!mute) {
			let msg = '**' + info.title + '**';
			if (info.duration) {
				msg += ' (' + toHHMMSS(info.duration) + ')';
			}
			msg += ' has been added to the queue.';
			message.reply(msg);
		}
		if (!stopped && !isBotPlaying() && queue.length === 1) {
			playNextSong();
		}
	});
}

function playNextSong() {
	if (isQueueEmpty()) {
		textChannel.sendMessage('The queue is empty!');
	}

	const mediaUrl = queue[0].url;
	const title = queue[0].title;
	const image = queue[0].image;
	const user = queue[0].user;
	if (queue[0].duration) {
		const duration = queue[0].duration;
		nowPlayingData.duration = duration;
	}

	nowPlayingData.title = title;
	nowPlayingData.user = user;
	nowPlayingData.url = mediaUrl;
	nowPlayingData.image = image;

	if (mediaUrl.indexOf('bandcamp.com') === -1) {
		const audioStream = ytdl(mediaUrl, {
			filter: 'audioonly'
		});
		voiceHandler = voiceConnection.playStream(audioStream);
		voiceHandler.setVolumeDecibels('-20');
		if (informNp) {
			const embed = new Discord.RichEmbed()
				.setTitle('Now playing: ' + nowPlayingData.title)
				.setImage(nowPlayingData.image)
				.setURL(nowPlayingData.url)
				.setFooter('Requested by ' + user);
			textChannel.sendEmbed(embed);
		}
		voiceHandler.on('debug', information => {
			console.log('Stream Debug: ' + information);
		});

		voiceHandler.once('error', err => {
			console.log('Stream Error: ' + err);
		});

		voiceHandler.once('end', reason => {
			console.log('Playback ended, reason: ' + reason);
			voiceHandler = null;
			bot.user.setGame();
			if (!stopped && !isQueueEmpty()) {
				playNextSong();
			} else if (autoPlayToggle) {
				startAutoPlaylist();
			}
		});
	} else {
		bandcamp.getTrack(mediaUrl).then(stream => {
			if (isStream(stream)) {
				voiceHandler = voiceConnection.playStream(stream);
				voiceHandler.setVolumeDecibels('-20');
				if (informNp) {
					const embed = new Discord.RichEmbed()
						.setTitle('Now playing: ' + nowPlayingData.title)
						.setImage(nowPlayingData.image)
						.setURL(nowPlayingData.url)
						.setFooter('Requested by ' + user);
					textChannel.sendEmbed(embed);
				}
			}
			voiceHandler.on('debug', information => {
				console.log('Stream Debug: ' + information);
			});

			voiceHandler.once('error', err => {
				console.log('Stream Error: ' + err);
			});

			voiceHandler.once('end', reason => {
				console.log('Playback ended, reason: ' + reason);
				voiceHandler = null;
				bot.user.setGame();
				if (!stopped && !isQueueEmpty()) {
					playNextSong();
				} else if (autoPlayToggle) {
					startAutoPlaylist();
				}
			});
		}).catch(err => {
			console.log(err);
		});
	}
	bot.user.setGame(title);

	queue.splice(0, 1);
}

function searchCommand(commandName) {
	for (let i = 0; i < commands.length; i++) {
		if (commands[i].command === commandName.toLowerCase()) {
			return commands[i];
		}
	}

	return false;
}

function handleCommand(message, text) {
	const params = text.split(' ');
	const command = searchCommand(params[0]);

	if (command && command.dm && message.channel.type !== 'dm') {
		message.delete();
		message.author.sendMessage('Command only allowed via DM');
		return;
	}

	if (!permissions.checkPermission(message.author.id, command.command)) {
		message.delete()
			.catch(console.error);
		message.channel.sendMessage(message.author.username + ' doesn\'t have permission to execute ' + command.command + '!');
		log.warning('User ' + message.author.username + ' (' + message.author.id + ') tried to use the command ' + command.command + ' but has insufficient permissions');
		return;
	}

	if (command) {
		if (params.length - 1 < command.parameters.length) {
			message.delete()
				.catch(console.error);
			let paramsString = '';
			for (let i = 0; i < command.parameters.length; i++) {
				paramsString += '[' + command.parameters[i] + '] ';
			}
			message.author.sendMessage('Insufficient parameters!\n!' + command.command + ' ' + paramsString.trim());
		} else {
			command.execute(message, params);
		}
	}
}

function isQueueEmpty() {
	return queue.length === 0;
}

function isBotPlaying() {
	return voiceHandler !== null;
}

function searchVideo(message, query) {
	request('https://www.googleapis.com/youtube/v3/search?part=id&type=video&q=' + encodeURIComponent(query) + '&key=' + ytApiKey, (error, response, body) => {
		const json = JSON.parse(body);
		if ('error' in json) {
			message.reply('An error has occurred: ' + json.error.errors[0].message + ' - ' + json.error.errors[0].reason);
		} else if (json.items.length === 0) {
			message.reply('No videos found matching the search criteria.');
		} else {
			addToQueue(json.items[0].id.videoId, message);
		}
	});
}

function queuePlaylist(playlistId, message, pageToken = '') {
	request('https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=' + playlistId + '&key=' + ytApiKey + '&pageToken=' + pageToken, (error, response, body) => {
		const json = JSON.parse(body);
		if ('error' in json) {
			message.reply('An error has occurred: ' + json.error.errors[0].message + ' - ' + json.error.errors[0].reason);
		} else if (json.items.length === 0) {
			message.reply('No videos found within playlist.');
		} else {
			for (let i = 0; i < json.items.length; i++) {
				addToQueue(json.items[i].snippet.resourceId.videoId, message, true);
				playlistQueued++;
			}
			if (typeof json.nextPageToken === 'undefined') {
				message.reply('👌 Queued playlist (' + playlistId + ') successfully! ' + playlistQueued + ' videos added. 🔥🔥🔥');
				return;
			}
			queuePlaylist(playlistId, message, json.nextPageToken);
		}
	});
}

function savePlaylist(playlistId, message, pageToken = '') {
	const tmpPlaylist = fs.createWriteStream('tmpPlaylist', {
		flags: 'a'
	});
	request('https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=' + playlistId + '&key=' + ytApiKey + '&pageToken=' + pageToken, (error, response, body) => {
		const json = JSON.parse(body);
		if ('error' in json) {
			message.reply('An error has occurred: ' + json.error.errors[0].message + ' - ' + json.error.errors[0].reason);
		} else if (json.items.length === 0) {
			message.reply('No videos found within playlist.');
		} else {
			for (let i = 0; i < json.items.length; i++) {
				tmpPlaylist.write('https://www.youtube.com/watch?v=' + json.items[i].snippet.resourceId.videoId + '\n');
			}
			if (typeof json.nextPageToken === 'undefined') {
				tmpPlaylist.end();
				message.channel.sendFile('tmpPlaylist', 'playlist.txt', 'Saved all videos of playlist (' + playlistId + ')').then(() => {
					fs.unlink('tmpPlaylist', err => {
						if (err) {
							console.log(err);
						}
					});
				});
				return;
			}
			savePlaylist(playlistId, message, json.nextPageToken);
		}
	});
}

function startAutoPlaylist() {
	fs.access(autoPlaylistFilePath, fs.F_OK, err => {
		if (!err) {
			const lineReader = require('readline').createInterface({
				input: require('fs').createReadStream(autoPlaylistFilePath)
			});

			lineReader.on('line', line => {
				addToQueue(getYoutubeId(line), null, true, true);
			});
		}
	});
}

// /////////////////////////////////////////////////////////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////////////////////////////////////

function getYoutubeId(string) {
	const regex = /^(?:https?:\/\/)?(?:www\.)?youtu\.?be(?:\.com)?.*?(?:v|list)=(.*?)(?:&|$)|^(?:https?:\/\/)?(?:www\.)?youtu\.?be(?:\.com)?(?:(?!=).)*\/(.*)$/gm;
	const matches = regex.exec(string);

	if (matches && matches[2]) {
		return matches[2];
	} else if (matches) {
		return matches[1];
	}
	return string;
}

function toHHMMSS(input) {
	const secNum = parseInt(input, 10); // Don't forget the second param
	let hours = Math.floor(secNum / 3600);
	let minutes = Math.floor((secNum - (hours * 3600)) / 60);
	let seconds = secNum - (hours * 3600) - (minutes * 60);

	let hourSeparator = ':';
	const minuteSeparator = ':';

	if (hours === 0) {
		hours = '';
		hourSeparator = '';
	}
	if (minutes < 10 && hours !== 0) {
		minutes = '0' + minutes;
	}
	if (seconds < 10) {
		seconds = '0' + seconds;
	}
	const time = hours + hourSeparator + minutes + minuteSeparator + seconds;
	return time;
}

function loadPermissions() {
	try {
		clearRequire('./permissions.json');
		permissions = require('./permissions.json');
	} catch (err) {
		permissions.global = {};
		permissions.users = {};
	}

	permissions.checkPermission = function (userId, permission) {
		try {
			let allowed = true;
			try {
				if (Object.prototype.hasOwnProperty.call(permissions.global, permission)) {
					allowed = permissions.global[permission] === true;
				}
			} catch (err) {
				console.log(err);
			}
			try {
				if (Object.prototype.hasOwnProperty.call(permissions.users[userId], permission)) {
					allowed = permissions.users[userId][permission] === true;
				}
			} catch (err) {
				console.log(err);
			}
			return allowed;
		} catch (err) {
			console.log(err);
		}
		return false;
	};
	return permissions;
}

function getDetails(media) {
	return new Promise(resolve => {
		switch (true) {
			case (media.indexOf('bandcamp.com') !== -1):
				bandcamp.getDetails(media).then(details => {
					resolve({
						title: details.artist + ' - ' + details.title,
						image: details.image,
						url: details.url,
						user: nowPlayingData.user
					});
				}).catch(err => {
					console.log(err);
				});
				break;
			default:
				ytdl.getInfo(media, (error, info) => {
					resolve({
						title: info.title,
						image: info.iurlmaxres,
						url: info.video_url,
						user: nowPlayingData.user,
						duration: info.length_seconds
					});
				});
				break;
		}
	});
}

// /////////////////////////////////////////////////////////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////////////////////////////////////

exports.run = function (serverId, textChannelId, voiceChannelId, aliasesPath, token, autoplayPath, autoPlay, np) { // eslint-disable-line max-params
	aliasesFilePath = aliasesPath;
	autoPlaylistFilePath = autoplayPath;
	autoPlayToggle = autoPlay;
	currentServerId = serverId;
	homeVoiceChannel = voiceChannelId;
	informNp = np;

	bot.on('ready', () => {
		const server = bot.guilds.get(serverId);
		if (server === null) {
			throw new Error('Couldn\'t find server ' + serverId);
		}

		voiceChannel = server.channels.find(chn => chn.id === voiceChannelId && chn.type === 'voice'); // The voice channel the bot will connect to
		if (voiceChannel === null) {
			throw new Error('Couldn\'t find voice channel ' + voiceChannelId + ' in server ' + serverId);
		}

		textChannel = server.channels.find(chn => chn.id === textChannelId && chn.type === 'text'); // The text channel the bot will use to announce stuff
		if (textChannel === null) {
			throw new Error('Couldn\'t find text channel #' + textChannelId + ' in server ' + serverId);
		}

		voiceChannel.join().then(connection => {
			voiceConnection = connection;
		}).catch(console.error);

		fs.access(aliasesFilePath, fs.F_OK, err => {
			if (err) {
				aliases = {};
			} else {
				try {
					aliases = JSON.parse(fs.readFileSync(aliasesFilePath));
				} catch (err) {
					aliases = {};
				}
			}
		});

		fs.access(autoPlaylistFilePath, fs.F_OK, err => {
			if (err) {
				fs.closeSync(fs.openSync(autoPlaylistFilePath, 'w'));
			}
		});

		permissions = loadPermissions();

		bot.user.setGame();

		console.log('Bot has started and is connected!');
		if (autoPlay) {
			startAutoPlaylist();
		}
	});

	bot.login(token);
};

bot.on('voiceStateUpdate', () => {
	if (voiceChannel.members.array().length < 2 && voiceHandler) {
		voiceHandler.pause();
		bot.user.setGame(nowPlayingData.title + ' (Paused)');
	} else if (voiceChannel.members.array().length >= 2 && voiceHandler) {
		voiceHandler.resume();
		bot.user.setGame(nowPlayingData.title);
	}
});

exports.setYoutubeKey = function (key) {
	ytApiKey = key;
};
