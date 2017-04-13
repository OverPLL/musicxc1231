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

const bot = new Discord.Client({
	autoReconnect: true,
	max_message_cache: 0 // eslint-disable-line camelcase
});

const dmText = 'Hey there! Use !commands on a public chat room to see the command list.';
const mentionText = 'Use !commands to see the command list.';
let aliasesFilePath = 'aliases.json';
let autoPlaylistFilePath = 'autoplaylist.txt';

let stopped = false;
let informNp = false;
let autoPlayToggle;

const nowPlayingData = {};
let queue = [];
let aliases = {};

let voiceConnection = null;
let voiceHandler = null;
let textChannel = null;
let currentServerId = null;

let ytApiKey = null;

let adminUserId;

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
			if (stopped) {
				stopped = false;
				if (!isQueueEmpty()) {
					playNextSong();
				}
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

			const regExp = /^.*(youtu.be\/|list=)([^#&?]*).*/;
			const match = params[1].match(regExp);

			if (match && match[2]) {
				queuePlaylist(match[2], message);
			} else {
				addToQueue(params[1], message);
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
				const embed = new Discord.RichEmbed()
					.setTitle('Now playing: ' + nowPlayingData.title)
					.setImage('https://i.ytimg.com/vi/' + nowPlayingData.videoId + '/hqdefault.jpg')
					.setURL('https://www.youtube.com/watch?v=' + nowPlayingData.videoId)
					.setFooter('Requested by ' + nowPlayingData.user);
				textChannel.sendEmbed(embed);
			}
		}
	},

	{
		command: 'setnp',
		description: 'Sets whether the bot will announce the current song or not',
		parameters: ['on/off'],
		authentication: true,
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

			for (let i = 0; i < commands.length; i++) {
				const c = commands[i];
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
		authentication: true,
		execute(message) {
			queue = [];
			message.reply('Queue has been clered!');
		}
	},

	{
		command: 'remove',
		description: 'Removes a song from the queue',
		parameters: ['Request index or \'last\''],
		authentication: true,
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
		authentication: true,
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
		authentication: true,
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
		authentication: true,
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
		authentication: true,
		execute(message, params) {
			let userName = params[1];
			if (Object.prototype.hasOwnProperty.call(aliases, userName.toLowerCase())) {
				userName = aliases[userName.toLowerCase()];
			}

			bot.user.setUsername(userName).then(
					message.reply('✔ Username set!')
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
		authentication: true,
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
			savePlaylist(getPlaylistId(params[1]), message);
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

			const voiceChannel = server.channels.find(chn => chn.id === authorChannel && chn.type === 'voice'); // The voice channel the bot will connect to
			if (voiceChannel === null) {
				throw new Error('Couldn\'t find voice channel ' + authorChannel + ' in server');
			}

			voiceConnection = null;
			voiceChannel.join().then(connection => {
				voiceConnection = connection;
			}).catch(console.error);
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
	if (message.channel.type === 'dm' && message.author.id !== bot.user.id) { // Message received by DM
		// Check that the DM was not send by the bot to prevent infinite looping
		message.channel.sendMessage(dmText);
	} else if (message.channel.type === 'text' && message.channel.name === textChannel.name) { // Message received on desired text channel
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

function addToQueue(video, message, mute = false) {
	if (Object.prototype.hasOwnProperty.call(aliases, video.toLowerCase())) {
		video = aliases[video.toLowerCase()];
	}

	const videoId = getVideoId(video);

	ytdl.getInfo('https://www.youtube.com/watch?v=' + videoId, (error, info) => {
		if (error && !mute) {
			message.reply('The requested video (' + videoId + ') does not exist or cannot be played.');
			console.log('Error (' + videoId + '): ' + error);
		} else {
			if (typeof info !== 'undefined') {
				if (message) {
					queue.push({
						title: info.title,
						id: videoId,
						user: message.author.username
					});
				} else {
					queue.push({
						title: info.title,
						id: videoId,
						user: 'AutoPlay'
					});
				}
			}
			if (!mute) {
				message.reply('"' + info.title + '" has been added to the queue.');
			}
			if (!stopped && !isBotPlaying() && queue.length === 1) {
				playNextSong();
			}
		}
	});
}

function playNextSong() {
	if (isQueueEmpty()) {
		textChannel.sendMessage('The queue is empty!');
	}

	const videoId = queue[0].id;
	const title = queue[0].title;
	const user = queue[0].user;

	nowPlayingData.title = title;
	nowPlayingData.user = user;

	if (informNp) {
		const embed = new Discord.RichEmbed()
			.setTitle('Now playing: ' + title)
			.setImage('https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg')
			.setURL('https://www.youtube.com/watch?v=' + videoId)
			.setFooter('Requested by ' + user);
		textChannel.sendEmbed(embed);
		bot.user.setGame(title);
	}

	const audioStream = ytdl('https://www.youtube.com/watch?v=' + videoId, {
		filter: 'audioonly'
	});
	voiceHandler = voiceConnection.playStream(audioStream);
	voiceHandler.setVolumeDecibels('-20');

	voiceHandler.once('end', () => {
		voiceHandler = null;
		bot.user.setGame();
		if (!stopped && !isQueueEmpty()) {
			playNextSong();
		} else if (autoPlayToggle) {
			startAutoPlaylist();
		}
	});

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

	if (command && command.authentication) {
		if (!isAdminUser(message)) {
			message.delete()
        .catch(console.error);
			message.author.sendMessage('You do not have permission to use command: ' + command.command);
			log.warning('User ' + message.author.username + ' (' + message.author.id + ') tried to use the command ' + command.command + ' but has insufficient permissions');
			return;
		}
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
			}
			if (typeof json.nextPageToken === 'undefined') {
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
				addToQueue(getVideoId(line), null, true);
			});
		}
	});
}

function isAdminUser(message) {
	if (adminUserId.indexOf(message.author.id) !== -1) {
		return true;
	}
	return false;
}
// /////////////////////////////////////////////////////////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////////////////////////////////////

function getVideoId(string) {
	const regex = /(?:\?v=|&v=|youtu\.be\/)(.*?)(?:\?|&|$)/;
	const matches = string.match(regex);

	if (matches) {
		return matches[1];
	}
	return string;
}

function getPlaylistId(string) {
	const regex = /^.*(youtu.be\/|list=)([^#&?]*).*/;
	const matches = string.match(regex);

	if (matches) {
		return matches[2];
	}
	return string;
}

// /////////////////////////////////////////////////////////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////////////////////////////////////

exports.run = function (serverId, textChannelId, voiceChannelId, aliasesPath, token, autoplayPath, autoPlay, adminUser) { // eslint-disable-line max-params
	aliasesFilePath = aliasesPath;
	autoPlaylistFilePath = autoplayPath;
	autoPlayToggle = autoPlay;
	adminUserId = adminUser;
	currentServerId = serverId;

	bot.on('ready', () => {
		const server = bot.guilds.get(serverId);
		if (server === null) {
			throw new Error('Couldn\'t find server ' + serverId);
		}

		const voiceChannel = server.channels.find(chn => chn.id === voiceChannelId && chn.type === 'voice'); // The voice channel the bot will connect to
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

		bot.user.setGame();

		console.log('Connected!');
		if (autoPlay) {
			startAutoPlaylist();
		}
	});

	bot.login(token);
};

exports.setYoutubeKey = function (key) {
	ytApiKey = key;
};
