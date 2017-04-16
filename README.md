A Node.JS Discord bot that takes song requests from videos on YouTube, queues them and plays the audio of said videos on a voice channel.

I forked it from [agubelu/discord-music-bot](https://github.com/agubelu/discord-music-bot) for my personal server adding functionality and changes some existing. I send [PRs](https://github.com/agubelu/discord-music-bot/commits?author=SavageCore) back sometimes.

# Available commands
- **!aliases** - Displays the stored aliases.
- **!clearqueue** - Sets the queue to an empty state, discarding all pending requests.
- **!commands** - Displays all available commands, pretty much like this.
- **!deletealias \<alias>** - Removes an existing alias.
- **!eval \<code>** - Run code.
- **!home** - Return bot to initial voice channel.
- **!joinme** - Request the Bot to join your voice channel.
- **!np** - Displays the title of the video that is being played.
- **!pause** - Pause playback.
- **!pin \<message ID/alias>** - Pin a message.
- **!purge** - Delete all unpinned messages from text channel. Limit of 100 messages.
- **!queue** - Displays the queue.
- **!reload** - Reload bot.
- **!remove \<request index or 'last'>** - Removes a specific request from the queue. `!remove last` will delete the last request that was added.
- **!request \<video/playlist/alias>** - Adds a YouTube video or playlist to the queue. You can provide the full URL, just the video ID, full playlist URL or an alias.
- **!resume** - Allows the bot to play videos from the queue again after !stop was issued.
- **!saveplaylist \<playlist/alias>** - Send text file containing all video URLs in playlist to channel.
- **!search \<query>** - Searches for a video on YouTube and adds it to the queue. Requires a [YouTube API key](#obtaining-a-youtube-api-key).
- **!setalias \<alias> \<video>**: Maps any word of your choice (*alias*) to a video URL or ID, so you can !request the alias instead.
- **!setautoplay \<on/off>**: Sets whether the bot will autoplay from autoplayFile or not.
- **!setavatar \<image url/alias>** - Set avatar of bot.
- **!setnp \<on/off>** - Selects whether the bot will announce the title of the video it's about to play or not.
- **!setusername \<username/alias>** - Set username of bot.
- **!skip** - Skips the video that is being currently played.
- **!stop** - Stops the playback, the bot will not continue with the pending queue until !resume is issued.
- **!unpin \<message ID/alias>** - Unpin a message.

# How to make it work?

Obviously, you must install [Node.JS](https://nodejs.org/es/) if you haven't already. Any version above 6.0.0 should do. It's highly recommended that you run the server on a Linux environment, because some dependencies will probably complain if you try to install them on Windows.

Then, install the bot itself. Just open up a console, type `npm install discord-music-bot` and you're done. It should be fairly quick and painless.

Next, register a new [Discord application](https://discordapp.com/developers/applications/me) for your own instance of the bot. Keep track of the **Client ID** and your **token**.

It's time to make the bot join your server: replace your Client ID on this URL and navigate to it `https://discordapp.com/oauth2/authorize?&client_id=YOUR_CLIENT_ID_HERE&scope=bot&permissions=0`. Select the server you want the bot to join and click Authorize. This step requires that you have manage permissions on the server, otherwise it will not appear in the server list you'll be prompted with. Your bot should now appear as *Offline* in your server.

Finally, let's bring it to life! It's as simple as executing this script:
```js
var bot = require("discord-music-bot");

var serverId = "Your server ID here";
var textChannelId = "Your text channel ID here";
var voiceChannelId = "Your voice channel ID here";
var aliasesFile = "A file the bot will use to store your aliases";
var botToken = "Your bot token here";
var autoplayFile = "A file the bot will read to autoplay from. One youtube link should be entered per line in this file";
var autoPlay = true;

bot.run(serverId, textChannelId, voiceChannelId, aliasesFile, botToken, autoplayFile, autoPlay);
```
The aliases and autoplay file parameters can be just a filename or a path to a file. If it does not exist, it will be generated. If you provide a filename, it will be generated in the same folder as the previous script. Any filename will do.

The bot will join the voice channel that you configured when it connects to the server, but obviously you can move it to other voice channels once it joins or use the `!joinme` command to have the bot join you! The text channel is the one the bot will use to listen to commands and announce stuff.

Save it with whatever name you want (for instance, "bot.js") and then execute it using Node.JS: `node bot.js`. Your bot should now be up and running in your server!

Playback will pause if no clients are in the voice channel.

Any songs/playlists queued with `!request` or `!search` during playback of autoplay song will be added to the front of the queue.

# Obtaining a YouTube API key
In order to use the !search command, you must provide the bot with a YouTube API key of your own. The process is quite simple:

1. Register a Google account in the unlikely case you don't have one.
2. Create a new project in the [YouTube API Dashboard](https://console.developers.google.com/projectselector/apis/api/youtube/overview)
3. On the top bar, you will find your active project next to the Google logo. Select the newly created project if it isn't already and then click Enable to allow the project to use the YouTube API.
4. Click on "Create Credentials", select "YouTube Data API v3" on the first dialog, "Another UI" on the second and "Public data" on the third. Click the blue button and you will receive your key.
5. Add the following line in your startup script:
    ```js
    bot.setYoutubeKey("place your API key here");
    ```

# Permissions

To get user IDs turn on Developer Mode in the Discord client (`User Settings` -> `Appearance`) and then right-click your name/icon anywhere in the client and select `Copy ID`

Copy `permissions.json.example` to `permissions.json` and edit.

Global permissions are assigned to everyone, so make sure you deny access to dangerous commands. UserId is the ID you just copied.

`!commands` returns viable commands for a given user.
