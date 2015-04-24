var express = require('express');
var bodyParser = require('body-parser');
var fs = require("fs");
var initialData = JSON.parse(fs.readFileSync(__dirname + "/../test.json"));


module.exports = function(cantrip) {

	var app = express();
	app.use(bodyParser.json());
	app.use(function(err, req, res, next) {
		return next({
			status: 400,
			error: "Invalid JSON supplied in request body."
		});
	});

	app.use(cantrip);

	app.use(function(err, req, res, next) {
	if (err.status) res.status(err.status);
		res.send({
			error: err.error
		});
	});

	app.use(function(req, res, next) {
		res.send(res.body);
	});


	app.listen(3001);

	app.resetData = function() {
		cantrip.put("/", initialData);
	}

	app.url = "http://localhost:3001/";

	return app;

}