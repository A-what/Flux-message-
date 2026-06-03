const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

const users = {};   // nickname -> password
const online = {};  // nickname -> socketId

io.on("connection", (socket) => {

    // регистрация
    socket.on("register", ({ nickname, password }) => {
        if (users[nickname]) {
            socket.emit("authError", "User exists");
            return;
        }

        users[nickname] = password;
        socket.emit("authSuccess", "registered");
    });

    // логин
    socket.on("login", ({ nickname, password }) => {
        if (users[nickname] !== password) {
            socket.emit("authError", "Wrong data");
            return;
        }

        socket.nickname = nickname;
        online[nickname] = socket.id;

        socket.emit("authSuccess", "login");
    });

    // поиск пользователя по нику
    socket.on("findUser", (nickname) => {

        const exists = !!users[nickname];
        const isOnline = !!online[nickname];

        socket.emit("userFound", {
            nickname,
            exists,
            isOnline
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
