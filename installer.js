var mysql = require('mysql2');
var fs = require('fs');
var connection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'REPLACE',
    multipleStatements: true
});

var data = fs.readFileSync('./generator.sql', 'utf-8');
connection.query(data, (err, results) => {
	if (err) {
		console.log(err);
		connection.close();
	} else {
		console.log('Creation complete');
		connection.close();
	}
});
