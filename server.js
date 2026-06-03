const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

const users = {};        // nickname -> password
const online = {};       // nickname -> socketId

const groups = {};       // groupId -> {name, members: []}
const messages = {};     // groupId -> [{from,text,time,status:{}}]

function genId() {
    return Math.random().toString(36).substr(2, 9);
}

io.on("connection", (socket) => {

    // регистрация
    socket.on("register", ({ nickname, password }) => {
        if (users[nickname]) return socket.emit("errorMsg", "exists");

        users[nickname] = password;
        socket.emit("ok", "registered");
    });

    // вход
    socket.on("login", ({ nickname, password }) => {
        if (users[nickname] !== password)
            return socket.emit("errorMsg", "wrong");

        socket.nickname = nickname;
        online[nickname] = socket.id;

        socket.emit("ok", "login");
        socket.emit("groupsList", Object.values(groups));
    });

    // создать группу
    socket.on("createGroup", (name) => {
        const id = genId();

        groups[id] = {
            id,
            name,
            members: [socket.nickname]
        };

        messages[id] = [];

        socket.join(id);

        io.emit("groupsList", Object.values(groups));
    });

    // вступить в группу
    socket.on("joinGroup", (groupId) => {
        const g = groups[groupId];
        if (!g) return;

        if (!g.members.includes(socket.nickname))
            g.members.push(socket.nickname);

        socket.join(groupId);

        socket.emit("groupMessages", messages[groupId] || []);
    });

    // отправка сообщения в группу
    socket.on("groupMessage", ({ groupId, text }) => {

        const msg = {
            id: genId(),
            from: socket.nickname,
            text,
            time: Date.now(),
            status: {
                sent: true,
                delivered: false,
                read: false
            }
        };

        if (!messages[groupId]) messages[groupId] = [];
        messages[groupId].push(msg);

        io.to(groupId).emit("newMessage", {
            groupId,
            message: msg
        });
    });

    // прочитано
    socket.on("readMessage", ({ groupId, messageId }) => {
        const list = messages[groupId];
        if (!list) return;

        const msg = list.find(m => m.id === messageId);
        if (!msg) return;

        msg.status.read = true;

        io.to(groupId).emit("messageUpdate", {
            groupId,
            messageId,
            status: msg.status
        });
    });

    socket.on("disconnect", () => {
        if (socket.nickname) {
            delete online[socket.nickname];
        }
    });
});

server.listen(PORT, () => {
    console.log("Server running");
});