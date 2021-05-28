const electron = require('electron');
const url = require('url');
const path = require('path');
const fs = require('fs')
const express = require('express')
const api = express();
const bodyParser = require("body-parser");
const https = require('https')
const fetch = require('node-fetch')
var shell = require('shelljs');
const { clipboard } = electron
const  { networkInterfaces }  = require('os')
const { dialog } = electron
const { app } = electron
const  {BrowserWindow } = electron
const net = require('net');

const MulticastPort = 53500
const MulticastIp = "232.0.53.5"
const SocketPort = 53501
const HttpPort = 53502
const ApiPort = 53510
/*
Ports:
    Multicast: 53500
    socket: 53501
    http: 53502

    local api: 53510
IP:
    Multicast: 232.0.53.5
*/

let mainWindow;

let config;

if(fs.existsSync(path.join(__dirname, "config.json"))) {
    config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json")))
} else {
    config = {
        "ip": "ip",
        "interval": "100",
        "overlays": [
        ],
        "dcrpe": false,
        "twitch": {
            "enabled": false,
            "token": "",
            "channelname": "yourChannelName"
        },
        "oconfig": {
            "customtext": "",
            "decimals": "2",
            "dontenergy": false,
            "dontmpcode": false,
            "alwaysmpcode": false,
            "alwaysupdate": false
        },
        "srm": {
            "requestdelay": 10000
        }
    }
}

if(!fs.existsSync(path.join(__dirname, "covers"))) {
    shell.mkdir(path.join(__dirname, "covers"))
}

let raw = {}

var ipInQueue = ""

function SetupMulticast(localIP) {
    var PORT = MulticastPort;
    var HOST = localIP;
    var dgram = require('dgram');
    var client = dgram.createSocket('udp4');

    client.on('listening', function () {
        var address = client.address();
        client.setBroadcast(true)
        client.setMulticastTTL(128); 
        client.addMembership(MulticastIp, HOST);
        console.log('UDP Client listening on ' + address.address + ":" + address.port);
    });

    client.on('message', function (message, remote) {   
        console.log('Recieved multicast: ' + remote.address + ':' + remote.port +' - ' + message);
        ipInQueue = remote.address;
        NotifyClient();
    });

    client.bind(PORT, HOST);
}

function NotifyClient() {
    if(config.ip != ipInQueue) {
        var answer = dialog.showMessageBoxSync(mainWindow, {
            "message": "Incoming IP. Do you want to set this as your Quests IP? IP: " + ipInQueue,
            "buttons": ["Yes", "No"],
            "title": "Streamer tools client",
            "type": "question"
        })
        if(answer == 0) {
            config.ip = ipInQueue;
            saveConfig();
            dialog.showMessageBoxSync(mainWindow, {
                "message": "IP set to " + config.ip,
                "buttons": ["OK"],
                "title": "Streamer tools client"
            })
            mainWindow.reload();
        } else {
            console.log("IP not changed")
        }
    }
}

function GetLocalIPs() {
    const nets = networkInterfaces();
    const results = [];

    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
            if (net.family === 'IPv4' && !net.internal) {
                results.push(net.address);
                console.log("adding " + net.address)
            }
        }
    }
    return results
}

GetLocalIPs().forEach(ip => {
    SetupMulticast(ip)
})

var lastError = ""

var connected = false
var fetching = false;

var checkData = false;
var sent = false;

function checkSending() {
    if(checkData) return;
    checkData = true;
    return new Promise((resolve, reject) => {
        sent = false;
        setTimeout(() => {
            checkData = false;
            resolve(sent);
        }, 2000);
    })
}

function fetchData() {
    if(connected || fetching) return;
    fetching = true;
    fetch("http://" + config.ip + ":" + HttpPort).then((res) => {
        fetching = false;
        res.json().then((json) => {
            raw = json

            console.log("connecting with Quest")
            var socket = net.Socket();
            try {
                connected = true
                socket.connect(SocketPort, config.ip, function() {
                    console.log("connected")
                });
    
                socket.on('close', function() {
                    console.log('Lost connection with Quest');
                    connected = false;
                });
    
                socket.on('data', async function(data){
                    try {
                        raw = JSON.parse(data.toString("utf-8", 4, data.readUIntBE(0, 4) + 4))
                        sent = true;
                    } catch (err) {
                        /*
                        if(lastError != err.toString()) {
                            lastError = err.toString();
                            console.error("couldn't read/parse data from socket: " + lastError)
                        }
                        */
                    }
                })

                var connectionChecker = setInterval(() => {
                    try {
                        checkSending().then((res) => {
                            console.log("Data sent in last 2 seconds: " + res)
                            if(!res) {
                                console.log("Destroying socket to reconnect")
                                socket.destroy();
                                clearInterval(connectionChecker)
                                return;
                            }
                        })
                    } catch {}
                }, 1000);
            } catch {
                connected = false;
            }
            
        })
    }).catch((err) => {
        fetching = false;
        console.log("unable to connect to quest")
        if(lastError != err.toString()) {
            lastError = err.toString();
            console.error("unable to connect to quest: " + lastError)
        }
    })
}

setInterval(() => {
    fetchData()

    // old
    /*
    fetch("http://" + config.ip + ":" + HttpPort, {
        method: 'GET',
        headers: { 'user-agent': '1.0' }
    }).then((res) => {
        res.json().then((json) => {
            console.log("fetched")
            raw = json
        })
    }).catch((err) => {
        if(lastError != err.toString()) {
            lastError = err.toString();
            console.error("unable to connect to quest: " + lastError)
        }
    })
    */
}, config.interval);



UpdateOverlays().then(() => {
    if(config.overlays.length != undefined) {
        CheckOverlaysDownloaded();
    }
});

function CheckOverlaysDownloaded() {
    for(let i = 0; i < config.overlays.length; i++) {
        var dir = path.join(__dirname, "overlays", config.overlays[i].Name)
        if(fs.existsSync(dir)) {
            config.overlays[i].downloaded = true;
        } else {
            config.overlays[i].downloaded = false;
        }
    }
}

function UpdateOverlays() {
    return new Promise((resolve, reject) => {
        fetch("https://computerelite.github.io/tools/Streamer_Tools_Quest_Overlay/overlays.json").then((res) => {
            res.json().then((json) => {
                var configBackup = config;
                config.overlays = json.overlays;
                configBackup.overlays.forEach(overlay => {
                    var exists = false;
                    config.overlays.forEach(item => {
                        if(item.Name == overlay.Name)
                        {
                            exists = true;
                            return;
                        }
                    })
                    if(!exists) config.overlays.push(overlay)
                })
                saveConfig();
                resolve();
            })
        })
    })
    
}

function saveConfig() {
    writeToFile(path.join(__dirname, "config.json"), JSON.stringify(config))
}

function writeToFile(file, contents) {
    fs.writeFile(file, contents, err => {
    })
}


function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest, { flags: "wx" });
        var parsed = new URL(url)

        const options = {
            hostname: parsed.hostname,
            port: parsed.port,
            path: parsed.pathname,
            method: 'GET',
            headers: {
                'User-Agent': 'streamer-tools-client/1.0'
            }
          }
        const request = https.get(options, response => {
            if (response.statusCode === 200) {
                response.pipe(file);
            } else {
                file.close();
                fs.unlink(dest, () => {}); // Delete temp file
                reject(`Server responded with ${response.statusCode}: ${response.statusMessage}`);
            }
        });

        request.on("error", err => {
            file.close();
            fs.unlink(dest, () => {}); // Delete temp file
            reject(err.message);
        });

        file.on("finish", () => {
            resolve();
        });

        file.on("error", err => {
            file.close();

            if (err.code === "EEXIST") {
                reject("File already exists");
            } else {
                fs.unlink(dest, () => {}); // Delete temp file
                reject(err.message);
            }
        });
    });
}

//////////////////////////////////////Discord rich presence///////////////////////////////////////
if(config.dcrpe != undefined && config.dcrpe) {
    console.log("enabling dcrp")
    const dcrp = require('discord-rich-presence')('846852034330492928')

    setInterval(() => {
        UpdatePresence();
    }, 1000);

    function intToDiff(diff) {
        switch (diff)
        {
            case 0:
                return "Easy";
            case 1:
                return "Normal";
            case 2:
                return "Hard";
            case 3:
                return "Expert";
            case 4:
                return "Expert +";
        }
        return "Unknown";
    }

    function trim(input) {
        return input.toFixed(2)
    }

    function UpdatePresence() {
        // Application
        // details
        // State
        var songStart = new Date();
        songStart.setSeconds(songStart.getSeconds() - raw.time)
        var songEnd = new Date();
        songEnd.setSeconds(songEnd.getSeconds() - raw.time + raw.endTime)
        var smallText = "Presence by streamer tools,\nclient by ComputerElite"
        switch(raw.location) {
            case 1:
                // Solo song
                dcrp.updatePresence({
                    state: raw.songAuthor + " [" + raw.levelAuthor + "]",
                    details: raw["levelName"] + " (" + intToDiff(raw.difficulty) + ")",
                    startTimestamp: songStart,
                    endTimestamp: songEnd,
                    smallImageText: smallText,
                    smallImageKey: 'stc',
                    largeImageText: 'Score: ' + raw.score + " acc: " + trim(raw.accuracy * 100) + " %",
                    largeImageKey: 'bs',
                    instance: true
                })
                break;
            case 2:
                // mp song
                dcrp.updatePresence({
                    state: raw.songAuthor + " [" + raw.levelAuthor + "]",
                    details: "[MP] " + raw["levelName"] + " (" + intToDiff(raw.difficulty) + ")",
                    startTimestamp: songStart,
                    endTimestamp: songEnd,
                    smallImageText: smallText,
                    smallImageKey: 'stc',
                    largeImageText: 'Score: ' + raw.score + " acc: " + trim(raw.accuracy * 100) + " %",
                    largeImageKey: 'bs',
                    instance: true
                })
                break;
            case 3:
                // tutorial
                dcrp.updatePresence({
                    state: "learning how to beat saber",
                    details: "In tutorial",
                    smallImageText: smallText,
                    smallImageKey: 'stc',
                    largeImageText: 'Score: ' + raw.score + " acc: " + trim(raw.accuracy * 100) + " %",
                    largeImageKey: 'bs',
                    instance: true
                })
                break;
            case 4:
                // campaign
                dcrp.updatePresence({
                    state: raw.songAuthor + " [" + raw.levelAuthor + "]",
                    details: "[Campaign] " + raw["levelName"] + " (" + intToDiff(raw.difficulty) + ")",
                    startTimestamp: songStart,
                    endTimestamp: songEnd,
                    smallImageText: smallText,
                    smallImageKey: 'stc',
                    largeImageText: 'Score: ' + raw.score + " acc: " + trim(raw.accuracy * 100) + " %",
                    largeImageKey: 'bs',
                    instance: true
                })
                break;
            case 5:
                // mp lobby
                dcrp.updatePresence({
                    state: raw.players + "/" + raw.maxPlayers + " players",
                    details: "In multiplayer lobby",
                    smallImageText: smallText,
                    smallImageKey: 'stc',
                    largeImageKey: 'bs',
                    instance: true
                })
                break;
            default:
                if(raw.location == 0) {
                    dcrp.updatePresence({
                        state: "Selecting songs",
                        details: "In menu",
                        smallImageText: smallText,
                        smallImageKey: 'stc',
                        largeImageKey: 'bs',
                        instance: true
                    })
                } else {
                    dcrp.updatePresence({
                        state: "Quest might not be conntected",
                        details: "No info available",
                        smallImageText: smallText,
                        smallImageKey: 'stc',
                        largeImageKey: 'bs',
                        instance: true
                    })
                }
                
                break;
        }
    }
}


/////////////////// Twitch bot////////////////////////
function BSaverRequest(key) {
    return new Promise((resolve, reject) => {
        console.log("requesting")
        fetch("https://beatsaver.com/api/maps/detail/" + key, {headers: { 'User-Agent': 'Streamer-tools-client/1.0' }}).then((result) => {
            result.json().then((json) => {
                resolve(json)
            }).catch((err) => {
                console.log("request failed")
                resolve("error")
            })
            
        }).catch((err) => {
            resolve("error")
        })
    })
    
}

var srm = []

if(config.twitch != undefined && config.twitch.token != undefined && config.twitch.channelname != undefined && config.twitch.enabled) {
    const tmi = require('tmi.js');

    const client = new tmi.Client({
    options: { debug: true },
    connection: {
        secure: true,
        reconnect: true
    },
    identity: {
        username: 'streamer-tools-client',
        password: config.twitch.token
    },
    channels: [config.twitch.channelname]
    });

    client.connect();

    var lastRequest = new Date();

    client.on('message', (channel, tags, message, self) => {
        if(self) return;

        console.log("recived message via twitch: [" + channel + "] <" + tags.username + "> " + message)
        if(message.toLowerCase().startsWith("!bsr")) {
            console.log("bsr")
            var msg = message.split(" ");
            if(msg.length >= 2) {
                var key = msg[1].toLowerCase()
                for(let i = 0; i < srm.length; i++) {
                    if(srm[i].key == key) {
                        srm[i].requested++;
                        client.say(channel, `@${tags.username} requested ${srm[i].name} (${srm[i].key}). It has noe been requested ${srm[i].requested}`)
                        return
                    }
                }

                if((new Date().getTime() - lastRequest.getTime()) < config.srm.requestdelay) {
                    client.say(channel, `@${tags.username} ${config.twitch.channelname} only allows ${(60000 / config.srm.requestdelay)} requests per minute`)
                    return
                }
                lastRequest = new Date()
                BSaverRequest(key).then((res) => {
                    if(res == "error") {
                        client.say(channel, `@${tags.username} Song ${key} doesn't exist. Please check BeatSaver for valid songs.`)
                    } else {   

                        console.log(`@${tags.username} requested ${res.name} (${key})`)
                        
                        if(config.srm != undefined && config.srm.maxsonglength != undefined && res.metadata.duration > config.srm.maxsonglength) {
                            console.log(`Song is too long`)
                            client.say(channel, `@${tags.username} the song you requested is ${res.metadata.duration - config.srm.maxsonglength} seconds too long. Only a maximum length of ${config.srm.maxsonglength} seconds is allowed`)
                            return;
                        }
                        client.say(channel, `@${tags.username} requested ${res.name} (${key})`)
                        if(!fs.existsSync(path.join(__dirname, "covers", res.key + ".png"))) {
                            console.log("downloading cover of song " + res.key)
                            downloadFile(`https://beatsaver.com${res.coverURL}`, path.join(__dirname, "covers", res.key + ".png"))
                        }
                        var request = {
                            "name": res.name,
                            "key": res.key,
                            "coverURL": `http://localhost:${ApiPort}/covers/${res.key}.png`,
                            "requested": 1,
                            "length": res.metadata.duration,
                            "hash": res.hash
                        }
                        srm.unshift(request)
                    }
                })
                
            }
        }
    });
}


/////////////////////////////////////////////////////////////////////

function downloadOverlay(overlay) {
    console.log("Downloading " + overlay.Name)
    var dir = path.join(__dirname, "overlays", overlay.Name)
    if(fs.existsSync(dir)) {
        fs.rmdirSync(dir, {recursive: true}, err => {
            console.log("error while deleting existing dir: " + err)
        })
    }
    shell.mkdir(dir)
    overlay.downloads.forEach(async function(download)  {
        const fdir = path.join(dir, download.Path.substring(0, download.Path.lastIndexOf('/')))
        if(!fs.existsSync(fdir)) {
            shell.mkdir('-p', fdir);
        }
        downloadFile(download.URL, path.join(dir, download.Path))
    });
    CheckOverlaysDownloaded();
}

app.on('ready', () => {
    mainWindow = new BrowserWindow({});

    mainWindow.setIcon(path.join(__dirname, "assets", "stc.png"))

    mainWindow.loadURL(url.format({
        pathname: path.join(__dirname, "html", "index.html"),
        protocol: 'file',
        slashes: true
    }))

})

api.use(bodyParser.urlencoded({ extended: true }));
api.use(bodyParser.json());
api.use(bodyParser.raw());

api.post(`/api/download`, async function(req, res) {
    config.overlays.forEach(overlay => {
        if(overlay.Name == req.body.Name) {
            downloadOverlay(overlay);
        }
    })
    mainWindow.loadURL(url.format({
        pathname: path.join(__dirname, "html", "downloads.html"),
        protocol: 'file',
        slashes: true
    }))
})

// Really really chonky
api.post(`/api/postconfig`, async function(req, res) {
    if(config.twitch == undefined) {
        config.twitch = {}
    }
    if(config.oconfig == undefined) {
        config.oconfig = {}
    }
    if(req.body.ip != undefined) {
        var ipReg = /^((2(5[0-5]|[0-4][0-9])|1?[0-9]?[0-9])\.){3}(2(5[0-5]|[0-4][0-9])|1?[0-9]?[0-9])$/g
    
        if(ipReg.test(req.body.ip)) {
            config.ip = req.body.ip
            
            console.log("config.ip set to: " + config.ip)
        } else {
            console.log("config.ip (" + req.body.ip + ") not valid")
        }
    }
    if(req.body.interval != undefined) {
        config.interval = req.body.interval
        console.log("config.interval set to: " + config.interval)
    }
    if(req.body.dcrpe != undefined) {
        config.dcrpe = req.body.dcrpe
        console.log("config.dcrpe set to: " + config.dcrpe)
    }
    if(req.body.srm != undefined) {
        if(config.srm == undefined) config.srm = {}
        if(req.body.srm.requestdelay != undefined) {
            config.srm.requestdelay = req.body.srm.requestdelay
            console.log("config.srm.requestdelay set to: " + config.srm.requestdelay)
        }
        if(req.body.srm.maxsonglength != undefined) {
            config.srm.maxsonglength = req.body.srm.maxsonglength
            console.log("config.srm.maxsonglength set to: " + config.srm.maxsonglength)
        }
    }

    // Twitch config
    if(req.body.twitch != undefined) {
        if(config.twitch == undefined) config.twitch = {}
        if(req.body.twitch.enabled != undefined) {
            config.twitch.enabled = req.body.twitch.enabled
            console.log("config.twitch.enabled set to: " + config.twitch.enabled)
        }
        if(req.body.twitch.token != undefined) {
            config.twitch.token = req.body.twitch.token
            console.log("config.twitch.token set to: " + config.twitch.token)
        }
        if(req.body.twitch.channelname != undefined) {
            config.twitch.channelname = req.body.twitch.channelname
            console.log("config.twitch.channelname set to: " + config.twitch.channelname)
        }
    }

    // overlay config
    if(req.body.oconfig) {
        if(config.oconfig == undefined) config.oconfig = {}
        if(req.body.oconfig.customtext != undefined) {
            config.oconfig.customtext = req.body.oconfig.customtext
            console.log("config.oconfig.customtext set to: " + config.oconfig.customtext)
        }
        if(req.body.oconfig.decimals != undefined) {
            config.oconfig.decimals = req.body.oconfig.decimals
            console.log("config.oconfig.decimals set to: " + config.oconfig.decimals)
        }
        if(req.body.oconfig.dontenergy != undefined) {
            config.oconfig.dontenergy = req.body.oconfig.dontenergy
            console.log("config.oconfig.dontenergy set to: " + config.oconfig.dontenergy)
        }
        if(req.body.oconfig.dontmpcode != undefined) {
            config.oconfig.dontmpcode = req.body.oconfig.dontmpcode
            console.log("config.oconfig.dontmpcode set to: " + config.oconfig.dontmpcode)
        }
        if(req.body.oconfig.alwaysmpcode != undefined) {
            config.oconfig.alwaysmpcode = req.body.oconfig.alwaysmpcode
            console.log("config.oconfig.alwaysmpcode set to: " + config.oconfig.alwaysmpcode)
        }
        if(req.body.oconfig.alwaysupdate != undefined) {
            config.oconfig.alwaysupdate = req.body.oconfig.alwaysupdate
            console.log("config.oconfig.alwaysupdate set to: " + config.oconfig.alwaysupdate)
        }
    }

    saveConfig()
})

api.post(`/api/copytoclipboard`, async function(req, res) {
    clipboard.writeText(req.body.text)
    console.log("wrote " + req.body.text + " to clipboard")
})

api.post(`/api/removerequest`, async function(req, res) {
    for(let i = 0; i < srm.length; i++) {
        if(req.body.key == srm[i].key) {
            srm.splice(i, 1)
            console.log("removed song request at index " + i + " (" + req.body.key + ")")
            return;
        }
    }
})

api.get(`/api/getconfig`, async function(req, res) {
    res.json(config)
})

api.get(`/api/getOverlay`, async function(req, res) {
    var Url = new URL("http://localhost:" + ApiPort + req.url)
    var name = Url.searchParams.get("name")
    var success = false;
    config.overlays.forEach(overlay => {
        if(overlay.Name == name && overlay.downloaded) {
            overlay.downloads.forEach(download => {
                if(download.IsEntryPoint) {
                    res.redirect(url.format({
                        pathname:"/overlays/" + overlay.Name + "/" + download.Path,
                        query: req.query,
                      }));
                    success = true
                    return;
                }
            })
        }
        if(success) return
    })
    if(!success) res.json({"msg": "error"})
})

api.get(`/api/requests`, async function(req, res) {
    res.json(srm)
})

api.get(`/windows/home`, async function(req, res) {
    mainWindow.loadURL(url.format({
        pathname: path.join(__dirname, "html", "index.html"),
        protocol: 'file',
        slashes: true
    }))
})

api.get(`/windows/overlays`, async function(req, res) {
    mainWindow.loadURL(url.format({
        pathname: path.join(__dirname, "html", "overlays.html"),
        protocol: 'file',
        slashes: true
    }))
})

api.get(`/windows/downloads`, async function(req, res) {
    mainWindow.loadURL(url.format({
        pathname: path.join(__dirname, "html", "downloads.html"),
        protocol: 'file',
        slashes: true
    }))
})

api.get(`/windows/srm`, async function(req, res) {
    mainWindow.loadURL(url.format({
        pathname: path.join(__dirname, "html", "srm.html"),
        protocol: 'file',
        slashes: true
    }))
})

api.get(`/api/overlays`, async function(req, res) {
    res.json(config.overlays)
})

api.get(`/api/raw`, async function(req, res) {
    var Url = new URL("http://localhost:" + ApiPort + req.url)
    var ip = Url.searchParams.get("ip")
    if(ip != null && ip != "" && ip != "null" && Url.searchParams.get("nosetip") == null) {
        config.ip = ip;
    }
    res.header("Access-Control-Allow-Origin", "*")
    res.json(raw)
})

api.use("/overlays", express.static(path.join(__dirname, "overlays")))
api.use("/covers", express.static(path.join(__dirname, "covers")))

api.listen(ApiPort)