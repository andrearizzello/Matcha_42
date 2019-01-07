var express = require('express');
var app = express();
var fs = require('fs');
var hbs = require('express-handlebars');
var partials = require('hbs');
var helmet = require('helmet');
var regex = require('regex-email');
var bcrypt = require('bcrypt');
var md5 = require('md5');
var randomstring = require("randomstring");
var session = require('express-session');
var sendmail = require('sendmail')({silent: true});
var Jimp = require('jimp');
var debug = require('debug')('matcha-api:server');
var http = require('http');
var server = http.createServer(app);
var mysql = require('mysql2');
var moment = require('moment');
moment().format();
var trim = require('trim');
var fetch = require('node-fetch');
var sort = require('fast-sort');
var Clarifai = require('clarifai');
var io = require('socket.io')(server);
var connection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'root451#',
    database: 'matcha'
});
var clariapp = new Clarifai.App({apiKey: 'REPLACE'});
var people = [];

io.on('connection', (usr) => {
    usr.on('join', (name) => {
        people.push({
            id: usr.id,
            username: name
        });
    });
    usr.on("disconnect", () => {
        people = people.filter(user => user.id !== usr.id);
    });
});

server.listen(3000);
server.on('error', onError);
server.on('listening', onListening);
app.engine('.hbs', hbs({extname: '.hbs'}));
app.set('view engine', '.hbs');
app.set('trust proxy', 1);
app.set('port', 3000);

partials.registerPartials(__dirname + '/views/partials');

app.use(session({
    name: 'SESSION',
    secret: 'andreamatcharandom1',
    resave: false,
    saveUninitialized: false
}));
app.use(helmet());
app.use(express.urlencoded({extended: true, limit: '50mb'}));
app.use(express.static('static'));
app.use('/izitoast', express.static(__dirname + '/node_modules/izitoast/dist/'));
app.use('/owl.carousel', express.static(__dirname + '/node_modules/owl.carousel'));
app.use('/jquery', express.static(__dirname + '/node_modules/jquery'));

function onError(error) {
    if (error.syscall !== 'listen') {
        throw error;
    }

    var bind = typeof port === 'string'
        ? 'Pipe ' + port
        : 'Port ' + port;

    // handle specific listen errors with friendly messages
    switch (error.code) {
        case 'EACCES':
            console.error(bind + ' requires elevated privileges');
            process.exit(1);
            break;
        case 'EADDRINUSE':
            console.error(bind + ' is already in use');
            process.exit(1);
            break;
        default:
            throw error;
    }
}

function onListening() {
    var addr = server.address();
    var bind = typeof addr === 'string'
        ? 'pipe ' + addr
        : 'port ' + addr.port;
    debug('Listening on ' + bind);
}

function clearUserInput(body) {
    let User = {};
    if (body.username !== undefined && body.username.length > 1 && body.username.length < 15)
        User.username = body.username;
    if (body.firstname !== undefined && body.firstname.length > 1 && body.firstname.length < 20)
        User.firstname = body.firstname;
    if (body.lastname !== undefined && body.lastname.length > 1 && body.lastname.length < 20)
        User.lastname = body.lastname;
    if (body.email !== undefined && regex.test(body.email))
        User.email = body.email;
    if (body.password !== undefined && body.password.length >= 8)
        User.password = bcrypt.hashSync(body.password, 10);
    if (User.username !== undefined && User.password !== undefined)
        User.hash = md5(User.username + User.password);
    if (Object.keys(User).length < 6)
        return undefined;
    return User;
}

async function areUsersInArea(listUsers, cityFrom, max_distance) {
    max_distance *= 1000;
    cityFrom = trim(cityFrom);
    if (cityFrom.length > 0) {
        let value = await fetch(`https://geocoder.api.here.com/6.2/geocode.json?app_id=REPLACE&app_code=REPLACE&searchtext=${cityFrom}`);
        value = await value.json();
        if (value.Response.View.length < 1) return [];
        let geoFrom = value.Response.View[0].Result[0].Location.DisplayPosition;
        for (let i = 0; i < listUsers.length; i++) {
            let preGeoTo = await fetch(`https://geocoder.api.here.com/6.2/geocode.json?app_id=REPLACE&app_code=REPLACE&searchtext=${encodeURI(listUsers[i].position)}`);
            preGeoTo = await preGeoTo.json();
            let geoTo = preGeoTo.Response.View[0].Result[0].Location.DisplayPosition;
            let finalTrack = await fetch(`https://route.api.here.com/routing/7.2/calculateroute.json?app_id=REPLACE&app_code=REPLACE&waypoint0=geo!${geoFrom.Latitude},${geoFrom.Longitude}&waypoint1=geo!${geoTo.Latitude},${geoTo.Longitude}&mode=fastest;car;traffic:disabled`);
            finalTrack = await finalTrack.json();
            if (finalTrack.subtype === 'NoRouteFound' || finalTrack.response.route[0].summary.distance > max_distance) {
                listUsers.splice(i--, 1);
            }
        }
        return listUsers
    }
}

async function getRealAddress(address) {
    let value = await fetch(`https://geocoder.api.here.com/6.2/geocode.json?app_id=REPLACE&app_code=REPLACE&searchtext=${address}`);
    value = await value.json();
    if (value.Response.View.length === 0) return 'Error';
    value = value.Response.View[0].Result[0].Location.Address;
    let finalAddr = '';
    if (value.City) finalAddr = `${value.City}, `;
    if (value.District) finalAddr += `${value.District}, `;
    if (value.PostalCode) finalAddr += `${value.PostalCode}, `;
    if (value.City) {
        if (!value.District && !value.PostalCode) finalAddr += `${value.City}, `;
    } else return 'Error';
    finalAddr += value.Country;
    return finalAddr;
}

async function orderByArea(listUsers, myAddress) {
    if (!listUsers) return listUsers;
    let myPosition = await fetch(`https://geocoder.api.here.com/6.2/geocode.json?app_id=REPLACE&app_code=REPLACE&searchtext=${encodeURI(myAddress)}`);
    myPosition = await myPosition.json();
    myPosition = myPosition.Response.View[0].Result[0].Location.DisplayPosition;
    for (let i = 0; i < listUsers.length; i++) {
        let userPosition = await fetch(`https://geocoder.api.here.com/6.2/geocode.json?app_id=REPLACE&app_code=REPLACE&searchtext=${encodeURI(listUsers[i].position)}`);
        userPosition = await userPosition.json();
        userPosition = userPosition.Response.View[0].Result[0].Location.DisplayPosition;
        let distance = await fetch(`https://route.api.here.com/routing/7.2/calculateroute.json?app_id=REPLACE&app_code=REPLACE&waypoint0=geo!${myPosition.Latitude},${myPosition.Longitude}&waypoint1=geo!${userPosition.Latitude},${userPosition.Longitude}&mode=fastest;car;traffic:disabled`);
        distance = await distance.json();
        if (distance.subtype !== 'NoRouteFound') listUsers[i].totDistance = distance.response.route[0].summary.distance;
    }
    sort(listUsers).asc(u => u.totDistance);
    for (let i = 0; i < listUsers.length; i++) {
        if (listUsers[i].totDistance > 1000) {
            listUsers[i].totDistance = Math.floor(listUsers[i].totDistance / 1000);
            listUsers[i].unitMesure = 'km'
        } else {
            listUsers[i].totDistance = Infinity;
            listUsers[i].unitMesure = 'mt'
        }
    }
    return listUsers;
}

//Allow only POST/GET REQUEST
app.use((req, res, next) => {
    (req.method !== 'POST' && req.method !== 'GET') ? res.status(400).json({
        status: 'Error',
        msg: 'Only POST or GET request are accepted'
    }) : next();
});

app.get('/verify', (req, res) => {
    connection.query('UPDATE users SET verifyhash = ? WHERE verifyhash = ?', ['OK', req.query.hash],
        (err, results) => {
            if (err) return res.status(500).send('And error occurred in verify while updating');
            if (results.changedRows) return res.send('User activated successfully');
            res.status(500).send('Warning! No user was updated, this means that the user is already verified');
        })
});

app.get('/register', (req, res) => {
    if (req.session.user)
        return res.redirect('/profile');
    res.render('register');
});

app.get('/search', (req, res) => {
    if (req.session.user === undefined) return res.redirect('/login');
    let missing = [];
    let user = req.session.user;
    user.gender === null ? missing.push('GENDER') : null;
    user.biography === null ? missing.push('BIOGRAPHY') : null;
    user.pictures.length === 0 ? missing.push('PROFILE PICTURE') : null;
    user.age === null ? missing.push('AGE') : null;
    if (missing.length > 0) return res.redirect('/profile');

    let filterSex = '';
    switch (user.sex_pref) {
        case 'Heterosexual': {
            filterSex += user.gender === 'Male' ? ' AND gender = "Female" AND (sex_pref = "Heterosexual" OR sex_pref = "Bisexual")' : ' AND gender = "Male" AND (sex_pref = "Heterosexual" OR sex_pref = "Bisexual")';
        }
            break;
        case 'Homosexual': {
            filterSex += user.gender === 'Male' ? ' AND gender = "Male" AND (sex_pref = "Homosexual" OR sex_pref = "Bisexual")' : ' AND gender = "Female" AND (sex_pref = "Homosexual" OR sex_pref = "Bisexual")';
        }
            break;
        case 'Bisexual': {
            filterSex += user.gender === 'Male' ? ' AND ((gender = "Male" AND (sex_pref = "Bisexual" OR sex_pref = "Homosexual")) OR (gender = "Female" AND (sex_pref = "Heterosexual" OR sex_pref = "Bisexual")))' : ' AND ((gender = "Female" AND (sex_pref = "Bisexual" OR sex_pref = "Homosexual")) OR (gender = "Male" AND (sex_pref = "Heterosexual" OR sex_pref = "Bisexual")))';
        }
            break;
    }
    let query = 'SELECT idusers, location, firstname, lastname, username, CONCAT(SUBSTR(biography, 1, 50), "...") as biography, DATE_FORMAT(lastonline, "%Y-%m-%d") as lastonline, popularity, TIMESTAMPDIFF(YEAR, age, NOW()) AS age, position from users, pictures where idOwner = idusers AND biography NOT LIKE \'\' AND gender NOT LIKE \'\' AND age NOT LIKE \'\' AND idusers NOT LIKE ? AND isMain = 1 AND idusers NOT IN (SELECT idBlocked FROM blocked_users WHERE idBlocker = ? UNION SELECT idBlocker FROM blocked_users WHERE idBlocked = ?)';
    query += filterSex;
    if (!isNaN(req.query.min_age) && !isNaN(req.query.min_age) && req.query.min_age === req.query.max_age) {
        query += ` AND TIMESTAMPDIFF(YEAR, age, NOW()) = ${req.query.min_age}`;
    } else {
        if (!isNaN(req.query.min_age)) query += ` AND TIMESTAMPDIFF(YEAR, age, NOW()) >= ${req.query.min_age}`;
        if (!isNaN(req.query.max_age)) query += ` AND TIMESTAMPDIFF(YEAR, age, NOW()) <= ${req.query.max_age}`;
    }
    if (!isNaN(req.query.min_pupularity) && !isNaN(req.query.max_popularity) && req.query.min_popularity === req.query.max_popularity) {
        query += ` AND popularity = ${req.query.min_popularity}`
    } else {
        if (!isNaN(req.query.min_popularity)) query += ` AND popularity >= ${req.query.min_popularity}`;
        if (!isNaN(req.query.max_popularity)) query += ` AND popularity <= ${req.query.max_popularity}`;
    }
    connection.query(query, [req.session.user.idusers, req.session.user.idusers, req.session.user.idusers],
        async (err, results) => {
            if (err) return res.status(500).send('And error occurred in search while getting profiles');
            let listuser = results;
            if (req.query.city) {
                req.query.city = await encodeURI(req.query.city);
                listuser = await areUsersInArea(listuser, req.query.city, req.query.max_distance);
            }
            if (req.query.tags) {
                if (!Array.isArray(req.query.tags)) req.query.tags = [req.query.tags];
                connection.query('SELECT DISTINCT idusers from users, tag_user WHERE iduser = idusers AND idtag IN (?)', req.query.tags.join(),
                    async (err, results) => {
                        if (err) return res.status(500).send('And error occurred in search while selecting');
                        listuser = listuser.filter(user => {
                            let found = false;
                            results.forEach(result => {
                                if (result.idusers === user.idusers) found = true;
                            });
                            return found
                        });
                        listuser = await orderByArea(listuser, req.session.user.position);
                        listuser.forEach(user => {
                            people.map(user_sockets => {
                                if (user_sockets.username === user.idusers.toString())
                                    user.lastonline = 'now';
                            })
                        });
                        connection.query('SELECT idtags, tag_name FROM tags',
                            (err, results) => {
                                if (err) return res.status(500).send('And error occurred in search while selecting tags');
                                let tags = results.map((element) => {
                                    return {
                                        id: element.idtags,
                                        value: element.tag_name
                                    }
                                });
                                connection.query('SELECT iduser_watched from seen where iduser_watcher = ? AND liked = 1', req.session.user.idusers,
                                    (err, results) => {
                                        if (err) return res.status(500).send('And error occurred in search while getting seen');
                                        if (results.length > 0) listuser = listuser.map(element => {
                                            results.map(result => {
                                                if (element.idusers === result.iduser_watched)
                                                    element.liked = 1;
                                            });
                                            return element;
                                        });
                                        connection.query('SELECT COUNT(*) as notification FROM seen WHERE iduser_watched = ? AND notificated = 0', req.session.user.idusers,
                                            (err, results) => {
                                                if (err) return res.status(500).send('And error occurred in search while counting');
                                                var notifications = results[0].notification;
                                                connection.query('SELECT COUNT(*) as messages from (SELECT DISTINCT idsender FROM messages WHERE idreceiver = ? AND notificated = 0) as tmp', req.session.user.idusers,
                                                    (err, results) => {
                                                        if (err) return res.status(500).send('And error occurred in search while counting 2');
                                                        if (req.query.sortby === 'popularity')
                                                            sort(listuser).desc(u => u.popularity);
                                                        if (req.query.sortby === 'age')
                                                            sort(listuser).asc(u => u.age);
                                                        res.render('search', {
                                                            user: req.session.user,
                                                            tags,
                                                            listuser,
                                                            notifications,
                                                            messages: results[0].messages,
                                                            helpers: {
                                                                ifCon: function (v1, operator, v2, options) {
                                                                    switch (operator) {
                                                                        case '==':
                                                                            return (v1 == v2) ? options.fn(this) : options.inverse(this);
                                                                        case '===':
                                                                            return (v1 === v2) ? options.fn(this) : options.inverse(this);
                                                                        case '!=':
                                                                            return (v1 != v2) ? options.fn(this) : options.inverse(this);
                                                                        case '!==':
                                                                            return (v1 !== v2) ? options.fn(this) : options.inverse(this);
                                                                        case '<':
                                                                            return (v1 < v2) ? options.fn(this) : options.inverse(this);
                                                                        case '<=':
                                                                            return (v1 <= v2) ? options.fn(this) : options.inverse(this);
                                                                        case '>':
                                                                            return (v1 > v2) ? options.fn(this) : options.inverse(this);
                                                                        case '>=':
                                                                            return (v1 >= v2) ? options.fn(this) : options.inverse(this);
                                                                        case '&&':
                                                                            return (v1 && v2) ? options.fn(this) : options.inverse(this);
                                                                        case '||':
                                                                            return (v1 || v2) ? options.fn(this) : options.inverse(this);
                                                                        default:
                                                                            return options.inverse(this);
                                                                    }
                                                                },
                                                                getLength: function (obj) {
                                                                    return obj.length;
                                                                }
                                                            }
                                                        })
                                                    })
                                            })
                                    })
                            })
                    });
            } else {
                listuser = await orderByArea(listuser, req.session.user.position);
                listuser.forEach(user => {
                    people.map(user_sockets => {
                        if (user_sockets.username === user.idusers.toString())
                            user.lastonline = 'now';
                    })
                });
                connection.query('SELECT idtags, tag_name FROM tags',
                    (err, results) => {
                        if (err) return res.status(500).send('And error occurred in search while getting tags 2');
                        let tags = results.map((element) => {
                            return {
                                id: element.idtags,
                                value: element.tag_name
                            }
                        });
                        connection.query('SELECT iduser_watched from seen where iduser_watcher = ? AND liked = 1', req.session.user.idusers,
                            (err, results) => {
                                if (err) return res.status(500).send('And error occurred in search while getting seen 2');
                                if (results.length > 0) listuser = listuser.map(element => {
                                    results.map(result => {
                                        if (element.idusers === result.iduser_watched)
                                            element.liked = 1;
                                    });
                                    return element;
                                });
                                connection.query('SELECT COUNT(*) as notification FROM seen WHERE iduser_watched = ? AND notificated = 0', req.session.user.idusers,
                                    (err, results) => {
                                        if (err) return res.status(500).send('And error occurred in search while counting notifications');
                                        var notifications = results[0].notification;
                                        connection.query('SELECT COUNT(*) as messages from (SELECT DISTINCT idsender FROM messages WHERE idreceiver = ? AND notificated = 0) as tmp', req.session.user.idusers,
                                            (err, results) => {
                                                if (err) return res.status(500).send('And error occurred in search while counting messages');
                                                if (req.query.sortby === 'popularity')
                                                    sort(listuser).desc(u => u.popularity);
                                                if (req.query.sortby === 'age')
                                                    sort(listuser).asc(u => u.age);
                                                res.render('search', {
                                                    user: req.session.user,
                                                    tags,
                                                    listuser,
                                                    notifications,
                                                    messages: results[0].messages,
                                                    helpers: {
                                                        ifCon: function (v1, operator, v2, options) {
                                                            switch (operator) {
                                                                case '==':
                                                                    return (v1 == v2) ? options.fn(this) : options.inverse(this);
                                                                case '===':
                                                                    return (v1 === v2) ? options.fn(this) : options.inverse(this);
                                                                case '!=':
                                                                    return (v1 != v2) ? options.fn(this) : options.inverse(this);
                                                                case '!==':
                                                                    return (v1 !== v2) ? options.fn(this) : options.inverse(this);
                                                                case '<':
                                                                    return (v1 < v2) ? options.fn(this) : options.inverse(this);
                                                                case '<=':
                                                                    return (v1 <= v2) ? options.fn(this) : options.inverse(this);
                                                                case '>':
                                                                    return (v1 > v2) ? options.fn(this) : options.inverse(this);
                                                                case '>=':
                                                                    return (v1 >= v2) ? options.fn(this) : options.inverse(this);
                                                                case '&&':
                                                                    return (v1 && v2) ? options.fn(this) : options.inverse(this);
                                                                case '||':
                                                                    return (v1 || v2) ? options.fn(this) : options.inverse(this);
                                                                default:
                                                                    return options.inverse(this);
                                                            }
                                                        },
                                                        getLength: function (obj) {
                                                            return obj.length;
                                                        }
                                                    }
                                                })
                                            })
                                    })
                            })
                    })
            }
        });
});

app.get('/login', (req, res) => {
    if (req.session.user)
        return res.redirect('/profile');
    res.render('login');
});

app.get('/', (req, res) => {
    if (req.session.user)
        return res.redirect('/profile');
    res.render('index', {
        user: req.session.user
    })
});

app.get('/recoverpw', (req, res) => {
    res.render('recoverpw')
});

app.get('/profile', (req, res) => {
    let missing = [];
    if (req.session.user === undefined) return res.redirect('/login');
    let user = req.session.user;
    user.gender === null ? missing.push('GENDER') : null;
    user.biography === null ? missing.push('BIOGRAPHY') : null;
    user.pictures.length === 0 ? missing.push('PROFILE PICTURE') : null;
    user.age === null ? missing.push('AGE') : null;
    connection.query('SELECT idtags, tag_name FROM tags',
        (err, results) => {
            if (err) return res.status(500).send('And error occurred in profile');
            let tags = results.map((element) => {
                return {
                    id: element.idtags,
                    value: element.tag_name
                }
            });
            connection.query('SELECT popularity from users where idusers = ?', req.session.user.idusers,
                (err, results) => {
                    if (err) return res.status(500).send('And error occurred in profile while getting popularity');
                    req.session.user.popularity = results[0].popularity;
                    connection.query('SELECT COUNT(*) as notification FROM seen WHERE iduser_watched = ? AND notificated = 0', req.session.user.idusers,
                        (err, results) => {
                            if (err) return res.status(500).send('And error occurred in profile while getting notifications');
                            var notifications = results[0].notification;
                            connection.query('SELECT COUNT(*) as messages from (SELECT DISTINCT idsender FROM messages WHERE idreceiver = ? AND notificated = 0) as tmp', req.session.user.idusers,
                                (err, results) => {
                                    if (err) return res.status(500).send('And error occurred in profile while getting messages');
                                    res.render('profile', {
                                        user: req.session.user,
                                        missing,
                                        tags,
                                        notifications,
                                        messages: results[0].messages,
                                        helpers: {
                                            ifCon: function (v1, operator, v2, options) {
                                                switch (operator) {
                                                    case '==':
                                                        return (v1 == v2) ? options.fn(this) : options.inverse(this);
                                                    case '===':
                                                        return (v1 === v2) ? options.fn(this) : options.inverse(this);
                                                    case '!=':
                                                        return (v1 != v2) ? options.fn(this) : options.inverse(this);
                                                    case '!==':
                                                        return (v1 !== v2) ? options.fn(this) : options.inverse(this);
                                                    case '<':
                                                        return (v1 < v2) ? options.fn(this) : options.inverse(this);
                                                    case '<=':
                                                        return (v1 <= v2) ? options.fn(this) : options.inverse(this);
                                                    case '>':
                                                        return (v1 > v2) ? options.fn(this) : options.inverse(this);
                                                    case '>=':
                                                        return (v1 >= v2) ? options.fn(this) : options.inverse(this);
                                                    case '&&':
                                                        return (v1 && v2) ? options.fn(this) : options.inverse(this);
                                                    case '||':
                                                        return (v1 || v2) ? options.fn(this) : options.inverse(this);
                                                    default:
                                                        return options.inverse(this);
                                                }
                                            },
                                            getLength: function (obj) {
                                                return obj.length;
                                            }
                                        }
                                    })
                                })
                        })
                })
        })
});

app.get('/profile/:id', (req, res) => {
    if (req.session.user === undefined) return res.redirect('/login');
    let missing = [];
    let user = req.session.user;
    user.gender === null ? missing.push('GENDER') : null;
    user.biography === null ? missing.push('BIOGRAPHY') : null;
    user.pictures.length === 0 ? missing.push('PROFILE PICTURE') : null;
    user.age === null ? missing.push('AGE') : null;
    if (missing.length > 0 || req.session.user.idusers === parseInt(req.params.id)) return res.redirect('/profile');
    connection.query('SELECT username FROM users WHERE idusers = ?', req.params.id,
        (err, results) => {
            if (err) return res.status(500).send('And error occurred in profile|id');
            if (results.length > 0) {
                connection.query('SELECT * FROM seen WHERE iduser_watcher = ? AND iduser_watched = ?', [req.session.user.idusers, req.params.id],
                    (err, results) => {
                        if (err) return res.status(500).send('And error occurred in profile|id while checking something');
                        if (results.length === 0) {
                            if (err) return res.status(500).send("And error occurred in profile|id when didn't find something");
                            connection.query('SELECT idusers, username, firstname, lastname, sex_pref, gender, position, extract(year from from_days(DATEDIFF(CURDATE(), age))) as age, lastonline, biography, popularity, reports from users where idusers = ? AND idusers NOT IN (SELECT idBlocked FROM blocked_users WHERE idBlocker = ? UNION SELECT idBlocker FROM blocked_users WHERE idBlocked = ?)', [req.params.id, req.session.user.idusers, req.session.user.idusers],
                                (err, results) => {
                                    if (err) return res.status(500).send('And error occurred in profile|id while getting person');
                                    connection.query('INSERT INTO seen (iduser_watcher, iduser_watched) VALUES (?, ?)', [req.session.user.idusers, req.params.id],
                                        (err, r) => {
                                            if (err) return res.status(500).send('And error occurred in profile|id while insert');
                                            if (results.length === 0) return res.status(500).send('This profile does not exist');
                                            let other = results[0];
                                            connection.query('select location, isMain from pictures where idOwner = ? ORDER BY isMain DESC', req.params.id,
                                                (err, results) => {
                                                    if (err) return res.status(500).send('And error occurred in profile|id while selecting');
                                                    other.pictures = results;
                                                    connection.query('SELECT tag_name FROM tags,tag_user WHERE tags.idtags = tag_user.idtag AND tag_user.iduser = ?', other.idusers,
                                                        (err, results) => {
                                                            if (err) return res.status(500).send('And error occurred in profile|id while selecting another thing');
                                                            other.tags = results;
                                                            connection.query('SELECT COUNT(*) as notification FROM seen WHERE iduser_watched = ? AND notificated = 0', req.session.user.idusers,
                                                                (err, results) => {
                                                                    if (err) return res.status(500).send('And error occurred in profile|id while counting');
                                                                    var notifications = results[0].notification;
                                                                    connection.query('SELECT COUNT(*) as messages from (SELECT DISTINCT idsender FROM messages WHERE idreceiver = ? AND notificated = 0) as tmp', req.session.user.idusers,
                                                                        (err, results) => {
                                                                            if (err) return res.status(500).send('And error occurred in profile|id while counting another thing');
                                                                            people.map(user => {
                                                                                if (user.username === req.params.id) {
                                                                                    io.in(user.id).emit('newView', {
                                                                                        usernameViewer: req.session.user.username
                                                                                    });
                                                                                }
                                                                            });
                                                                            res.render('profileo', {
                                                                                user: req.session.user,
                                                                                other,
                                                                                notifications,
                                                                                messages: results[0].messages,
                                                                                helpers: {
                                                                                    ifCon: function (v1, operator, v2, options) {
                                                                                        switch (operator) {
                                                                                            case '==':
                                                                                                return (v1 == v2) ? options.fn(this) : options.inverse(this);
                                                                                            case '===':
                                                                                                return (v1 === v2) ? options.fn(this) : options.inverse(this);
                                                                                            case '!=':
                                                                                                return (v1 != v2) ? options.fn(this) : options.inverse(this);
                                                                                            case '!==':
                                                                                                return (v1 !== v2) ? options.fn(this) : options.inverse(this);
                                                                                            case '<':
                                                                                                return (v1 < v2) ? options.fn(this) : options.inverse(this);
                                                                                            case '<=':
                                                                                                return (v1 <= v2) ? options.fn(this) : options.inverse(this);
                                                                                            case '>':
                                                                                                return (v1 > v2) ? options.fn(this) : options.inverse(this);
                                                                                            case '>=':
                                                                                                return (v1 >= v2) ? options.fn(this) : options.inverse(this);
                                                                                            case '&&':
                                                                                                return (v1 && v2) ? options.fn(this) : options.inverse(this);
                                                                                            case '||':
                                                                                                return (v1 || v2) ? options.fn(this) : options.inverse(this);
                                                                                            default:
                                                                                                return options.inverse(this);
                                                                                        }
                                                                                    },
                                                                                    getLength: function (obj) {
                                                                                        return obj.length;
                                                                                    }
                                                                                }
                                                                            })
                                                                        })
                                                                })
                                                        })
                                                })
                                        })
                                })
                        } else {
                            connection.query('SELECT idusers, username, firstname, lastname, sex_pref, gender, position, extract(year from from_days(DATEDIFF(CURDATE(), age))) as age, lastonline, biography, popularity, reports from users where idusers = ? AND idusers NOT IN (SELECT idBlocked FROM blocked_users WHERE idBlocker = ? UNION SELECT idBlocker FROM blocked_users WHERE idBlocked = ?)', [req.params.id, req.session.user.idusers, req.session.user.idusers],
                                (err, results) => {
                                    if (results.length === 0) return res.status(500).send('This profile does not exist');
                                    let other = results[0];
                                    connection.query('select location, isMain from pictures where idOwner = ? ORDER BY isMain DESC', req.params.id,
                                        (err, results) => {
                                            if (err) return res.status(500).send('And error occurred in profile|id while selecting 2 things');
                                            other.pictures = results;
                                            connection.query('SELECT tag_name FROM tags,tag_user WHERE tags.idtags = tag_user.idtag AND tag_user.iduser = ?', other.idusers,
                                                (err, results) => {
                                                    if (err) return res.status(500).send('And error occurred in profile|id while selecting 1 thing');
                                                    other.tags = results;
                                                    connection.query('SELECT COUNT(*) as notification FROM seen WHERE iduser_watched = ? AND notificated = 0', req.session.user.idusers,
                                                        (err, results) => {
                                                            if (err) return res.status(500).send('And error occurred in profile|id while counting 2');
                                                            var notifications = results[0].notification;
                                                            connection.query('SELECT COUNT(*) as messages from (SELECT DISTINCT idsender FROM messages WHERE idreceiver = ? AND notificated = 0) as tmp', req.session.user.idusers,
                                                                (err, results) => {
                                                                    if (err) return res.status(500).send('And error occurred in profile|id while counting 22');
                                                                    res.render('profileo', {
                                                                        user: req.session.user,
                                                                        other,
                                                                        notifications,
                                                                        messages: results[0].messages,
                                                                        helpers: {
                                                                            ifCon: function (v1, operator, v2, options) {
                                                                                switch (operator) {
                                                                                    case '==':
                                                                                        return (v1 == v2) ? options.fn(this) : options.inverse(this);
                                                                                    case '===':
                                                                                        return (v1 === v2) ? options.fn(this) : options.inverse(this);
                                                                                    case '!=':
                                                                                        return (v1 != v2) ? options.fn(this) : options.inverse(this);
                                                                                    case '!==':
                                                                                        return (v1 !== v2) ? options.fn(this) : options.inverse(this);
                                                                                    case '<':
                                                                                        return (v1 < v2) ? options.fn(this) : options.inverse(this);
                                                                                    case '<=':
                                                                                        return (v1 <= v2) ? options.fn(this) : options.inverse(this);
                                                                                    case '>':
                                                                                        return (v1 > v2) ? options.fn(this) : options.inverse(this);
                                                                                    case '>=':
                                                                                        return (v1 >= v2) ? options.fn(this) : options.inverse(this);
                                                                                    case '&&':
                                                                                        return (v1 && v2) ? options.fn(this) : options.inverse(this);
                                                                                    case '||':
                                                                                        return (v1 || v2) ? options.fn(this) : options.inverse(this);
                                                                                    default:
                                                                                        return options.inverse(this);
                                                                                }
                                                                            },
                                                                            getLength: function (obj) {
                                                                                return obj.length;
                                                                            }
                                                                        }
                                                                    })
                                                                })
                                                        })
                                                })
                                        })
                                })
                        }
                    });
            } else {
                res.status(500).send('This profile does not exist')
            }
        })
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.get('/notifications', (req, res) => {
    if (req.session.user === undefined) return res.redirect('/login');
    let missing = [];
    let user = req.session.user;
    user.gender === null ? missing.push('GENDER') : null;
    user.biography === null ? missing.push('BIOGRAPHY') : null;
    user.pictures.length === 0 ? missing.push('PROFILE PICTURE') : null;
    user.age === null ? missing.push('AGE') : null;
    if (missing.length > 0) return res.redirect('/profile');
    connection.query('SELECT username, liked from seen, users WHERE iduser_watched = ? AND iduser_watcher = idusers AND idusers NOT IN (SELECT idBlocked FROM blocked_users WHERE idBlocker = ? UNION SELECT idBlocker FROM blocked_users WHERE idBlocked = ?) ORDER BY liked DESC', [req.session.user.idusers, req.session.user.idusers, req.session.user.idusers],
        (err, results) => {
            var listWatchers = results;
            if (err) return res.status(500).send('And error occurred in notifications while selecting');
            connection.query('SELECT COUNT(*) as messages from (SELECT DISTINCT idsender FROM messages WHERE idreceiver = ? AND notificated = 0) as tmp', req.session.user.idusers,
                (err, results) => {
                    if (err) return res.status(500).send('And error occurred in notifications while slecting again');
                    var messages = results[0].messages;
                    connection.query('UPDATE seen SET notificated = 1 WHERE iduser_watched = ?', req.session.user.idusers,
                        (err, results) => {
                            if (err) return res.status(500).send('And error occurred in notifications while updating');
                            res.render('notification', {
                                user: req.session.user,
                                listWatchers,
                                notifications: 0,
                                messages,
                                helpers: {
                                    ifCon: function (v1, operator, v2, options) {
                                        switch (operator) {
                                            case '==':
                                                return (v1 == v2) ? options.fn(this) : options.inverse(this);
                                            case '===':
                                                return (v1 === v2) ? options.fn(this) : options.inverse(this);
                                            case '!=':
                                                return (v1 != v2) ? options.fn(this) : options.inverse(this);
                                            case '!==':
                                                return (v1 !== v2) ? options.fn(this) : options.inverse(this);
                                            case '<':
                                                return (v1 < v2) ? options.fn(this) : options.inverse(this);
                                            case '<=':
                                                return (v1 <= v2) ? options.fn(this) : options.inverse(this);
                                            case '>':
                                                return (v1 > v2) ? options.fn(this) : options.inverse(this);
                                            case '>=':
                                                return (v1 >= v2) ? options.fn(this) : options.inverse(this);
                                            case '&&':
                                                return (v1 && v2) ? options.fn(this) : options.inverse(this);
                                            case '||':
                                                return (v1 || v2) ? options.fn(this) : options.inverse(this);
                                            default:
                                                return options.inverse(this);
                                        }
                                    }
                                }
                            })
                        })
                })
        })
});

app.get('/chat', (req, res) => {
    if (req.session.user === undefined) return res.redirect('/login');
    let missing = [];
    let user = req.session.user;
    user.gender === null ? missing.push('GENDER') : null;
    user.biography === null ? missing.push('BIOGRAPHY') : null;
    user.pictures.length === 0 ? missing.push('PROFILE PICTURE') : null;
    user.age === null ? missing.push('AGE') : null;
    if (missing.length > 0) return res.redirect('/profile');
    connection.query('SELECT DISTINCT idusers, username, location FROM messages, users, pictures WHERE idsender = idusers and idreceiver = ? AND idOwner = idsender AND isMain = 1 AND idusers NOT IN (SELECT idBlocked FROM blocked_users WHERE idBlocker = ? UNION SELECT idBlocker FROM blocked_users WHERE idBlocked = ?)', [req.session.user.idusers, req.session.user.idusers, req.session.user.idusers],
        (err, results) => {
            if (err) return res.status(500).send('And error occurred in chat while selecting');
            var listMsgUsers = results;
            connection.query('SELECT COUNT(*) as notification FROM seen WHERE iduser_watched = ? AND notificated = 0', req.session.user.idusers,
                (err, results) => {
                    if (err) return res.status(500).send('And error occurred in chat while counting');
                    var notifications = results[0].notification;
                    connection.query('UPDATE messages SET notificated = 1 WHERE idreceiver = ?', req.session.user.idusers,
                        (err, results) => {
                            if (err) return res.status(500).send('And error occurred in chat while updating something');
                            res.render('chat', {
                                user: req.session.user,
                                listMsgUsers,
                                notifications,
                                messages: 0,
                            });
                        })
                })
        })
});

app.get('/chat/:id', (req, res) => {
    if (req.session.user === undefined) return res.redirect('/login');
    let missing = [];
    let user = req.session.user;
    user.gender === null ? missing.push('GENDER') : null;
    user.biography === null ? missing.push('BIOGRAPHY') : null;
    user.pictures.length === 0 ? missing.push('PROFILE PICTURE') : null;
    user.age === null ? missing.push('AGE') : null;
    if (missing.length > 0 || req.session.user.idusers === parseInt(req.params.id)) return res.redirect('/profile');
    connection.query('SELECT liked FROM seen WHERE iduser_watcher = ? AND iduser_watched = ? AND liked = 1', [req.session.user.idusers, req.params.id],
        (err, results) => {
            if (err) return res.status(500).send('And error occurred in chat|id while selecting');
            if (results.length > 0 && parseInt(results[0].liked) > 0) {
                connection.query('SELECT liked FROM seen WHERE iduser_watcher = ? AND iduser_watched = ?', [req.params.id, req.session.user.idusers],
                    (err, results) => {
                        if (err) return res.status(500).send('And error occurred in chat|id while selecting again');
                        if (results.length > 0 && parseInt(results[0].liked) > 0) {
                            connection.query('SELECT COUNT(*) as notification FROM seen WHERE iduser_watched = ? AND notificated = 0', req.session.user.idusers,
                                (err, results) => {
                                    if (err) return res.status(500).send('And error occurred in chat|id while counting');
                                    var notifications = results[0].notification;
                                    connection.query('SELECT COUNT(*) as messages from (SELECT DISTINCT idsender FROM messages WHERE idreceiver = ? AND notificated = 0) as tmp', req.session.user.idusers,
                                        (err, results) => {
                                            if (err) return res.status(500).send('And error occurred in chat|id while counting again');
                                            var messages = results[0].messages;
                                            connection.query('SELECT username, location from users, pictures where idusers = ? and idOwner = idusers AND isMain = 1', [req.params.id],
                                                (err, results) => {
                                                    if (err) return res.status(500).send('And error occurred in chat|id while selecting things');
                                                    var chatUsername = results[0].username;
                                                    connection.query('SELECT text, idsender FROM messages WHERE (idreceiver = ? AND idsender = ?) OR (idreceiver = ? AND idsender = ?)', [req.session.user.idusers, req.params.id, req.params.id, req.session.user.idusers],
                                                        (err, results) => {
                                                            if (err) return res.status(500).send('And error occurred in chat|id while selecting 2 important things');
                                                            return res.render('chat_realtime', {
                                                                user: req.session.user,
                                                                chatUsername,
                                                                notifications,
                                                                messages,
                                                                messages_text: results,
                                                                id_to_send: req.params.id,
                                                                helpers: {
                                                                    ifCon: function (v1, operator, v2, options) {
                                                                        switch (operator) {
                                                                            case '==':
                                                                                return (v1 == v2) ? options.fn(this) : options.inverse(this);
                                                                            case '===':
                                                                                return (v1 === v2) ? options.fn(this) : options.inverse(this);
                                                                            case '!=':
                                                                                return (v1 != v2) ? options.fn(this) : options.inverse(this);
                                                                            case '!==':
                                                                                return (v1 !== v2) ? options.fn(this) : options.inverse(this);
                                                                            case '<':
                                                                                return (v1 < v2) ? options.fn(this) : options.inverse(this);
                                                                            case '<=':
                                                                                return (v1 <= v2) ? options.fn(this) : options.inverse(this);
                                                                            case '>':
                                                                                return (v1 > v2) ? options.fn(this) : options.inverse(this);
                                                                            case '>=':
                                                                                return (v1 >= v2) ? options.fn(this) : options.inverse(this);
                                                                            case '&&':
                                                                                return (v1 && v2) ? options.fn(this) : options.inverse(this);
                                                                            case '||':
                                                                                return (v1 || v2) ? options.fn(this) : options.inverse(this);
                                                                            default:
                                                                                return options.inverse(this);
                                                                        }
                                                                    },
                                                                    getLength: function (obj) {
                                                                        return obj.length;
                                                                    }
                                                                }
                                                            })
                                                        })
                                                })
                                        })
                                })
                        } else {
                            return res.status(500).send("You are unable to chat if you don't have a match with that person");
                        }
                    })
            } else {
                return res.status(500).json("You must first like that person to be able to chat");
            }
        })
});

app.post('/savepref', async (req, res) => {
    if (req.session.user) {
        if (req.body.sexual_preference) {
            connection.query('UPDATE users SET sex_pref = ? WHERE idusers = ?', [req.body.sexual_preference, req.session.user.idusers],
                (err, results) => {
                    if (err) return res.status(500).json({
                        status: 'Error',
                        msg: err
                    });
                    connection.query('SELECT sex_pref FROM users where idusers = ?', req.session.user.idusers,
                        (err, results) => {
                            if (err) return res.status(500).json({
                                status: 'Error',
                                msg: err
                            });
                            req.session.user.sex_pref = results[0].sex_pref;
                            res.json({
                                status: 'Ok',
                                msg: 'Sexual preference updated'
                            })
                        });
                })
        }
        else if (req.body.gender_preference) {
            connection.query('UPDATE users SET gender = ? WHERE idusers = ?', [req.body.gender_preference, req.session.user.idusers],
                (err, results) => {
                    if (err) return res.status(500).json({
                        status: 'Error',
                        msg: err
                    });
                    connection.query('SELECT gender FROM users where idusers = ?', req.session.user.idusers,
                        (err, results) => {
                            if (err) return res.status(500).json({
                                status: 'Error',
                                msg: err
                            });
                            req.session.user.gender = results[0].gender;
                            res.json({
                                status: 'Ok',
                                msg: 'Gender preference updated'
                            })
                        });
                })
        }
        else if (req.body.positioning) {
            req.body.positioning = await encodeURI(req.body.positioning);
            let position = await getRealAddress(req.body.positioning);
            if (position === 'Error') return res.status(500).json({
                status: 'Error',
                msg: 'Please provide a more precise location',
                positioning: true
            });
            connection.query('UPDATE users SET position = ? WHERE idusers = ?', [position, req.session.user.idusers],
                (err, results) => {
                    if (err) return res.status(500).json({
                        status: 'Error',
                        msg: err
                    });
                    connection.query('SELECT position FROM users where idusers = ?', req.session.user.idusers,
                        (err, results) => {
                            if (err) return res.status(500).json({
                                status: 'Error',
                                msg: err
                            });
                            req.session.user.position = results[0].position;
                            return res.json({
                                status: 'Ok',
                                msg: 'Position updated'
                            })
                        });
                })
        }
        else if (req.body.username) {
            connection.query('UPDATE users SET username = ? WHERE idusers = ?', [req.body.username, req.session.user.idusers],
                (err, results) => {
                    if (err) return res.status(500).json({
                        status: 'Error',
                        msg: err
                    });
                    connection.query('SELECT username FROM users where idusers = ?', req.session.user.idusers,
                        (err, results) => {
                            if (err) return res.status(500).json({
                                status: 'Error',
                                msg: err
                            });
                            req.session.user.username = results[0].username;
                            return res.json({
                                status: 'Ok',
                                msg: 'Username updated'
                            })
                        });
                })
        }
        else if (req.body.firstname) {
            connection.query('UPDATE users SET firstname = ? WHERE idusers = ?', [req.body.firstname, req.session.user.idusers],
                (err, results) => {
                    if (err) return res.status(500).json({
                        status: 'Error',
                        msg: err
                    });
                    connection.query('SELECT firstname FROM users where idusers = ?', req.session.user.idusers,
                        (err, results) => {
                            if (err) return res.status(500).json({
                                status: 'Error',
                                msg: err
                            });
                            req.session.user.firstname = results[0].firstname;
                            return res.json({
                                status: 'Ok',
                                msg: 'Firstname updated'
                            })
                        });
                })
        }
        else if (req.body.lastname) {
            connection.query('UPDATE users SET lastname = ? WHERE idusers = ?', [req.body.lastname, req.session.user.idusers],
                (err, results) => {
                    if (err) return res.status(500).json({
                        status: 'Error',
                        msg: err
                    });
                    connection.query('SELECT lastname FROM users where idusers = ?', req.session.user.idusers,
                        (err, results) => {
                            if (err) return res.status(500).json({
                                status: 'Error',
                                msg: err
                            });
                            req.session.user.lastname = results[0].lastname;
                            return res.json({
                                status: 'Ok',
                                msg: 'Lastname updated'
                            })
                        });
                })
        }
        else if (req.body.email) {
            connection.query('UPDATE users SET email = ? WHERE idusers = ?', [req.body.email, req.session.user.idusers],
                (err, results) => {
                    if (err) return res.status(500).json({
                        status: 'Error',
                        msg: err
                    });
                    connection.query('SELECT email FROM users where idusers = ?', req.session.user.idusers,
                        (err, results) => {
                            if (err) return res.status(500).json({
                                status: 'Error',
                                msg: err
                            });
                            req.session.user.email = results[0].email;
                            return res.json({
                                status: 'Ok',
                                msg: 'Email updated'
                            })
                        });
                })
        }
        else if (req.body.biography) {
            connection.query('UPDATE users SET biography = ? WHERE idusers = ?', [req.body.biography, req.session.user.idusers],
                (err, results) => {
                    if (err) return res.status(500).json({
                        status: 'Error',
                        msg: err
                    });
                    connection.query('SELECT biography FROM users where idusers = ?', req.session.user.idusers,
                        (err, results) => {
                            if (err) return res.status(500).json({
                                status: 'Error',
                                msg: err
                            });
                            req.session.user.biography = results[0].biography;
                            return res.json({
                                status: 'Ok',
                                msg: 'Biography updated'
                            })
                        });
                })
        }
        else if (req.body.age) {
            connection.query('UPDATE users SET age = ? WHERE idusers = ?', [req.body.age, req.session.user.idusers],
                (err, results) => {
                    if (err) return res.status(500).json({
                        status: 'Error',
                        msg: err
                    });
                    connection.query('SELECT extract(year from from_days(DATEDIFF(CURDATE(), age))) as age, DATE_FORMAT(age, "%Y-%m-%d") as born FROM users where idusers = ?', req.session.user.idusers,
                        (err, results) => {
                            if (err) return res.status(500).json({
                                status: 'Error',
                                msg: err
                            });
                            req.session.user.age = results[0].age;
                            req.session.user.born = results[0].born;
                            return res.json({
                                status: 'Ok',
                                msg: 'Age updated'
                            })
                        });
                })
        }
        else if (req.body.password) {
            connection.query('UPDATE users SET password = ? WHERE idusers = ?', [bcrypt.hashSync(req.body.password, 10), req.session.user.idusers],
                (err, results) => {
                    if (err) return res.status(500).json({
                        status: 'Error',
                        msg: err
                    });
                    return res.json({
                        status: 'Ok',
                        msg: 'Age updated'
                    })
                })
        }
        else if (req.body.img) {
            connection.query('SELECT COUNT(*) as totalpic from pictures WHERE idOwner = ?', req.session.user.idusers,
                (err, results) => {
                    if (results[0].totalpic >= 5)
                        return res.status(500).json({
                            status: 'Error',
                            msg: 'You have already 5 pictures! Please remove some'
                        });
                    if (err) return res.status(500).json({
                        status: 'Error',
                        msg: err
                    });
                    let base64 = req.body.img.split(',').map(c => String.fromCharCode(c)).join('');
                    clariapp.models.predict(Clarifai.FACE_DETECT_MODEL, {base64})
                        .then(function (response) {
                                if (!response.outputs[0].data || response.outputs[0].data.regions.length > 1)
                                    return res.status(500).json({
                                        status: 'Error',
                                        msg: 'Too many faces/No faces'
                                    });
                                let buffer = new Buffer.from(base64, 'base64');
                                Jimp.read(buffer)
                                    .then(image => {
                                        let coordinates = response.outputs[0].data.regions[0].region_info.bounding_box;
                                        let x = (image.bitmap.width * Math.round(coordinates.left_col * 100)) / 100;
                                        let y = (image.bitmap.height * Math.round(coordinates.top_row * 100)) / 100;
                                        let xx = (image.bitmap.width * Math.round(coordinates.right_col * 100)) / 100;
                                        let yy = (image.bitmap.height * Math.round(coordinates.bottom_row * 100)) / 100;
                                        image.crop(x, y, (xx - x), (yy - y));
                                        image.quality(50);
                                        image.resize(128, 128);
                                        let img_name = randomstring.generate(20);
                                        image.write(__dirname + '/static/imgs/users/' + img_name + '.jpeg',
                                            (value) => {
                                                connection.query('INSERT INTO pictures (location, idOwner) VALUES (?, ?)', [`/imgs/users/${img_name}.jpeg`, req.session.user.idusers],
                                                    (err, results) => {
                                                        if (err) return res.status(500).json({
                                                            status: 'Error',
                                                            msg: err
                                                        });
                                                        connection.query('SELECT location, isMain from pictures, users WHERE idOwner = idusers AND idusers = ? ORDER BY isMain DESC', req.session.user.idusers,
                                                            (err, results) => {
                                                                if (err) return res.status(500).json({
                                                                    status: 'Error',
                                                                    msg: err
                                                                });
                                                                req.session.user.pictures = results;
                                                                if (req.session.user.pictures.length === 1) {
                                                                    connection.query('UPDATE pictures SET isMain = 1 WHERE idOwner = ?', req.session.user.idusers,
                                                                        (err, results) => {
                                                                            if (err) return res.status(500).json({
                                                                                status: 'Error',
                                                                                msg: err
                                                                            });
                                                                            connection.query('SELECT location, isMain from pictures, users WHERE idOwner = idusers AND idusers = ? ORDER BY isMain DESC', req.session.user.idusers,
                                                                                (err, results) => {
                                                                                    if (err) return res.status(500).json({
                                                                                        status: 'Error',
                                                                                        msg: err
                                                                                    });
                                                                                    req.session.user.pictures = results;
                                                                                    res.json({
                                                                                        status: 'Ok',
                                                                                        msg: 'Picture uploaded correctly'
                                                                                    });
                                                                                })
                                                                        })
                                                                }
                                                                else {
                                                                    connection.query('SELECT location, isMain from pictures, users WHERE idOwner = idusers AND idusers = ? ORDER BY isMain DESC', req.session.user.idusers,
                                                                        (err, results) => {
                                                                            if (err) return res.status(500).json({
                                                                                status: 'Error',
                                                                                msg: err
                                                                            });
                                                                            req.session.user.pictures = results;
                                                                            res.json({
                                                                                status: 'Ok',
                                                                                msg: 'Picture uploaded correctly'
                                                                            });
                                                                        })
                                                                }
                                                            })
                                                    })
                                            })
                                    })
                                    .catch(err => {
                                        res.status(500).json(err);
                                    });
                            },
                            function (err) {
                                res.status(500).json(err.data)
                            }
                        ).catch((reason) => {
                        return res.status(500).json({
                            status: 'Error',
                            msg: reason
                        })
                    });
                })
        }
        else if (req.body.remimg) {
            connection.query('DELETE FROM pictures WHERE location = ? AND idOwner = ?', [req.body.remimg, req.session.user.idusers],
                (err, results) => {
                    if (err) return res.status(500).json({
                        status: 'Error',
                        msg: err
                    });
                    if (results.affectedRows > 0) {
                        fs.unlinkSync(__dirname + '/static/' + req.body.remimg);
                        connection.query('SELECT location, isMain from pictures, users WHERE idOwner = idusers AND idusers = ? ORDER BY isMain DESC', req.session.user.idusers,
                            (err, results) => {
                                if (err) return res.status(500).json({
                                    status: 'Error',
                                    msg: 'Unable to get user profile pictures'
                                });
                                req.session.user.pictures = results;
                                res.json({
                                    status: 'Ok',
                                    msg: 'Picture deleted successfully'
                                });
                            });
                    }
                    else {
                        return res.status(500).json({
                            status: 'Error',
                            msg: 'Image not found, unable to delete it'
                        })
                    }
                })
        }
        else if (req.body.defimg) {
            connection.query('UPDATE pictures SET isMain = 0 WHERE idOwner = ?', req.session.user.idusers,
                (err, results) => {
                    if (err) return res.status(500).json({
                        status: 'Error',
                        msg: err
                    });
                    connection.query('UPDATE pictures SET isMain = 1 WHERE idOwner = ? AND location = ?', [req.session.user.idusers, req.body.defimg],
                        (err, resultss) => {
                            if (err) return res.status(500).json({
                                status: 'Error',
                                msg: err
                            });
                            connection.query('SELECT location, isMain from pictures, users WHERE idOwner = idusers AND idusers = ? ORDER BY isMain DESC', req.session.user.idusers,
                                (err, results) => {
                                    if (err) return res.status(500).json({
                                        status: 'Error',
                                        msg: 'Unable to get user profile pictures'
                                    });
                                    req.session.user.pictures = results;
                                    res.json({
                                        status: 'Ok',
                                        msg: 'Default picture updated successfully'
                                    })
                                });
                        })
                })
        }
        else if (req.body.settag) {
            let array = req.body.settag.split(',');
            connection.query('DELETE FROM tag_user WHERE iduser = ?', req.session.user.idusers,
                (err, results) => {
                    if (err) return res.status(500).json({
                        status: 'Error',
                        msg: err
                    });
                    array.map(async (element) => {
                        await connection.query('INSERT INTO tag_user (iduser, idtag) VALUES (?, ?)', [req.session.user.idusers, element],
                            (err, results) => {
                                if (err) return res.status(500).json({
                                    status: 'Error',
                                    msg: err
                                })
                            })
                    });
                    connection.query('SELECT tag_name FROM tags,tag_user WHERE tags.idtags = tag_user.idtag AND tag_user.iduser = ?', req.session.user.idusers,
                        (err, results) => {
                            if (err) return res.status(500).json({
                                status: 'Error',
                                msg: err
                            });
                            req.session.user.tags = results;
                            res.json({
                                status: 'Ok',
                                msg: 'Tags updated'
                            })
                        })
                })
        }
        else if (req.body.likeuser) {
            connection.query('UPDATE users SET popularity = popularity + 1 where idusers = ?', req.body.likeuser,
                (err, results) => {
                    if (err) return res.status(500).json({
                        status: 'Error',
                        msg: err
                    });
                    connection.query('UPDATE seen SET liked = 1, notificated = 0 where iduser_watcher = ? and iduser_watched = ?', [req.session.user.idusers, req.body.likeuser],
                        (err, results) => {
                            if (err) return res.status(500).json({
                                status: 'Error',
                                msg: err
                            });
                            if (results.affectedRows === 0) {
                                connection.query('INSERT INTO seen (iduser_watcher, iduser_watched, liked) VALUES (?, ?, 1)', [req.session.user.idusers, req.body.likeuser],
                                    (err, results) => {
                                        if (err) return res.status(500).json({
                                            status: 'Error',
                                            msg: err
                                        });
                                        connection.query('SELECT username from users WHERE idusers = ?', req.session.user.idusers,
                                            (err, results) => {
                                                if (err) return res.status(500).json({
                                                    status: 'Error',
                                                    msg: err
                                                });
                                                people.map(user => {
                                                    if (user.username === req.body.likeuser)
                                                        io.in(user.id).emit('newLike', {
                                                            idLiker: results[0].username,
                                                            msg: 'Put like to your profile'
                                                        })
                                                });
                                                return res.json({
                                                    status: 'Ok',
                                                    msg: 'Like inserted successfully'
                                                })
                                            })
                                    })
                            } else {
                                connection.query('SELECT username from users WHERE idusers = ?', req.session.user.idusers,
                                    (err, results) => {
                                        if (err) return res.status(500).json({
                                            status: 'Error',
                                            msg: err
                                        });
                                        people.map(user => {
                                            if (user.username === req.body.likeuser)
                                                io.in(user.id).emit('newLike', {
                                                    idLiker: results[0].username,
                                                    msg: 'Put like to your profile'
                                                })
                                        });
                                        return res.json({
                                            status: 'Ok',
                                            msg: 'Like inserted successfully'
                                        })
                                    })
                            }
                        })
                })
        }
        else if (req.body.dislike) {
            connection.query('UPDATE users SET popularity = popularity - 1 where idusers = ?', req.body.dislike,
                (err, results) => {
                    if (err) return res.status(500).json({
                        status: 'Error',
                        msg: err
                    });
                    connection.query('UPDATE seen SET liked = -1, notificated = 0 WHERE iduser_watcher = ? AND iduser_watched = ?', [req.session.user.idusers, req.body.dislike],
                        (err, results) => {
                            if (err) return res.status(500).json({
                                status: 'Error',
                                msg: err
                            });
                            connection.query('SELECT username FROM users WHERE idusers = ?', req.session.user.idusers,
                                (err, results) => {
                                    if (err) return res.status(500).json({
                                        status: 'Error',
                                        msg: err
                                    });
                                    people.map(user => {
                                        if (user.username === req.body.dislike)
                                            io.in(user.id).emit('disLike', {
                                                idDisLiker: results[0].username,
                                                msg: 'removed like to your profile'
                                            })
                                    });
                                    return res.json({
                                        status: 'Ok',
                                        msg: 'Like removed successfully'
                                    })
                                })
                        })
                })
        }
        else if (req.body.savemsg) {
            req.body.savemsg = JSON.parse(req.body.savemsg);
            connection.query('SELECT * from users where idusers = ? AND idusers NOT IN (SELECT idBlocked FROM blocked_users WHERE idBlocker = ? UNION SELECT idBlocker FROM blocked_users WHERE idBlocked = ?)', [req.body.savemsg.idTo, req.session.user.idusers, req.session.user.idusers],
                (err, results) => {
                    if (err) return res.status(500).json({
                        status: 'Error',
                        msg: err
                    });
                    if (results.length === 0) return res.status(500).json({
                        status: 'Error',
                        msg: 'Unable to send'
                    });
                    connection.query('INSERT INTO messages (idsender, idreceiver, text) VALUES (?, ?, ?)', [req.session.user.idusers, req.body.savemsg.idTo, req.body.savemsg.msg],
                        (err, results) => {
                            if (err) return res.status(500).json({
                                status: 'Error',
                                msg: err
                            });
                            people.map(user => {
                                if (user.username === req.body.savemsg.idTo.toString()) {
                                    io.in(user.id).emit('newMessage', {
                                        usernameMessager: req.session.user.username,
                                        msg: req.body.savemsg.msg
                                    });
                                }
                            });
                            res.json({
                                status: 'Ok',
                                msg: 'Message sent successfully'
                            })
                        })
                })
        }
        else if (req.body.block) {
            connection.query('INSERT INTO blocked_users (idBlocker, idBlocked) VALUES (?,?)', [req.session.user.idusers, req.body.block],
                (err, results) => {
                    if (err) return res.status(500).json({
                        status: 'Error',
                        msg: err
                    });
                    connection.query('DELETE FROM seen WHERE iduser_watcher IN (?,?) AND iduser_watched IN (?,?)', [req.session.user.idusers, req.body.block, req.session.user.idusers, req.body.block],
                        (err, results) => {
                            if (err) return res.status(500).json({
                                status: 'Error',
                                msg: err
                            });
                            connection.query('DELETE FROM messages WHERE idsender IN (?,?) AND idreceiver IN (?,?)', [req.session.user.idusers, req.body.block, req.session.user.idusers, req.body.block],
                                (err, results) => {
                                    if (err) return res.status(500).json({
                                        status: 'Error',
                                        msg: err
                                    });
                                    return res.json({
                                        status: 'Ok',
                                        msg: 'User blocked successfully'
                                    })
                                })
                        })
                })
        }
        else if (req.body.report) {
            connection.query('UPDATE users SET reports = reports + 1 WHERE idusers = ?', req.body.report,
                (err, results) => {
                    if (err) return res.status(500).json({
                        status: 'Error',
                        msg: err
                    });
                    return res.json({
                        status: 'Ok',
                        msg: 'User reported successfully'
                    })
                })
        }
        else {
            res.status(400).json({
                status: 'Error',
                msg: 'Bad request'
            })
        }
    }
});

app.post('/register', (req, res) => {
    const User = clearUserInput(req.body);
    if (User === undefined)
        return res.status(500).json({
            status: 'Error',
            msg: 'Invalid register data'
        });
    connection.query('INSERT INTO users (username, firstname, lastname, email, password, verifyhash) VALUES (?, ?, ?, ?, ?, ?)', [User.username, User.firstname, User.lastname, User.email, User.password, User.hash],
        (err, results) => {
            if (err) return res.status(500).json({
                status: 'Error',
                msg: 'And error occurred in register while inserting'
            });
            connection.query('SELECT verifyhash, email, firstname FROM users WHERE idusers = ?', results.insertId,
                (err, results) => {
                    if (err) return res.status(500).json({
                        status: 'Error',
                        msg: 'And error occurred in register while selecting'
                    });
                    let link = `http://${req.headers.host}/verify?hash=${results[0].verifyhash}`;
                    sendmail({
                        from: 'arizzell@localhost',
                        to: results[0].email,
                        replyTo: 'noreply@localhost',
                        subject: 'Verification mail',
                        html:
                            `<h1>Hello ${results[0].firstname}</h1>
						 <p>Click <a href="${link}">HERE</a> to verify your registration</p>`
                    }, (err) => {
                        if (err && !res.headersSent) return res.status(500).json({
                            status: 'Error',
                            msg: err
                        });
                    });
                    return res.json({
                        status: 'Ok',
                        msg: 'User successfully registeted'
                    })
                });
        });
});

app.post('/login', (req, res) => {
    let username, password;

    if (req.body.username !== undefined && req.body.username.length > 1 && req.body.username.length < 15)
        username = req.body.username;
    if (req.body.password !== undefined && req.body.password.length >= 8)
        password = req.body.password;
    if (username === undefined || password === undefined)
        return res.status(500).json({
            status: 'Error',
            msg: 'Bad format strings'
        });
    connection.query('SELECT *, extract(year from from_days(DATEDIFF(CURDATE(), age))) as age, DATE_FORMAT(age, "%Y-%m-%d") as born FROM users WHERE username = ?', username,
        (err, results) => {
            if (err) return res.status(500).send('And error occurred in login while selecting');
            if (results[0] === undefined) return res.status(500).json({
                status: 'Error',
                msg: 'User not found'
            });
            if (bcrypt.compareSync(password, results[0].password.toString())) {
                if (results[0].verifyhash !== 'OK')
                    return res.status(500).json({
                        status: 'Error',
                        msg: 'Please check your email to verify your account'
                    });
                req.session.user = results[0];
                connection.query('UPDATE users SET lastonline = ? WHERE idusers = ?', [new Date(), req.session.user.idusers],
                    (err, results) => {
                        if (err) return res.status(500).send('And error occurred in login while updating');
                        connection.query('SELECT location, isMain from pictures, users WHERE idOwner = idusers AND idusers = ? ORDER BY isMain DESC', req.session.user.idusers,
                            (err, results) => {
                                if (err) return res.status(500).json({
                                    status: 'Error',
                                    msg: 'Unable to get user profile pictures'
                                });
                                req.session.user.pictures = results;
                                connection.query('SELECT tag_name FROM tags,tag_user WHERE tags.idtags = tag_user.idtag AND tag_user.iduser = ?', req.session.user.idusers,
                                    (err, results) => {
                                        if (err) return res.status(500).send('And error occurred in login while selecting tags');
                                        req.session.user.tags = results;
                                        res.redirect('/profile');
                                    })
                            });
                    })
            }
            else {
                res.status(500).json({
                    status: 'Error',
                    msg: 'User not found'
                });
            }
        })
});

app.post('/recoverpw', (req, res) => {
    let email = req.body.email;
    if (email !== undefined && regex.test(email)) {
        let newpass = randomstring.generate(15);
        connection.query('UPDATE users SET password = ? WHERE email = ?', [bcrypt.hashSync(newpass, 10), email],
            (err, results) => {
                if (err) return res.status(500).json({
                    status: 'Error',
                    msg: 'And error occurred in recoverpw while updating'
                });
                sendmail({
                    from: 'arizzell@localhost',
                    to: email,
                    replyTo: 'noreply@localhost',
                    subject: 'Reset password',
                    html: `<p>Hello! This is your new password: ${newpass}</p>`
                }, (err) => {});
                res.json({
                    status: 'Ok',
                    msg: 'Password has been reinitialized, check your email (spam included)'
                })
            })
    }
});

//Handle invalid request
app.get('*', (req, res) => {
    res.status(404).send();
});

module.exports = app;
