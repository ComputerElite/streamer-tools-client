const electron = require('electron');
const url = require('url');
const path = require('path');
const fs = require('fs')
const express = require('express')
const api = express();
const bodyParser = require("body-parser");
const http = require('http')
const https = require('https')
const fetch = require('node-fetch')
var shell = require('shelljs');
const { clipboard } = electron
const  { networkInterfaces }  = require('os')
const { dialog } = electron
const { app } = electron
const  {BrowserWindow } = electron
const dcrp = require('discord-rich-presence')('846852034330492928');

const MulticastPort = 53500
const MulticastIp = "232.0.53.5"
const HttpPort = 53502
const ApiPort = 53510
/*
Ports:
    Multicast: 53500
    socket: 53501
    http: 53502

    local api: 53510
IP:
    Multicast: 
*/

let mainWindow;

let config;

if(fs.existsSync(path.join(__dirname, "config.json"))) {
    config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json")))
} else {
    config = {
        "ip": "",
        "interval": 100
    }
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

setInterval(() => {
    fetch("http://" + config.ip + ":" + HttpPort).then((res) => {
        res.json().then((json) => {
            raw = json
            //console.log(json)
        })
    }).catch((err) => {
        if(lastError != err.toString()) {
            lastError = err.toString();
            console.error("unable to connect to quest: " + lastError)
        }
    })
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
        console.log(err)
    })
}


function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest, { flags: "wx" });

        const request = https.get(url, response => {
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

setInterval(() => {
    UpdatePresence();
}, 1000);

function UpdatePresence() {
    dcrp.updatePresence({
        state: "Score: " + raw["score"],
        details: raw["levelName"] + " - " + raw["songAuthor"],
        instance: true
    })
}

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

api.post(`/api/postip`, async function(req, res) {
    var ipReg = /^((2(5[0-5]|[0-4][0-9])|1?[0-9]?[0-9])\.){3}(2(5[0-5]|[0-4][0-9])|1?[0-9]?[0-9])&/g
    if(req.body.ip != null && ipReg.test(req.body.ip)) {
        config.ip = req.body.ip
        saveConfig()
        console.log("ip set to: " + config.ip)
    }
})

api.post(`/api/copytoclipboard`, async function(req, res) {
    clipboard.writeText(req.body.text)
    console.log("wrote " + req.body.text + " to clipboard")
})

api.post(`/api/postinterval`, async function(req, res) {
    config.interval = req.body.interval
    saveConfig()
    console.log("interval set to: " + config.interval)
})

api.get(`/api/getip`, async function(req, res) {
    res.json({"ip": config.ip})
})
api.get(`/api/getinterval`, async function(req, res) {
    res.json({"interval": config.interval})
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

api.listen(ApiPort)