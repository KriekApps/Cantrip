var express = require('express');
var _ = require("lodash");
var fs = require('fs');
var md5 = require('MD5');
var cors = require('cors');
var bodyParser = require('body-parser')
var jsonPersistence = require('cantrip-persistence-json');

//Set up express
var app = express();
app.use(bodyParser.json());
app.use(function(err, req, res, next) {
	return next({
		status: 400,
		error: "Invalid JSON supplied in request body."
	});
});
app.use(bodyParser.urlencoded());
//app.use(express.multipart());
app.use(cors());



var Cantrip = {
	options: {
		ip: "127.0.0.1",
		port: process.env.PORT || 3000,
		saveEvery: 1,
		namespace: "data",
		persistence: jsonPersistence
	},
	/**
	 * The app's data should be accessed through this object's methods. Provided by the persistence layer
	 * @type {Object}
	 */
	dataStore: {
		get: function(){},
		set: function(){},
		delete: function(){},
		parent: function(){}
	},
	/**
	 * Starts the server. Sets up the data in memory, creates a file if necessary
	 */
	start: function() {

		//Override options from command line arguments
		var self = this;
		process.argv.forEach(function(val, index, array) {
			if (val.indexOf("=") > -1) {
				var option = val.split("=");
				self.options[option[0]] = option[1];
			}
		});

		//Add the loaded persistence layer's methods to the Cantrip object
		_.extend(this, this.options.persistence);
		//Set up our persistence layer (JSON file or mongodb)
		var self = this;
		this.setupPersistence(function() {
			self.dataStore.data = self.data;

			//Set up the server
			self.app = app;

			//Give access to the data object to middlewares and parse the request path for a helper array
			app.use(function(req, res, next) {
				req.data = Cantrip.data;
				//Parse the path and save it on the request
				req.pathMembers = _.filter(req.path.split("/"), function(string) {
					return string !== "";
				});
				next();
			});

			app.use(self.targetNode);

			//Set up middleware
			self.beforeMiddleware();

			//Handle errors thrown so far
			app.use(self.error);

			//Set default middleware
			app.get('*', self.get);

			app.post("*", self.post);

			app.delete("*", self.delete);

			app.put("*", self.put);

			//Call middleware that alter the response object
			self.alterMiddleware();

			//Handle errors thrown
			app.use(self.error);

			//Send the response
			app.use(self.response);

			//Set up 'after' middleware
			self.afterMiddleware();

			//Sync the data
			app.use(self.syncData);

			//Start the server
			self.server = self.app.listen(self.options.port, self.options.ip);
			
		});

	},
	/**
	 * Stop the server.
	 */
	close: function() {
		this.server.close();
	},

	/**
	 * Sets up the persistence (file, database etc.) required for saving data.
	 * Also sets up the Cantrip.data attribute which holds functions for accessing the data directly
	 * Provided by the persistence layer
	 * By default this means reading a file and loading its contents as JSON into memory
	 */
	setupPersistence: function() {
		
	},


	beforeStack: [],
	/**
	 * Wrapper for express.use to be used before data insertion
	 */
	before: function() {
		for (var i = 0; i < arguments.length; i++) {
			if (_.isObject(arguments[i]) && arguments[i].registerMiddleware) {
				var middlewares = arguments[i].registerMiddleware;
				for (var j = 0; j < middlewares.length; j++) {
					this[middlewares[j][0]](middlewares[j][1], middlewares[j][2]);
				}
			}
		}
		this.beforeStack.push(arguments);
	},

	/**
	 * Alias for before
	 */
	use: function() {
		this.before.apply(this, arguments);
	},

	afterStack: [],

	after: function() {
		for (var i = 0; i < arguments.length; i++) {
			if (_.isObject(arguments[i]) && arguments[i].registerMiddleware) {
				var middlewares = arguments[i].registerMiddleware;
				for (var j = 0; j < middlewares.length; j++) {
					this[middlewares[j][0]](middlewares[j][1], middlewares[j][2]);
				}
			}
		}
		this.afterStack.push(arguments);

	},

	alterStack: [],

	alter: function() {
		for (var i = 0; i < arguments.length; i++) {
			if (_.isObject(arguments[i]) && arguments[i].registerMiddleware) {
				var middlewares = arguments[i].registerMiddleware;
				for (var j = 0; j < middlewares.length; j++) {
					this[middlewares[j][0]](middlewares[j][1], middlewares[j][2]);
				}
			}
		}
		this.alterStack.push(arguments);
	},

	beforeMiddleware: function() {

		for (var i = 0; i < this.beforeStack.length; i++) {
			this.app.use.apply(this.app, this.beforeStack[i]);
		}

	},

	afterMiddleware: function() {
		for (var i = 0; i < this.afterStack.length; i++) {
			this.app.use.apply(this.app, this.afterStack[i]);
		}

	},

	alterMiddleware: function() {
		for (var i = 0; i < this.alterStack.length; i++) {
			this.app.use.apply(this.app, this.alterStack[i]);
		}
	},

	/**
	 * Gets the target node from the data. Throws an error if it doesn't exist
	 */
	targetNode: function(req, res, next) {
		Cantrip.dataStore.get(req.path, function(error, data) {
			if (error) {
				return next(error);
			}
			req.targetNode = data;
			next();
		});
	},
	//Save the JSON in memory to the specified JSON file. Runs after every API call, once the answer has been sent.
	//Uses the async writeFile so it doesn't interrupt other stuff.
	//If options.saveEvery is different from 1, it doesn't save every time.
	//If options.saveEvery is 0, it never saves
	counter: 0,
	syncData: function(req, res, next) {
		if (++Cantrip.counter === Cantrip.options.saveEvery && Cantrip.options.saveEvery !== 0) {
			fs.writeFile("data/" + Cantrip.options.namespace + ".json", JSON.stringify(Cantrip.data), function(err) {
				if (err) {
					console.log(err);
				}
			});
			Cantrip.counter = 0;
		}

	},
	get: function(req, res, next) {
		if (_.isObject(req.targetNode) || _.isArray(req.targetNode)) {
			res.body = _.cloneDeep(req.targetNode);
			next();
		} else {
			res.body = {
				value: req.targetNode
			};
			next();
		}
	},
	post: function(req, res, next) {
		//If it's an array, post the new entry to that array
		if (_.isArray(req.targetNode)) {
			//Add ids to all objects within arrays in the sent object
			Cantrip.addMetadataToModels(req.body);
			//If the posted body is an object itself, add an id to it
			if (_.isObject(req.body) && !_.isArray(req.body)) {
				//Extend the whole object with an _id property, but only if it doesn't already have one
				req.body = _.extend({
					_id: md5(JSON.stringify(req.body) + (new Date()).getTime() + Math.random()),
					_createdDate: (new Date()).getTime(),
					_modifiedDate: (new Date()).getTime()
				}, req.body);
			}
			//Check if the given ID already exists in the collection
			for (var i = 0; i < req.targetNode.length; i++) {
				if (req.targetNode[i]._id === req.body._id) {
					return next({
						status: 400,
						error: "An object with the same _id already exists in this collection."
					});
				}
			}
			//Push it to the target array
			Cantrip.dataStore.set(req.path, req.body, function() {
				//Send the response
				res.body = _.cloneDeep(req.body);
				next();

			});
		} else {
			return next({
				status: 400,
				error: "Can't POST to an object. Use PUT instead."
			});
		}
	},
	put: function(req, res, next) {
		if (_.isObject(req.targetNode) && !_.isArray(req.targetNode)) {
			Cantrip.addMetadataToModels(req.body);
			//If the target had previously had a _modifiedDate property, set it to the current time
			if (req.targetNode._modifiedDate) req.body._modifiedDate = (new Date()).getTime();
			var save = function() {
				Cantrip.dataStore.set(req.path, req.body, function(err, status) {
					//Send the response
					res.body = {
						"success": true
					};
					next();
				});
			};
			//If it's an element inside a collection, make sure the overwritten _id is not present in the collection
			if (req.body._id && req.targetNode._id && req.body._id !== req.targetNode._id) {
				Cantrip.dataStore.parent(req.path, function(err, parent) {
					req.parentNode = parent;
					for (var i = 0; i < parent.length; i++) {
						if (parent[i]._id === req.body._id) {
							return next({
								status: 400,
								error: "An object with the same _id already exists in this collection."
							});
						}
					}
					//I there was no such problem
					save();
				});
			} else {
				save();
			}
		} else {
			return next({
				status: 400,
				error: "Can't PUT a collection."
			});
		}
	},
	delete: function(req, res, next) {
		//Get the parent node so we can unset the target
		Cantrip.dataStore.parent(req.path, function(err, parent) {
			//Last identifier in the path
			var index = _.last(req.pathMembers);
			//If it's an object (not an array), then we just unset the key with the keyword delete
			if (_.isObject(parent) && !_.isArray(parent)) {
				//We're not letting users delete the _id
				if ((index + "")[0] === "_") {
					return next({
						status: 400,
						error: "You can't delete an object's metadata."
					});
				} else {
					Cantrip.dataStore.delete(req.path, function() {
						//Send the response
						res.body = {
							"success": true
						};
						next();
					});
				}
				//If it's an array, we must remove it by id with the splice method	
			} else if (_.isArray(parent)) {
				Cantrip.dataStore.delete(req.path, function() {
					//Send the response
					res.body = {
						"success": true
					};
					next();
				});
			}

		});
	},
	//Recursively add _ids to all objects within an array (but not arrays) within the specified object.
	addMetadataToModels: function(obj) {
		//Loop through the objects keys
		for (var key in obj) {
			//If the value of the key is an array (means it's a collection), go through all of its contents
			if (_.isArray(obj[key])) {
				for (var i = 0; i < obj[key].length; i++) {
					//Assign an id to all objects
					if (_.isObject(obj[key][i]) && !_.isArray(obj[key][i])) {
						obj[key][i] = _.extend({
							_id: md5(JSON.stringify(obj[key][i]) + (new Date()).getTime() + Math.random()),
							_createdDate: (new Date()).getTime(),
							_modifiedDate: (new Date()).getTime()
						}, obj[key][i]);
						//Modify the _modifiedDate metadata property
						obj[key][i]._modifiedDate = (new Date()).getTime();
					}
				}
				//If it's an object, call the recursive method with that object
			} else if (_.isObject(obj[key])) {
				this.addMetadataToModels(obj[key]);
			}
		}
	},

	/**
	 * Send the errors thrown by the get/post/put/delete middleware
	 */
	error: function(error, req, res, next) {
		if (error.status && error.error) {
			res.status(error.status).send({
				"error": error.error
			});
		} else {
			console.log(error);
			res.status(400).send({
				"error": "An unknown error happened."
			});
		}
	},

	/**
	 * Send the response created by the get/post/put/delete methods after it was modified by custom middleware
	 */
	response: function(req, res, next) {
		res.send(res.body);
		next();
	}
}

module.exports = Cantrip;