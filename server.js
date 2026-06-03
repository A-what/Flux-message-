const { WebSocketServer } = require('ws');
const { Client } = require('pg');
const http = require('http');
const bcrypt = require('bcrypt');

// 1. Подключение к PostgreSQL
const db = new Client({
  connectionString: process.env.DATABASE_URL || 'postgres://localhost:5432/chat_db',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});
db.connect().catch(err => console.error('Ошибка БД:', err));

// 2. HTTP-сервер для раздачи HTML-страницы (Интерфейса)
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  
  // Отдаем HTML, CSS и JS прямо из кода сервера
  res.end(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
        <meta charset="UTF-8">
        <title>Мессенджер Челябинск-Москва</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 0; background: #f0f2f5; display: flex; justify-content: center; align-items: center; height: 100vh; }
            #auth-form, #chat-window { background: white; padding: 25px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); width: 350px; }
            .hidden { display: none !important; }
            input { width: 100%; padding: 10px; margin: 8px 0; border: 1px solid #ccc; border-radius: 6px; box-sizing: border-box; }
            button { width: 100%; padding: 10px; background: #0084ff; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; }
            button:hover { background: #006bce; }
            #search-results { margin-top: 10px; background: #f9f9f9; border-radius: 6px; max-height: 100px; overflow-y: auto; }
            .search-item { padding: 8px; cursor: pointer; border-bottom: 1px solid #eee; }
            .search-item:hover { background: #e4e6eb; }
        </style>
    </head>
    <body>

        <div id="auth-form">
            <h2>Вход / Регистрация</h2>
            <div id="auth-error" style="color: red; margin-bottom: 10px;"></div>
            <input type="text" id="username" placeholder="Ваш ник">
            <input type="password" id="password" placeholder="Пароль">
            <button id="btn-login" style="margin-bottom: 8px;">Войти</button>
            <button id="btn-register" style="background: #28a745;">Создать аккаунт</button>
        </div>

        <div id="chat-window" class="hidden">
            <h3 id="my-profile">Вы вошли как: </h3>
            
            <input type="text" id="search-input" placeholder="Найти человека по нику...">
            <div id="search-results"></div>

            <div id="chat-status" style="margin-top: 15px; color: green; font-weight: bold;"></div>
            </div>

        <script>
            // Автоматически определяем протокол (ws:// или wss:// для Render)
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const socket = new WebSocket(protocol + '//' + window.location.host);

            const authForm = document.getElementById('auth-form');
            const chatWindow = document.getElementById('chat-window');
            const authError = document.getElementById('auth-error');
            const searchResults = document.getElementById('search-results');

            // --- КНОПКА: РЕГИСТРАЦИЯ ---
            document.getElementById('btn-register').onclick = () => {
                socket.send(JSON.stringify({
                    type: 'REGISTER',
                    payload: { username: username.value, password: password.value }
                }));
            };

            // --- КНОПКА: ВХОД ---
            document.getElementById('btn-login').onclick = () => {
                socket.send(JSON.stringify({
                    type: 'LOGIN',
                    payload: { username: username.value, password: password.value }
                }));
            };

            // --- ИНПУТ: ПОИСК ПОЛЬЗОВАТЕЛЯ ---
            document.getElementById('search-input').oninput = (e) => {
                const text = e.target.value.trim();
                if(text.length > 0) {
                    socket.send(JSON.stringify({ type: 'SEARCH_USER', payload: { searchUsername: text } }));
                } else {
                    searchResults.innerHTML = '';
                }
            };

            // --- ОБРАБОТКА ОТВЕТОВ ОТ СЕРВЕРА ---
            socket.onmessage = (event) => {
                const res = JSON.parse(event.data);

                if (res.type === 'REGISTER_SUCCESS') {
                    alert('Регистрация успешна! Теперь войдите.');
                }
                if (res.type === 'LOGIN_SUCCESS') {
                    authForm.classList.add('hidden');
                    chatWindow.classList.remove('hidden');
                    document.getElementById('my-profile').innerText += ' ' + res.payload.username;
                }
                if (res.type === 'ERROR') {
                    authError.innerText = res.payload;
                }
                if (res.type === 'SEARCH_RESULTS') {
                    searchResults.innerHTML = '';
                    res.payload.forEach(user => {
                        const div = document.createElement('div');
                        div.className = 'search-item';
                        div.innerText = user.username;
                        div.onclick = () => {
                            document.getElementById('chat-status').innerText = 'Чат с ' + user.username + ' готов (логика чата будет следующей)';
                        };
                        searchResults.appendChild(div);
                    });
                }
            };
        </script>
    </body>
    </html>
  `);
});

// 3. Совмещаем WebSocket сервер с HTTP сервером
const wss = new WebSocketServer({ server });

wss.on('connection', function connection(ws) {
  ws.on('message', async function message(data) {
    try {
      const { type, payload } = JSON.parse(data);

      if (type === 'REGISTER') {
        const hashedPassword = await bcrypt.hash(payload.password, 10);
        try {
          await db.query('INSERT INTO users (username, password_hash) VALUES ($1, $2)', [payload.username, hashedPassword]);
          ws.send(JSON.stringify({ type: 'REGISTER_SUCCESS' }));
        } catch {
          ws.send(JSON.stringify({ type: 'ERROR', payload: 'Ник уже занят' }));
        }
      }

      if (type === 'LOGIN') {
        const res = await db.query('SELECT * FROM users WHERE username = $1', [payload.username]);
        if (res.rows.length === 0) return ws.send(JSON.stringify({ type: 'ERROR', payload: 'Пользователь не найден' }));
        
        const match = await bcrypt.compare(payload.password, res.rows[0].password_hash);
        if (match) {
          ws.send(JSON.stringify({ type: 'LOGIN_SUCCESS', payload: { userId: res.rows[0].id, username: res.rows[0].username } }));
        } else {
          ws.send(JSON.stringify({ type: 'ERROR', payload: 'Неверный пароль' }));
        }
      }

      if (type === 'SEARCH_USER') {
        const res = await db.query('SELECT id, username FROM users WHERE username ILIKE $1 LIMIT 5', [`%${payload.searchUsername}%`]);
        ws.send(JSON.stringify({ type: 'SEARCH_RESULTS', payload: res.rows }));
      }

    } catch (e) {
      console.error(e);
    }
  });
});

// Запуск на порту Render
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));
