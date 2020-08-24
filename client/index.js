const config = require('./config/config');
const path = require('path');
const express = require('express');
const socketIo = require('socket.io');

const configExpress = require('./config/express');

const app = configExpress();


/*app.route('/app')
    .get((req, res) =>
        res.sendFile(path.join(__dirname, "build/index.html"))
    );
    */

app.use(express.static('build'));
app.use(express.static('public'));

const server = app.listen(config.port, () => console.log(`Server started at port ${config.port}.`));

const io = socketIo(server, { origins: '*:*' });
