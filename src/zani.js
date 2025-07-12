// Node Imports
const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');

// Custom Imports
const ZaniLog = require('./zaniLog');
const BPlusTree = require('./bPlusTree');

// Error Imports
const NoActiveDatabaseError = require('./error/noActiveDatabaseError');
const DeleteActiveDatabaseError = require('./error/deleteActiveDatabaseError');
const CollectionAlreadyExistsError = require('./error/collectionAlreadyExistsError');
const MissingParametersError = require('./error/missingParametersError');
const AttributeAlreadyIndexedError = require('./error/attributeAlreadyIndexedError');
const AttributeDepthExceededError = require('./error/attributeDepthExceededError');
const NoAttributesError = require('./error/noAttributesError');
const MissingEntryIdError = require('./error/missingEntryIdError');
const EntryNotFoundError = require('./error/entryNotFoundError');
const EntryValidationFailedError = require('./error/entryValidationFailedError');
const CollectionFolderNotFound = require('./error/collectionFolderNotFound');
const ValidatorFunctionError = require('./error/validatorFunctionError');
const EventEmitter = require('events');

/*
* 	BIG HITTER TO-DOS
	- CRUD
	- Pathing to specific destination
	- Write bufferingZaniLOG, causes EMFILE without it)

*	NEEDED ITEMS OR FEATURES
	- Query check to ensure its used properly. Assume proper use atm, not sure what it does if used wrong

	- implement .trash folder for safer deletion of items

	- Add function that creates a txt file of the attributes within each collection, like a meta.pdf
		- To build on a method that returns a json of values (IE {value: number, obj: {n: string}})

	- Add a function that exports an entire database into a single file
		- Requires a export() function to build file from data
		- Requires a import() function to build project from data file
	
	- Add a system to allow for control over CPU/resource utilization
		- Light (1) - 33% at most
		- Medium (2) - 66% at most
		- Heavy (3) - 100% at most

*	CONSIDERATIONS
	- Consider adding foreign keys later to constraints?
	- Consider adding $max, $min, $mean... Statistical query functions alongside $count

	- Consider a terminal-listener for real time data modification and access

*	DOCUMENTATION 
	- Create a MD documentation of query to follow

* 	DEVELOPMENT ITEMS
	- Clean up code
	- Optimize where needed
		- Reduce guardrails and such to reduce operation time
*/

/** A lightweight, out-of-memory NoSQL Document Store database system.
 *
 * @author Brock Kitterman <brock.kitterman@gmail.com>
 */
class Zani {
	/* -------------------------------------------------------------------------- */
	/*                                Global States                               */
	/* -------------------------------------------------------------------------- */
	/* ------------------------------ Global States ----------------------------- */
	/** Hard coded version of the code */
	version = 1.0;
	/** Hard coded, default metadata */
	meta = {
		version: 1.0,
		createdOn: Date.now(),
		lastUpdatedOn: Date.now(),
		collections: {
			// Keep list of collection as name: {entries: 0, queryStats: {attribute: count}, indexed: [attribute]}
			// Entries are used as primary key index counter for _id
			// Query states is for auto-indexing of attributes when needed. If query states > 10, it will auto-index that attribute
		},
		config: {
			compression: false,
			encryption: false,
			write_ahead_log: false,
			buffer_size: 256,
		},
		integrity: {
			last_compact: null,
			checksum: 'abc123',
			dirty: false,
		},
	};
	/** Cleanup method used on process termination */
	cleanupBound = this.#cleanup.bind(this);
	/** Used for error handling */
	errorBound = this.crashDetectorError.bind(this);
	/** Used for rejection handling */
	rejectionBound = this.crashDetectorRejection.bind(this);
	/** Instance of event emitter  */
	emitter = new EventEmitter();
	
	/* --------------------------------- Aliases -------------------------------- */
	setDatabase = this.useDatabase;
	createDatabase = this.useDatabase;

	createCollection = this.addCollection;
	deleteCollection = this.removeCollection;

	search = this.find;
	query = this.find;

	on = this.emitter.on.bind(this.emitter);
	off = this.emitter.off.bind(this.emitter);
	once = this.emitter.once.bind(this.emitter);
	removeAllListeners = this.emitter.removeAllListeners.bind(this.emitter);
	emit = () => {};

	
	/* -------------------------------- Variables ------------------------------- */
	/** The active database name. If undefined, no database is active. @*/
	databaseName;
	/** Instance of ZaniLog used for console and system logging. */
	logger;

	/** The options object used for settings of this class and its behavior. Can be set with {@link Zani#configureOptions} */
	options = {
		path: "",
		fileLimit: 20,
		treeOrder: 100,
		crashDetector: true,
		smartIndexing: true,
		throwErrors: true,
		emitEvents: false,
		consoleOptions: {
			systemLog: false,
			consoleLog: true,
			colorful: true,
		},
	};

	/** Create a new Zani object. If a databaseName is passed, it will immediately open that database, or create it
	 * if it does not exist.
	 *
	 * @param {string=} databaseName - The database to be opened or created
	 * @param {object=} options - The options object
	 *
	 * @param {number} [options.fileLimit=20] - Defines how many files can be opened by the program at any given time.
	 * @param {boolean} [options.crashDetector=true] - Enable crash detecting method to handle unexpected events, and log errors.
	 * @param {number} [options.treeOrder=100] - Define the max number of entries in any node of any index tree.
	 * @param {boolean} [options.smartIndexing=true] - When a value is queried 10 times, a index will be automatically created if not already present.
	 * @param {boolean} [options.throwErrors=true] - If true, errors will be thrown instead of just logged.
	 * @param {object} options.consoleOptions - Define the console options to be used by the logging object.
	 *
	 * @param {boolean} [options.consoleOptions.consoleLog=true] - Enable console logging
	 * @param {boolean} [options.consoleOptions.systemLog=true] - Enable system logging to the specified file when available
	 * @param {boolean} [options.consoleOptions.colorful=true] - Enable colorful console output
	 */
	constructor(databaseName, options) {
		// Create logger object
		this.logger = new ZaniLog(databaseName, this.options.consoleOptions, this.options.path | "./");
		this.logger.log(`Loading`);

		// Initial startup
		if (options) this.configureOptions(options);

		// Register a cleanup on process exit
		process.on('exit', this.cleanupBound);
		process.on('SIGINT', this.cleanupBound);
		process.on('SIGTERM', this.cleanupBound);
		process.on('uncaughtException', this.cleanupBound);

		// Set current database
		if (databaseName) {
			this.useDatabase(databaseName);

			// Ensure integrity value is unexpected crash-ready
			this.meta.integrity.dirty = true;
			this.updateMetaFile();

			this.logger.log(`Ready - ${this.databaseName}`);
			this.emitter.emit('systemReady', {database: this.databaseName});
			return;
		}

		this.logger.log('Ready - No database selected');
		this.emitter.emit('systemReady', {database: false});
	}

	/** Configure the options variable to match the passed arguments. If consoleOptions is present, it will configure
	 * the logger options, ZaniLog, as well through {@link ZaniLog#configureOptions}.
	 *
	 * @param {object} options - The new options to be used by Zani.
	 *
	 * @param {number} [options.fileLimit=20] - Defines how many files can be opened by the program at any given time.
	 * @param {boolean} [options.crashDetector=true] - Enable crash detecting method to handle unexpected events, and log errors.
	 * @param {number} [options.treeOrder=100] - Define the max number of entries in any node of any index tree.
	 * @param {boolean} [options.smartIndexing=true] - When a value is queried 10 times, a index will be automatically created if not already present.
	 * @param {boolean} [options.throwErrors=true] - If true, errors will be thrown instead of just logged.
	 * @param {boolean} [options.emitEvents=false] - Enable event emissions
	 * 
	 * @param {object} options.consoleOptions - Define the console options to be used by the logging object.
	 */
	configureOptions(options) {
		if (options.hasOwnProperty('path')) this.options.path = options.path;
		if (options.hasOwnProperty('fileLimit')) this.options.fileLimit = options.fileLimit;
		if (options.hasOwnProperty('crashDetector')) this.options.crashDetector = options.crashDetector;
		if (options.hasOwnProperty('treeOrder')) this.options.treeOrder = options.treeOrder;
		if (options.hasOwnProperty('smartIndexing')) this.options.smartIndexing = options.smartIndexing;
		if (options.hasOwnProperty('throwErrors')) this.options.throwErrors = options.throwErrors;
		if (options.hasOwnProperty('emitEvents')) this.options.emitEvents = options.emitEvents;

		if (options.hasOwnProperty('consoleOptions'))
			this.logger.configureOptions(options.consoleOptions);

		// Set options
		if (this.options.crashDetector) {
			process.on('uncaughtException', this.errorBound);
			process.on('unhandledRejection', this.rejectionBound);
		} else {
			process.off('uncaughtException');
			process.off('unhandledRejection');
		}

		if (this.options.emitEvents) {
			this.emit = this.emitter.emit.bind(this.emitter);
		} else {
			this.emit = () => {};
		}

		this.emitter.emit('zaniOptionsConfigured', options);
	}

	/* -------------------------------------------------------------------------- */
	/*                             Database Operations                            */
	/* -------------------------------------------------------------------------- */

	/** Set the active database to the passed database. This closes a currently open database if there is one.
	 *
	 * @param {string} databaseName - The name of the desired active database
	 */
	useDatabase(databaseName) {
		this.logger.log('Switching database to ' + databaseName);

		// If there is an open database, close it first
		if (this.databaseName) this.closeDatabase();

		// Open new database
		this.databaseName = databaseName;
		this.logger.setLogFile(this.databaseName);
		this.#openDatabase();
	}

	/** Close the current database and detach any files in use. This does not end the Zani object,
	 * but is advised to be called prior to doing so. If no database is open, it will do nothing.
	 */
	closeDatabase() {
		if (!this.databaseName) return;

		this.logger.log('Closing database ' + this.databaseName);

		//flush queue
		//Checksum

		this.meta.integrity.dirty = false;
		this.updateMetaFile();
		this.logger.setLogFile(undefined);
		this.databaseName = undefined;
		this.logger.log('Database closed');
		this.emitter.emit('databaseClosed', {});
	}

	/** Delete the provided database via its name. This will not close the active database, regardless of passed
	 * or implied.
	 *
	 * This action is not reversible, and will delete the entire database folder.
	 *
	 * @param {string} databaseName - The name of the desired database to delete
	 */
	deleteDatabase(databaseName) {
		// Ensure a value was passed or the database is not the active one.
		if (!databaseName || databaseName === this.databaseName) {
			this.handleError(new DeleteActiveDatabaseError(this.databaseName || 'Database Undefined'));
			return;
		}

		// Ensure the desired directory/database exists
		const dbPath = path.join(this.options.path, databaseName);
		if (!fs.existsSync(dbPath)) {
			this.handleError(new DatabaseNotFoundError(databaseName, 'delete'));
			return;
		}

		// Delete the database
		//TODO make this async, use try-catch here
		this.logger.warn('Deleting database ' + databaseName);
		fs.rmSync(dbPath, { recursive: true });
		this.logger.warn('Database deleted');
	}

	/** Opens the desired database. If any directories or files are missing, they will be created.
	 *
	 * This method should not be called to create or open a database.
	 *
	 * @access private
	 */
	#openDatabase() {
		//Check if database folder exists
		const dbPath = path.join(this.options.path, this.databaseName);
		const collectionsPath = path.join(dbPath, 'collections');
		const indexesPath = path.join(dbPath, 'indexes');
		const logsPath = path.join(dbPath, 'logs');
		const metaPath = path.join(dbPath, 'meta.json');
		if (!fs.existsSync(dbPath)) fs.mkdirSync(dbPath);
		if (!fs.existsSync(collectionsPath)) fs.mkdirSync(collectionsPath);
		if (!fs.existsSync(indexesPath)) fs.mkdirSync(indexesPath);
		if (!fs.existsSync(logsPath)) fs.mkdirSync(logsPath);
		if (!fs.existsSync(metaPath)) {
			this.meta.databaseName = this.databaseName;
			fs.writeFileSync(metaPath, JSON.stringify(this.meta));
		}
		if (this.options.consoleOptions.systemLog) {
			const auditLogPath = path.join(logsPath, 'audit.log');
			if (!fs.existsSync(auditLogPath)) fs.writeFileSync(auditLogPath, '');
		}
		this.meta = JSON.parse(fs.readFileSync(metaPath));
		this.logger.log(`Connected to ${this.databaseName} at ${this.logger.getCurrentDate()}`);
		this.emitter.emit('databaseSet', { databaseName: this.databaseName });
	}

	/* -------------------------------------------------------------------------- */
	/*                            Collection Operations                           */
	/* -------------------------------------------------------------------------- */

	/** Adds a collection to the database. This includes creating the folder and updating the metadata of
	 * this database.
	 *
	 * @param {string} collection - The name of the collection to add
	 */
	addCollection(collection, options = {}) {
		// Check if active database
		if (!this.checkForActiveDatabase()) return;

		// Check if collection already exists
		if(this.meta.collections.hasOwnProperty(collection)) {
			this.handleError(new CollectionAlreadyExistsError(collection, 'add/createCollection'));
			return;
		}

		// Create collection folder
		const collectionPath = path.join(this.options.path, this.databaseName, `collections`, collection)
		fs.mkdirSync(collectionPath);

		// Create options object
		const indexes = this.configureCollectionOptions(options);
		const metaPath = path.join(collectionPath, 'meta.json')
		fs.writeFileSync(metaPath, JSON.stringify(options));

		// Create Collection Index Folder and any default collections
		const indexPath = path.join(this.options.path, this.databaseName, 'indexes', collection);
		fs.mkdirSync(indexPath);
		
		for(const element of indexes) 
			this.createIndex(collection, element);

		// Update metadata, add collection
		Object.defineProperty(this.meta.collections, collection, {
			value: { entries: 0, queryStats: {}, indexed: [], availableIDs: [] },
			writable: true,
			enumerable: true,
		});
		this.updateMetaFile();

		this.logger.log(`Added collection ${collection} to ${this.databaseName}`);
		this.emitter.emit('collectionAdded', {
			collection: collection, options: options, databaseName: this.databaseName 
		});
	}

	/** Removes a collection from the database. This includes deleting the file and updating the metadata of
	 * this database.
	 *
	 * Note: this action cannot be undone
	 *
	 * @param {string} collection - The name of the collection to delete
	 */
	removeCollection(collection) {
		// Check if system is ready
		if (!this.checkForCollection(collection, 'removeCollection')) return;

		// Update metadata, remove collection
		if (this.meta.collections[collection]) {
			delete this.meta.collections[collection];
			this.updateMetaFile();
		}

		// Delete the collection folder
		const collectionPath = path.join(this.options.path, this.databaseName, 'collections', collection);
		if (fs.existsSync(collectionPath))
			fs.rmSync(collectionPath, { recursive: true, force: true });

		// Delete index files
		const indexPath = path.join(this.options.path, this.databaseName, 'indexes', collection);
		if (fs.existsSync(indexPath))
			fs.rmSync(indexPath, { recursive: true, force: true });

		this.logger.log(`Deleted collection ${collection}`, this.databaseName);
		this.emitter.emit('collectionRemoved', {
			collection: collection, databaseName: this.databaseName 
		});
	}

	/** Renames the supplied collection with the provided name. This includes metadata and file name updates.
	 *
	 * @param {string} - The collection to rename
	 * @param {string} - The new name for the collection
	 */
	updateCollection(collection, newName) {
		// Check if system is ready
		if (!this.checkForCollection(collection, 'updateCollection')) return;

		// Check if a new name for the collection was provided
		if (!newName) {
			this.handleError(new MissingParametersError('newName', 'updateCollection'));
			return;
		}

		// Rename collection file
		const oldCollectionPath = path.join(this.options.path, this.databaseName, 'collections', collection);
		const newCollectionPath = path.join(this.options.path, this.databaseName, 'collections', newName);
		fs.renameSync(oldCollectionPath, newCollectionPath);

		// Rename Index Folder
		const oldIndexPath = path.join(this.options.path, this.databaseName, 'indexes', collection);
		const newIndexPath = path.join(this.options.path, this.databaseName, 'indexes', newName);
		fs.renameSync(oldIndexPath, newIndexPath);

		// Update metadata file, rename object associated
		Object.defineProperty(this.meta.collections, newName, {
			value: this.meta.collections[collection],
			writable: true,
			enumerable: true,
		});
		delete this.meta.collections[collection];
		this.updateMetaFile();

		this.logger.log(`Renamed collection ${collection} to ${newName}`, this.databaseName);
		this.emitter.emit('collectionUpdated', {
			collection: collection, newName: newName, databaseName: this.databaseName 
		});
	}

	/** Returns the entire collection as object[].
	 *
	 * Note: This method will load the entire collection file into memory. It is advised not to use this on
	 * larger data sets, as it is space and time intensive.
	 *
	 * @param {string} collection - The collection to retrieve
	 * @returns The collection array of objects
	 */
	async getCollection(collection) {
		// Check if system is ready
		if (!this.checkForCollection(collection, 'getCollection')) return;

		// TODO add buffer here later
		const collectionSize = this.getCollectionSize(collection);
		var results = [];

		var entries = await this.batchReadEntries(collection, collectionSize, this.options.fileLimit);
		for (const entry of entries) {
			if (entry !== null) 
				results.push(entry);
		}

		this.emitter.emit('collectionGet', {
			collection: collection, options: this.getCollectionSettings(collection), databaseName: this.databaseName 
		});
		return results;
	}

	/** Configure a collection options object with all necessary settings, as defined by either the user
	 * or Zani's default settings. 
	 * 
	 * Note: For attribute settings, they should be placed at options.attributes[attributeName]. These settings
	 * only work at depth 1. Nesting objects can be permitted through use of 'datatype = "object"' parameter. 
	 * Nested objects can be indexed to depth 2.
	 * 
	 * @param {object} options - The collection settings object.
	 * 
	 * @param {boolean} [options.autofillAttributes=false] - If a attribute is missing, it will automatically be added to the entry with appropriate datatype or null
	 * @param {boolean} [options.allowExtraAttributes=true] - If false, no attributes can be added in any entry that do not exist prior to attribute creation.
	 * @param {boolean} [options.attributeLock=false] - If true, only attributes within the attribute array may be within an entry.
	 * @param {boolean} [options.timestamps=false] - If true, the system will maintain a _createdOn and _updatedAt attribute with matching timestamps.
	 * 
	 * @param {object} [options.attributes={}] - A object that contains attributes and their individual settings. If a attribute is present in this list, it is required to appear in the entry. If it does not, it will autofill (if checked) or error out otherwise.  
	 * @param {object} [options.attributes.domain=false] - An object with two attributes: lower and upper that serve as bounds for data validation.
	 * @param {number} [options.attributes.domain.lower=false] - Contains the lower bound of permissible values, inclusive. If false, there is no lower bound.
	 * @param {number} [options.attributes.domain.upper=false] - Contains the upper bound of permissible values, inclusive. If false, there is no upper bound.
	 * @param {any[]} [options.attributes.enum=false] - Contains an array of permissible data/values that can be entered as for this attribute. False if all values are permissible. This disables all other constraints.
	 * @param {any[]} [options.attributes.outlier=false] - Contains an array of permissible data/values that can be entered as for this attribute. False if no outliers are permissible. This ignores other constraints.
	 * @param {RegExp} [options.attributes.pattern=false] - Contains a RegEx expression for string validation. False if anything is permissible.
	 * @param {boolean} [options.attributes.unique=false] - if true, this values field must not match any other fields of this attribute within the collection.
	 * @param {string} [options.attributes.dataType=false] - String form of permissible data type. Can be anything returned by typeof or 'array'. False if no limitations.
	 * @param {boolean} [options.attributes.permitNull=true] - Defines if null should be counted as a valid data value.
	 * @param {function} [options.attributes.validator=false] - Define a custom expression for use of validating data values. If null, no validation expression apart from above settings will be used.
	 * @param {boolean} [options.attributes.immutable=false] - if true, this field cannot be changed after creation.
	 * @param {function} [options.attributes.autofillValue=null] - Define a custom value for use in autofill, if enabled. If not provided, it will default to null.
	 * @param {boolean} [options.attributes.required=true] - if true, this attribute is required. Can be used to override default attribute settings.
	 * @param {boolean} [options.attributes.indexed=false] - If true, a index for this attribute will be created by default.
	 * 
	 * @returns {string[]} - A list of attributes to be indexed by default.
	*/
	configureCollectionOptions(options) {
		if(!options.hasOwnProperty('autofillAttributes')) options.autofillAttributes = false;
		if(!options.hasOwnProperty('allowExtraAttributes')) options.allowExtraAttributes = true;
		if(!options.hasOwnProperty('attributeLock')) options.attributeLock = false;
		if(!options.hasOwnProperty('timestamps')) options.timestamps = false;

		var defaultIndexes = [];
		if(options.hasOwnProperty('attributes')) {
			for(const key in options.attributes) {
				if(options.attributes[key].hasOwnProperty('domain')) {
					if(!options.attributes[key].domain.hasOwnProperty('lower')) 
						options.attributes[key].domain.lower = false;
					if(!options.attributes[key].domain.hasOwnProperty('upper')) 
						options.attributes[key].domain.upper = false;
				} else options.attributes[key].domain = false;

				if(!options.attributes[key].hasOwnProperty('enum')) options.attributes[key].enum = false;
				if(!options.attributes[key].hasOwnProperty('outlier')) options.attributes[key].outlier = false;
				if(!options.attributes[key].hasOwnProperty('pattern')) options.attributes[key].pattern = false;
				if(!options.attributes[key].hasOwnProperty('unique')) options.attributes[key].unique = false;
				if(!options.attributes[key].hasOwnProperty('dataType')) options.attributes[key].dataType = false;
				if(!options.attributes[key].hasOwnProperty('permitNull')) options.attributes[key].permitNull = true;
				if(!options.attributes[key].hasOwnProperty('validator')) options.attributes[key].validator = false;
				if(!options.attributes[key].hasOwnProperty('immutable')) options.attributes[key].immutable = false;
				if(!options.attributes[key].hasOwnProperty('autofillValue')) options.attributes[key].autofillValue = null;
				if(!options.attributes[key].hasOwnProperty('required')) options.attributes[key].required = true;


				if(options.attributes[key].hasOwnProperty('indexed'))
					if(options.attributes[key].indexed === true)
						defaultIndexes.push(key);
			}
		}else options.attributes = {};

		this.emitter.emit('collectionOptionsConfigured', { 
			collection: collection, options: options, defaultIndexes: defaultIndexes, database: this.databaseName
		});
		return defaultIndexes;
	}

	/** Retrieves a collections setting object from its meta.json file.
	 * 
	 * @param {string} collection - The name of the collection
	 * @returns {object} - The collection settings object
	 */
	getCollectionSettings(collection) {
		if (!this.checkForCollection(collection, 'getSettings')) return;

		return JSON.parse(fs.readFileSync(path.join(this.options.path, this.databaseName, 'collections', collection, 'meta.json')))
	}

	/* -------------------------------------------------------------------------- */
	/*                             Indexing Operations                            */
	/* -------------------------------------------------------------------------- */

	/** Given a collection name, index the values for the provided attribute name. This index
	 * will then be used going forwards to increase query speed, but may result in slightly slower insert,
	 * deletion, and update speeds. Only values that are strings or numbers will be indexed.
	 *
	 * To define the attribute, it should be flattened using dot notation. This can only index up to depth 2.
	 *
	 * @example
	 * {
	 *  	foo: {bar: 0}, 	// Depth 2
	 *  	value: 0		// Depth 1
	 * }
	 * Attribute = "value" or "foo.bar" respectively
	 *
	 * @param {string} collection - The collection to be indexed.
	 * @param {string} attribute - The attribute to index.
	 */
	async createIndex(collection, attribute) {
		// Check if system is ready
		if (!this.checkForCollection(collection, 'createIndex')) return;
		const startTime = Date.now();

		this.emitter.emit('indexCreation_Progress', 'Creating Index');

		// Check if attribute was passed
		if (!attribute) {
			this.handleError(new MissingParametersError('attribute', 'createIndex'));
			return;
		}

		const indexPath = path.join(this.options.path, this.databaseName, 'indexes', collection, attribute);

		// Check if attribute is already indexed
		if (fs.existsSync(indexPath)) {
			this.handleError(new AttributeAlreadyIndexedError(collection, attribute));
			this.emitter.emit('indexCreation_Progress', 'Canceled');
			return;
		}

		// Check if attribute exceeds permissible indexing depth
		const unflattenedAttribute = this.unflattenAttribute(attribute);
		if (unflattenedAttribute.length > 2) {
			this.handleError(new AttributeDepthExceededError(unflattenedAttribute, 2, 'createIndex'));
			this.emitter.emit('indexCreation_Progress', 'Canceled');
			return;
		}

		// Create Index Files
		fs.mkdirSync(indexPath);

		// Create the BPlusTree structure
		//TODO update when the index files are included in BPlusTree.
		var indexTree = new BPlusTree(indexPath, 100);
		this.meta.collections[collection].indexed.push(attribute);

		// Check each entry for the attribute. If it exists, add to the tree.
		
		this.emitter.emit('indexCreation_Progress', 'Reading Entries');
		const entries = await this.batchReadEntries(collection, resultSet, this.options.fileLimit);
		
		this.emitter.emit('indexCreation_Progress', 'Building Index');
		for (const entry of entries) {
			var hasProperty = true;

			// Prevent fragmentation from throwing system off
			if (entry === null) continue;

			let id = entry._id;

			for (const key of unflattenedAttribute) {
				if (entry.hasOwnProperty(key)) {
					entry = entry[key];
				} else {
					hasProperty = false;
					break;
				}
			}

			if (hasProperty && (typeof entry === 'string' || typeof entry === 'number')) {
				indexTree.insert(entry, id);
			}
		}

		const endTime = Date.now();
		this.logger.log(`Created index files for ${attribute}`, this.databaseName);
		this.emitter.emit('indexCreation_Progress', 'Index Created');
		this.emitter.emit('indexCreated', {
			attribute: attribute, 
			collection: collection, 
			time: this.calculateTime(startTime, endTime), 
			databaseName: this.databaseName 
		});
	}

	/* -------------------------------------------------------------------------- */
	/*                          Collection Entry Methods                          */
	/* -------------------------------------------------------------------------- */

	/** Adds the value of entry to the collection provided.
	 *
	 * @param {string} collection - The collection name
	 * @param {object} entry - The entry to add to the collection
	 */
	addEntry(collection, entry) {
		// Check if system is ready
		if (!this.checkForCollection(collection, 'addEntry')) return;

		// Check if entry value was passed
		if (!entry) {
			this.handleError(new MissingParametersError('entry', 'addEntry'));
			return;
		}

		// Check the entry is not empty
		if (Object.keys(entry).length === 0) {
			this.handleError(new NoAttributesError('addEntry'));
			return;
		}

		// Get metadata index, _id for entry
		let id = 0;
		if (this.meta.collections[collection].availableIDs.length > 0) {
			id = this.meta.collections[collection].availableIDs.pop();
		} else id = this.meta.collections[collection].entries++;

		// Get collection settings
		const settings = this.getCollectionSettings(collection);

		// Ensure ID is not being defined by user
		if (entry.hasOwnProperty('_id')) {
			this.logger.warn('The attribute _id is reserved by the system, and will be ignored.');
			delete entry._id;
		}

		// Add property for _id
		entry = Object.defineProperty(entry, '_id', {
			value: id,
			enumerable: true,
			writable: false,
		});

		//TODO? Consider removing this since it only serves to debug
		// Rearrange entry such that _id is first
		const { _id, ...rest } = entry;
		entry = { _id, ...rest };

		// Ensure entry matches settings
		if(!this.validateEntry(collection, entry, false, settings)) return;

		// Add to collection
		const entryFolderPath = path.join(this.options.path, this.databaseName, 'collections', collection, this.getEntryFolder(id));
		const entryFilePath = this.getEntryPath(collection, id);
		if (!fs.existsSync(entryFolderPath)) {
			fs.mkdirSync(entryFolderPath);
		}
		fs.writeFileSync(entryFilePath, JSON.stringify(entry));

		this.updateMetaFile();

		// Add any values into their respective index
		for (const key in entry) {
			if (this.meta.collections[collection].indexed.includes(key)) {
				const indexPath = path.join(this.options.path, this.databaseName, 'indexes', collection, key);
				const tree = new BPlusTree(indexPath);
				tree.insert(entry[key], entry._id);
				this.logger.log(`Updated index of ${collection}\\${key} with value ${entry[key]}`);
			}
		}

		this.logger.log(`Added entry: ${id} to ${collection}`, this.databaseName);
		this.emitter.emit('entryAdded', {
			entry: entry, collection: collection, databaseName: this.databaseName 
		});
	}

	/** Delete an entry from the provided collection via its entry id, which is denoted as the attribute '_id".
	 *
	 * @param {string} collection - The name of the collection to operate on
	 * @param {number} entryId - The entry id
	 * @returns {boolean} - True if successful, false otherwise.
	 */
	deleteEntry(collection, entryId) {
		// Check if system is ready
		if (!this.checkForCollection(collection, 'deleteEntry')) return;

		// Check if entry value was passed
		if (!entryId) {
			his.handleError(new MissingParametersError('entry', 'deleteEntry'));
			return false;
		}

		// Delete from collection file
		const filePath = this.getEntryPath(collection, entryId);
		const entryObject = JSON.parse(fs.readFileSync(filePath));
		fs.unlinkSync(filePath);

		// Add removed id to metadata
		this.meta.collections[collection].availableIDs.push(entryId);
		this.updateMetaFile();

		// Delete from index files
		for (const key in entryObject) {
			if (this.meta.collections[collection].indexed.includes(key)) {
				const indexPath = path.join(this.options.path, this.databaseName, 'indexes', collection, key);
				const tree = new BPlusTree(indexPath);
				tree.delete(entryObject[key], entryId);
				this.logger.log(
					`Deleted ${entryId} of ${entryObject[key]} in index file for ${key}`,
					this.databaseName,
				);
			}
		}

		this.logger.log(`Deleted ${entryId} from ${collection}`, this.databaseName);
		this.emitter.emit('entryDeleted', {
			entry: entryObject, collection: collection, databaseName: this.databaseName 
		});

		return true;
	}

	/** Given a entry (file) number of a collection (folder), return that entry.
	 *
	 * Id starts at 0.
	 *
	 * @param {string} collection - The collection to retrieve from
	 * @param {number} id - The desired file number/entry id
	 *
	 * @return {object}
	 */
	getEntry(collection, id) {
		// Check if system is ready
		if (!this.checkForCollection(collection, 'getEntry')) return;

		// Check if a line number was passed
		if (id === undefined) {
			this.handleError(new MissingParametersError('id', 'getEntry'));
			return;
		}

		// Read file contents
		const path = this.getEntryPath(collection, id);
		this.emitter.emit('entryGet', {
			entry: entry | null, collection: collection, databaseName: this.databaseName 
		});
		if (fs.existsSync(path)) return JSON.parse(fs.readFileSync(path));

		// File does not exist due to deletion or error
		return null;
	}

	/** Internal variant of {@link Zani#getEntry} use for async purposes. It assumes perfect input
	 *
	 * @param {string} collection - The name of the collection
	 * @param {number} id - The entry id
	 * @returns {object} Entry object
	 */
	async getEntryAsync(collection, id) {
		// Read file contents
		const path = this.getEntryPath(collection, id);
		if (fs.existsSync(path)) {
			try {
				const data = await fsPromises.readFile(path, 'utf8');
				return JSON.parse(data);
			} catch (err) {
				this.logger.error(err); 
				return null;
			}
		}

		// File does not exist
		return null;
	}

	/** Read a batch of entry files in parallel, but throttle the number of concurrent reads.
	 * 
	 * @param {string} collection - The collection name
	 * @param {number[]} ids - Array of entry IDs to read
	 * @param {number} batchSize - Max number of files to read in parallel
	 * @returns {Promise<object[]>} - Array of entry objects (null for missing)
	 */
	async batchReadEntries(collection, ids, batchSize = 20) {
		const start = Date.now();
		const results = [];
		for (let i = 0; i < ids.length; i += batchSize) {
			const batch = ids.slice(i, i + batchSize);
			const batchResults = await Promise.all(
				batch.map(id => this.getEntryAsync(collection, id))
			);
			results.push(...batchResults);
		}
		const end = Date.now();
		this.emitter.emit('collectionFullRead', { 
			collection: collection, databaseName: this.databaseName, time: this.calculateTime(start, end) 
		});
		
		return results;
	}

	/** Given a collection name, update a desired entry. These updates are made through the object passed, which
	 * must contain a '_id" value to denote which object to update, as well as attributes for each addition.
	 *
	 * If these attributes are not present within the object already, they will be added to the entry. if they
	 * are already present, the attribute will be overwritten with the new updated one. To delete an attribute,
	 * pass the value for the attribute within the object as 'undefined'. If null is passed, it will be set to null
	 * instead.
	 *
	 * @example
	 * Exists: { value: 3, foo: "bar", type: { data: 0, type: 'string'} }
	 * UpdatesToMake: { value: null, foo: undefined, type: { data: true } }
	 * Results: { value: null, type: { data: true, type: 'string' } }
	 *
	 * @param {string} collection - The name of the collection
	 * @param {object} updatesToMake - The desired updates for the entry
	 */
	updateEntry(collection, updatesToMake) {
		// Check if system is ready
		if (!this.checkForCollection(collection, 'updateEntry')) return;

		// Check for updatesToMake
		if (!updatesToMake) {
			this.handleError(new MissingParametersError('updatesToMake', 'updateEntry'));
			return;
		}

		// Check the entry is not empty
		if (Object.keys(updatesToMake).length === 0) {
			this.handleError(new NoAttributesError('updateEntry'));
			return;
		}

		// Check updatesToMake has _id
		if (updatesToMake._id === undefined) {
			this.handleError(new MissingEntryIdError('updateEntry'));
			return;
		}

		// Check if file exists
		var entry = this.getEntry(collection, updatesToMake._id);
		if (entry === null) {
			this.handleError(new EntryNotFoundError(collection, updatesToMake._id, 'update'));
			return;
		}

		// Ensure entry matches settings
		if(!this.validateEntry(collection, entry, true, settings)) return;

		// Store original values for index removal post-update
		const originalValues = {};
		for (const key in updatesToMake) {
			if (this.meta.collections[collection].indexed.includes(key)) {
				Object.defineProperty(originalValues, key, {
					value: entry[key] || null,
					writable: false,
					enumerable: true,
				});
			}
		}

		// Perform update operations recursively
		entry = this.updateEntryRecursive(entry, updatesToMake);

		// Push to disk
		fs.writeFileSync(this.getEntryPath(collection, entry._id), JSON.stringify(entry));

		// Update index file
		for (const key in originalValues) {
			 const indexPath = path.join(this.options.path, this.databaseName, 'indexes', collection, key);
			const tree = new BPlusTree(indexPath);
			if (originalValues[key] !== null) tree.delete(originalValues[key], entry._id);
			if (entry.hasOwnProperty(key) && entry[key] !== null) tree.insert(entry[key], entry._id);
		}

		this.logger.log(`Updated entry ${entry._id} in collection ${collection}`, this.databaseName);
		this.emitter.emit('entryUpdated', {entry: entry, collection: collection, databaseName: this.databaseName });
		
	}

	/** Helper method for {@link Zani#updateEntry} that performs that actual object updates through recursion.
	 * It will pass through each value in updatesToMake and update entry accordingly by the following rules:
	 *
	 * If these attributes are not present within the object already, they will be added to the entry. if they
	 * are already present, the attribute will be overwritten with the new updated one. To delete an attribute,
	 * pass the value for the attribute within the object as 'undefined'. If null is passed, it will be set to null
	 * instead.
	 *
	 * @example
	 * Exists: { value: 3, foo: "bar", type: { data: 0, type: 'string'} }
	 * UpdatesToMake: { value: null, foo: undefined, type: { data: true } }
	 * Results: { value: null, type: { data: true, type: 'string' } }
	 *
	 * @param {object} entry - The entry pulled from storage
	 * @param {object} updatesToMake - The desired updates for the entry
	 */
	updateEntryRecursive(entry, updatesToMake) {
		for (const key in updatesToMake) {
			if (key === '_id') continue;

			if (
				typeof updatesToMake[key] === 'object' &&
				updatesToMake[key] !== null &&
				entry.hasOwnProperty(key)
			) {
				if (entry[key] !== null && typeof entry[key] === 'object') {
					entry[key] = this.updateEntryRecursive(entry[key], updatesToMake[key]);
				} else {
					entry[key] = updatesToMake[key];
				}
			} else if (entry.hasOwnProperty(key)) {
				if (updatesToMake[key] === undefined) {
					delete entry[key];
				} else {
					entry[key] = updatesToMake[key];
				}
			} else {
				if (updatesToMake[key] === undefined) continue;
				Object.defineProperty(entry, key, {
					value: updatesToMake[key],
					writable: true,
					enumerable: true,
				});
			}
		}

		return entry;
	}

	/** Compare an entry to a collection settings, and ensure it either is permissible by all constraints, and/or
	 * is matching collection settings to be added. This method should be used for both updating and inserting.
	 * 
	 * Depending on the value of update, {@link Zani#validateEntryUpdate} will be called to service updates due
	 * to difference validation checking.
	 * 
	 * If settings is not passed, it will be gathered based on collection name provided.
	 * 
	 * @param {string} collection - The name of the collection
	 * @param {object} entry - The entry to be added to collection
	 * @param {boolean} update - If this should be compared to as an update (true) or insertion (false)
	 * @param {object?} settings - The settings object
	 * @returns {boolean} - Result of validation against collection settings 
	 */
	validateEntry(collection, entry, update, settings) {
		if(!this.checkForCollection(collection, 'validateEntry')) return false;
		if(!settings) settings = this.getCollectionSettings(collection);

		if(update) return this.validateEntryUpdate(collection, entry, settings);

		// Collection wide checks
		const entryKeys = Object.keys(entry);

		// Settings.attributeLock check
		if(settings.attributeLock) {
			const entryStructure = Object.keys(settings.attributes);
			entryStructure.push( ... ['_id', '_createdOn', '_updatedOn']);
			var invalidKeys = [];
			var valid = true;

			for(const key of entryStructure) {
				if(entryKeys.includes(key)) continue;
				invalidKeys.push(key);
			}

			if(entryStructure.length !== entryKeys.length) valid = false;

			if(invalidKeys.length > 0) {
				if(settings.autofillAttributes) {
					for(const key of invalidKeys) {
						Object.defineProperty(entry, key, {
							value: settings.attributes[key].autofillValue,
							enumerable: true,
							writable: true,
						});
					}
				}else {
					this.handleError(new EntryValidationFailedError(collection, invalidKeys.toString(), 'attributeLock', true, 'Missing attributes'));
					return false;
				}
			}

			if(!valid) {
				if(settings.autofillAttributes) {
					const structureSet = new Set(entryStructure);
					const entrySet = new Set(entryKeys);
					const setDifference = this.setDifference(structureSet, entrySet);

					for(const key of [... entrySet]) {
						if(!setDifference.has(key)) delete entry[key];
					}
				}else {
					this.handleError(new EntryValidationFailedError(collection, 'Extra Attributes', 'attributeLock', true, 'Extra attributes'));
					return false;
				}
			}
		}

		// Handle attribute individual settings
		const attributesList = Object.keys(settings.attributes);
		for(const attribute of attributesList) {
			
			// Settings.attribute.required check
			if(settings.attributes[attribute].required) {
				if(!entry.hasOwnProperty(attribute)) {
					if(settings.autofillAttributes) {
						Object.defineProperty(entry, attribute, {
							value: settings.attributes[attribute].autofillValue,
							enumerable: true,
							writable: true,
						});
						continue;
					} else {
						this.handleError(new EntryValidationFailedError(
							collection, attribute, 'required', true, 'Missing attribute'));
						return false;
					}
				}
			}

			// settings.attributes.enum check
			if(settings.attributes[attribute].enum !== false) {
				if(settings.attributes[attribute].enum.length !== 0) {
					if(!settings.attributes[attribute].enum.includes(entry[attribute])) {
						this.handleError(new EntryValidationFailedError(
							collection, attribute, 'enum', settings.attributes[attribute].enum, entry[attribute]));
						return false;
					} else {
						continue;
					}
				}
			}

			// settings.attributes.outlier check
			if(settings.attributes[attribute].outlier !== false) {
				if(settings.attributes[attribute].outlier.length !== 0) {
					if(settings.attributes[attribute].outlier.includes(entry[attribute])) {
						continue;
					}
				}
			}

			// settings.attributes.datatype check
			const attributeDatatype = this.getAttributeDataType(entry[attribute]);
			if(settings.attributes[attribute].dataType !== false) {
				if(attributeDatatype !== settings.attributes[attribute].dataType) {
					this.handleError(new EntryValidationFailedError(
						collection, attribute, 'dataType', settings.attributes[attribute].dataType, attributeDatatype));
					return false;
				}
			}

			// settings.attributes.permitNull check
			if(!settings.attributes[attribute].permitNull) {
				if(attributeDatatype === 'null') {
					this.handleError(new EntryValidationFailedError(
						collection, attribute, 'permitNull', false, 'null'));
					return false;
				}
			}

			// settings.attributes.domain check
			if(attributeDatatype === 'number' && settings.attributes[attribute].domain !== false) {
				const entryVal = entry[attribute];
				const lower = settings.attributes[attribute].domain.lower || -Infinity;
				const upper = settings.attributes[attribute].domain.upper || Infinity;

				if(entryVal<lower || entryVal > upper) {
					this.handleError(new EntryValidationFailedError(
						collection, attribute, 'domain', settings.attributes[attribute].domain, entry[attribute]));
					return false;
				}
			}

			// settings.attributes.pattern check 
			if(attributeDatatype === 'string' && settings.attributes[attribute].pattern !== false) {
				const entryVal = entry[attribute];
				const expression = new RegExp(settings.attributes[attribute].pattern);

				if(!expression.test(entryVal)) {
					this.handleError(new EntryValidationFailedError(
						collection, attribute, 'pattern', settings.attributes[attribute].pattern, entry[attribute]));
					return false;
				}
			}

			// settings.attribute.validator check
			if(settings.attributes[attribute].validator !== false) {
				try{
					if(settings.attributes[attribute].validator(entry[attribute]) !== true) {
						this.handleError(new EntryValidationFailedError(
							collection, attribute, 'validator', settings.attributes[attribute].validator, entry[attribute]));
						return false;
					}
				} catch(err) {
					this.handleError(new ValidatorFunctionError(collection, attribute, err));
					return false;
				}
			}

			// Settings.attribute.unique check
			if(settings.attributes[attribute].unique) {
				if(!this.validateEntryUnique(collection, attribute, entry[attribute])) {
					this.handleError(new EntryValidationFailedError(
						collection, attribute, 'unique', true, entry[attribute]));
					return false;
				}
			}
		}

		// All validations passed, entry ready for insertion.
		return true;
	}

	/** Compare an entry to a collection settings, and ensure it either is permissible by all constraints, and/or
	 * is matching collection settings to be added. This method is for validating entry updates, and will provide
	 * difference results if used to strictly validation of entry insertion.
	 * 
	 * @param {string} collection - The name of the collection
	 * @param {object} entry - The entry to be added to collection
	 * @param {object} settings - The settings object
	 * @returns {boolean} - Result of validation against collection settings 
	 */
	validateEntryUpdate(collection, entry, settings) {
		// Collection wide checks
		const entryKeys = Object.keys(entry);

		// Settings.allowExtraAttributes check
		if(!settings.allowExtraAttributes) {
			const originalEntry = this.getEntry(collection, entry._id);

			const originalEntryKeys = Object.keys(originalEntry);
			for(const key of entryKeys) {
				if(originalEntryKeys.includes(key)) continue;

				if(settings.autofillAttributes) {
					delete entry[key];
					continue;
				}
				
				this.handleError(new EntryValidationFailedError(
					collection, key, 'allowExtraAttributes', false, 'Cannot add attribute'));
					
				return false;
			}
		}		

		// Settings.attributeLock check
		if(settings.attributeLock) {
			const entryStructure = Object.keys(settings.attributes);
			entryStructure.push( ... ['_id', '_createdOn', '_updatedOn']);
			console.log(entryStructure);
			var invalidKeys = [];

			for(const key of entryKeys) {
				if(entryStructure.includes(key)) continue;
				invalidKeys.push(key);
			}

			if(invalidKeys.length > 0) {
				if(settings.autofillAttributes) {
					for(const key of invalidKeys) {
						console.log(key);
						delete entry[key];
					}
				}else {
					this.handleError(new EntryValidationFailedError(
						collection, invalidKeys.toString(), 'attributeLock', true, 'Cannot add attribute'));
					
					return false;
				}
			}
		}

		// Handle attribute individual settings
		const attributesList = Object.keys(settings.attributes);
		for(const attribute of attributesList) {
			if(!entry.hasOwnProperty(attribute)) continue;

			// settings.attributes.immutable check
			if(settings.attributes[attribute].immutable) {
				if(settings.autofillAttributes) {
					delete entry[attribute];
					continue;
				} else {
					this.handleError(new EntryValidationFailedError(
						collection, attribute, 'immutable', true, 'Cannot change this attribute'));
					return false;
				}
			}
			
			// Settings.attribute.required check
			if(settings.attributes[attribute].required) {
				if(entry[attribute] === undefined) {
					if(settings.autofillAttributes) {
						Object.defineProperty(entry, attribute, {
							value: settings.attributes[attribute].autofillValue,
							enumerable: true,
							writable: true,
						});
						continue;
					} else {
						this.handleError(new EntryValidationFailedError(
							collection, attribute, 'required', true, 'Attempting to delete required attribute'));
						return false;
					}
				}
			}

			// settings.attributes.enum check
			if(settings.attributes[attribute].enum !== false) {
				if(settings.attributes[attribute].enum.length !== 0) {
					if(!settings.attributes[attribute].enum.includes(entry[attribute])) {
						this.handleError(new EntryValidationFailedError(
							collection, attribute, 'enum', settings.attributes[attribute].enum, entry[attribute]));
						return false;
					} else {
						continue;
					}
				}
			}

			// settings.attributes.outlier check
			if(settings.attributes[attribute].outlier !== false) {
				if(settings.attributes[attribute].outlier.length !== 0) {
					if(settings.attributes[attribute].outlier.includes(entry[attribute])) {
						continue;
					}
				}
			}

			// settings.attributes.datatype check
			const attributeDatatype = this.getAttributeDataType(entry[attribute]);
			if(settings.attributes[attribute].dataType !== false) {
				if(attributeDatatype !== settings.attributes[attribute].dataType) {
					this.handleError(new EntryValidationFailedError(
						collection, attribute, 'dataType', settings.attributes[attribute].dataType, attributeDatatype));
					return false;
				}
			}

			// settings.attributes.permitNull check
			if(!settings.attributes[attribute].permitNull) {
				if(attributeDatatype === 'null') {
					this.handleError(new EntryValidationFailedError(
						collection, attribute, 'permitNull', false, 'null'));
					return false;
				}
			}

			// settings.attributes.domain check
			if(attributeDatatype === 'number' && settings.attributes[attribute].domain !== false) {
				const entryVal = entry[attribute];
				const lower = settings.attributes[attribute].domain.lower || -Infinity;
				const upper = settings.attributes[attribute].domain.upper || Infinity;

				if(entryVal<lower || entryVal > upper) {
					this.handleError(new EntryValidationFailedError(
						collection, attribute, 'domain', settings.attributes[attribute].domain, entry[attribute]));
					return false;
				}
			}

			// settings.attributes.pattern check 
			if(attributeDatatype === 'string' && settings.attributes[attribute].pattern !== false) {
				const entryVal = entry[attribute];
				const expression = new RegExp(settings.attributes[attribute].pattern);

				if(!expression.test(entryVal)) {
					this.handleError(new EntryValidationFailedError(
						collection, attribute, 'pattern', settings.attributes[attribute].pattern, entry[attribute]));
					return false;
				}
			}

			// settings.attribute.validator check
			if(settings.attributes[attribute].validator !== false) {
				try{
					if(settings.attributes[attribute].validator(entry[attribute]) !== true) {
						this.handleError(new EntryValidationFailedError(
							collection, attribute, 'validator', settings.attributes[attribute].validator, entry[attribute]));
						return false;
					}
				} catch(err) {
					this.handleError(new ValidatorFunctionError(collection, attribute, err));
					return false;
				}
			}

			// Settings.attribute.unique check
			if(settings.attributes[attribute].unique) {
				if(!this.validateEntryUnique(collection, attribute, entry[attribute])) {
					this.handleError(new EntryValidationFailedError(
						collection, attribute, 'unique', true, entry[attribute]));
					return false;
				}
			}
		}

		console.log(entry);

		// All validations passed, entry ready for insertion.
		return true;
	}

	/** Check all values in collection of same attribute for uniqueness. Return true if unique, false otherwise.
	 * 
	 * This method utilizes indexing when applicable, otherwise brute force query approaches. This method is
	 * equivalent to the query below.
	 * 
	 * @example
	 * { attribute: {$eq: value}}
	 * 
	 * @param {string} collection - The name of the collection
	 * @param {string} attribute - The attribute to compare
	 * @param {any} value - The value to check for
	 * @returns {boolean} - Result of validation
	 */
	validateEntryUnique(collection, attribute, value) {
		// Indexed query
		if(this.meta.collections[collection].indexed.includes(attribute)) {
			this.logger.log(`Equal to for indexed at ${attribute}, V: ${value}`);
			const tree = new BPlusTree(this.getIndexPath(collection, attribute));

			if(tree.search(value) === null) return true;
			return false;
		}

		// Non-indexed query
		var entryCount = this.getCollectionSize(collection);

		for (let i = 0; i < entryCount; i++) {
			const entry = this.getEntry(collection, i);

			if (entry === null) continue;

			if(entry[attribute] === value) return false;
		}

		return true;

	}

	/* -------------------------------------------------------------------------- */
	/*                            Query Related Methods                           */
	/* -------------------------------------------------------------------------- */

	/*
	* Zani Query flow/breakdown
		- Given an query, split into indexed and non-indexed attributes
		- Process both in parallel, excluding logical operators ($and/$or, etc.)
			For Indexed:
				- Use indexes to narrow search to matching values only
				- Query based (For each condition in indexed query, check appropriate entries based on indexes)
			For non-indexed
				- For each entry, run the query. Before each query condition, check that entry has attribute,
					otherwise, continue
				- Check all entries in collection
			For both
				- Result entries are added to a results object that matches the query, storing all entries
					that pass each condition at condition instead of value. Stores their ids
					IE {value: 5} in results equal {value: set(entry1, entry2, ...)}
		- Conduct logical operators based on result objects (1 per indexed/non-indexed queries)
		- TODO Group by(?) cases
		- Read entries into results set
		- Projection
		- Sorting
	*/

	/** Perform a query operation on the collection provided. This option of query is slow, and will search
	 * each entry in the collection for each condition. This method is best used for indexing.
	 *
	 * @param {string} collection - The name of the collection to search
	 * @param {object=} query - The query/Search condition object
	 * @param {object=} project - The projection object
	 * @param {object=} sort - The sort object
	 * @returns {object[]} The results of the query
	 */
	async find(collection, query, project, sort) {
		this.logger.log(`Starting query of ${collection}`);
		this.emitter.emit('query_Progress', 'Query Started');
		
		const start = Date.now();

		// Check if system is ready
		if (!this.checkForCollection(collection, 'find')) {
			this.emitter.emit('query_Progress', 'Canceled');
			return;
		}

		var results = [];
		var queries = { indexed: {}, notIndexed: {}, depth: [] };

		// Build 2 query objects, one for the indexed values and one for the non-indexed values
		
		this.emitter.emit('query_Progress', 'Building Query');
		if (!query) {
			results = this.getCollection(collection);
		} else {
			var queryResults = this.buildQueries(collection, query, queries);
			if (Object.keys(queryResults.indexed).length !== 0) {
				queries.indexed = queryResults.indexed;
			}
			if (Object.keys(queryResults.notIndexed).length !== 0) {
				queries.notIndexed = queryResults.notIndexed;
			}
		}

		/* 
		Two queries in parallel, replace the query object 'conditions' with the results
		Do $and, $not, $or here by referencing the two since they share the same structure
		and attributes if they are unique like that. 
		
		Example:
			Criteria:
			{ value: { '$lt': 100 }, '$and': { value: 4, not: 3 } }

			Query - Indexed
			{ value: { '$lt': 100 }, '$and': { value: 4 } }

			Query - Not Indexed
			{ '$and': { not: 3 } }
		
		If I can cycle through query, and use its structure as the outline to rebuild the queries into one and
		then solve any logic here, then it should be accurate to the desired result. 

		If on the above, key=$and (as defined by criteria), and call it on both objects (after checking its present),
		i can then do the $and combination, or the $or if it were the key value, without introducing race condition.		
		*/

		// Dispatch queries
		this.emitter.emit('query_Progress', 'Querying Collection');
		const [indexedResults, nonIndexedResults] = await Promise.all([
			this.findFromIndexed(collection, queries.indexed),
			this.findFromNonIndexed(collection, queries.notIndexed),
		]);

		const resultSet = this.findLogical(collection, query, indexedResults, nonIndexedResults);

		// Handle projections prior to reading
		var projections = [];
		//! Only can handle up to depth 1
		if (project) {
			this.emitter.emit('query_Progress', 'Projecting Results');
			// Extract projection keys, and add to array if desired to keep
			Object.getOwnPropertyNames(project).forEach((element) => {
				if (project[element] === 1) {
					projections.push(element);
				}
			});

			// Default return of _id
			if (!project.hasOwnProperty('_id')) projections.push('_id');
		}

		// Build results array		
		this.emitter.emit('query_Progress', 'Reading Entries');

		const entries = await this.batchReadEntries(collection, resultSet, this.options.fileLimit);
		for (const entry in entries) {
			// For projections
			if (projections.length > 0) {
				for (const key in entry) {
					if (!projections.includes(key)) {
						delete entry[key];
					}
				}
			}

			// If it was the last key in element, remove by not adding it to array
			if (Object.keys(entry).length !== 0) results.push(element);
		}

		//! Can only handle up to depth 1
		if (sort) {
			this.emitter.emit('query_Progress', 'Sorting Results');
			results = results.sort((a, b) => {
				for (const key in sort) {
					// Ascending
					if (sort[key] === 1) {
						if (a.hasOwnProperty(key) && b.hasOwnProperty(key)) {
							if (a[key] < b[key]) return -1;
							if (a[key] > b[key]) return 1;
						}
						if (a.hasOwnProperty(key)) return 1;
						if (b.hasOwnProperty(key)) return -1;
					}
					// Descending
					if (a.hasOwnProperty(key) && b.hasOwnProperty(key)) {
						if (a[key] < b[key]) return 1;
						if (a[key] > b[key]) return -1;
					}
					if (a.hasOwnProperty(key)) return -1;
					if (b.hasOwnProperty(key)) return 1;

					return 0;
				}
			});
		}

		// if smart indexing is enabled, check through here.
		if (this.options.smartIndexing) {
		  	this.emitter.emit('query_Progress', 'Smart Indexing Results');
			this.smartIndex(collection, query);

			// Create indexes if needed
			for (const value in this.meta.collections[collection].queryStats) {
				if (this.meta.collections[collection].queryStats[value] === 10) {
					this.createIndex(collection, value);
				}
			}
			this.updateMetaFile();
		}

		const end = Date.now();
		const totalTime = this.calculateTime(start, end);
		this.logger.log(`Query complete in ${totalTime} seconds`, this.databaseName);
		this.emitter.emit('query_Progress', 'Query Complete');
		this.emitter.emit('queryComplete', {
			collection: collection, 
			results: results, 
			databaseName: this.databaseName,
			time: totalTime, 
			query: query
		});
		return results;
	}

	/** Given a query criteria, deconstruct it into two levels based upon indexed attributes. Each level (indexed
	 * and nonIndexed) will be a query unto itself. This method is recursive, and criteria will traversed through
	 * at each level. It returns a query object that is then added to the base-level recursion query object, which
	 * is returned to {@link Zani#find}.
	 *
	 * @param {string} collection - The name of the collection
	 * @param {object} query - The query to deconstruct (recursive)
	 * @param {object} queries - The query object and results of deconstruction of criteria
	 * @returns {object} The deconstructed query.
	 */
	buildQueries(collection, query, queries) {
		for (const key in query) {
			// Flatten key and check if its indexed
			var flattenedKey = this.flattenAttribute([...queries.depth, key]);
			if (this.meta.collections[collection].indexed.includes(flattenedKey)) {
				// Ensure $text searches are always brute forced
				if (query[key].hasOwnProperty('$text') || query[key].hasOwnProperty('$type')) {
					Object.defineProperty(queries.notIndexed, key, {
						value: query[key],
						writable: false,
						enumerable: true,
					});
				} else {
					Object.defineProperty(queries.indexed, key, {
						value: query[key],
						writable: false,
						enumerable: true,
					});
				}
			} else {
				// if attribute value is an object, recursively traverse
				if (typeof query[key] === 'object' && query[key] !== null && !Array.isArray(query[key])) {
					if (key.charAt(0) !== '$') queries.depth.push(key);
					var results = this.buildQueries(collection, query[key], {
						indexed: {},
						notIndexed: {},
						depth: queries.depth,
					});
					if (key.charAt(0) !== '$') queries.depth.pop();
					if (Object.keys(results.indexed).length !== 0) {
						Object.defineProperty(queries.indexed, key, {
							value: results.indexed,
							writable: false,
							enumerable: true,
						});
					}
					if (Object.keys(results.notIndexed).length !== 0) {
						Object.defineProperty(queries.notIndexed, key, {
							value: results.notIndexed,
							writable: false,
							enumerable: true,
						});
					}
					// Non indexed items end up here
				} else {
					Object.defineProperty(queries.notIndexed, key, {
						value: query[key],
						writable: false,
						enumerable: true,
					});
				}
			}
		}

		return queries;
	}

	/** Replace all attributes in an object value field with an empty set. This method is designed to
	 * prepare the results object in a query for the addition of entries that meet their criteria
	 *
	 * @param {object} results - The object to update.
	 */
	prepareResultsObject(results) {
		for (const key in results) {
			if (typeof results[key] !== 'object' || Array.isArray(results[key])) {
				results[key] = new Set();
			} else if (results[key] !== null || results[key] !== undefined) {
				this.prepareResultsObject(results[key]);
			}
		}
	}

	smartIndex(collection, query, depth = []) {
		for (const key in query) {
			if (key.charAt(0) !== '$') depth.push(key);
			var value = query[key];

			if (typeof value === 'object' && !Array.isArray(value))
				this.smartIndex(collection, query[key], depth);
			else {
				const flat = this.flattenAttribute(depth);
				if (this.meta.collections[collection].queryStats.hasOwnProperty(flat))
					this.meta.collections[collection].queryStats[flat]++;
				else {
					Object.defineProperty(this.meta.collections[collection].queryStats, flat, {
						value: 1,
						enumerable: true,
						writable: true,
					});
				}
			}

			if (key.charAt(0) !== '$') depth.pop();
		}
	}

	/** List of query operations and their respective method, split between indexed, non-indexed, and logical
	 * operations variations. When called, it will route to the respective method.
	 */
	queryOperators = {
		$gt: {
			indexed: this.findIndexedGreaterThan.bind(this),
			nonIndexed: this.findNonIndexedGreaterThan.bind(this),
		},
		$gte: {
			indexed: this.findIndexedGreaterThanEqual.bind(this),
			nonIndexed: this.findNonIndexedGreaterThanEqual.bind(this),
		},
		$lt: {
			indexed: this.findIndexedLessThan.bind(this),
			nonIndexed: this.findNonIndexedLessThan.bind(this),
		},
		$lte: {
			indexed: this.findIndexedLessThanEqual.bind(this),
			nonIndexed: this.findNonIndexedLessThanEqual.bind(this),
		},
		$eq: {
			indexed: this.findIndexedEqual.bind(this),
			nonIndexed: this.findNonIndexedEqual.bind(this),
		},
		$ne: {
			indexed: this.findIndexedNotEqual.bind(this),
			nonIndexed: this.findNonIndexedNotEqual.bind(this),
		},
		// TODO add range later for more memory efficient methods?

		$in: {
			indexed: this.findIndexedIn.bind(this),
			nonIndexed: this.findNonIndexedIn.bind(this),
		},
		$nin: {
			indexed: this.findIndexedNotIn.bind(this),
			nonIndexed: this.findNonIndexedNotIn.bind(this),
		},
		$text: {
			nonIndexed: this.findNonIndexedText.bind(this),
		},

		$exists: {
			indexed: this.findIndexedExists.bind(this),
			nonIndexed: this.findNonIndexedExists.bind(this),
		},
		$type: {
			nonIndexed: this.findNonIndexedType.bind(this),
		},

		logical: {
			$and: this.findLogicalAnd.bind(this),
			$or: this.findLogicalOr.bind(this),
			$not: this.findLogicalNot.bind(this),
			$nand: this.findLogicalNand.bind(this),
			$nor: this.findLogicalNor.bind(this),
			$xor: this.findLogicalXor.bind(this),
			$count: this.findCount.bind(this),
		},
	};

	/* ------------------------- Query (Indexed) Methods ------------------------ */

	/** Search a collection by apply a query criteria, and checking all appropriate entries based on file indexes.
	 * All entries that match will be added to their respective results object value, which contains attributes
	 * tracking where each entry passed for later processing within {@link Zani#find}.
	 *
	 * Note: Any files missing from the index attributes will be assumed to be non-existent, or at minimum, lacking
	 * the indexed attribute.
	 *
	 * This method is for indexed queries, and uses a for each criteria, search entries. For non-indexed
	 * attributes, use {@link Zani#findNonIndexed}.
	 *
	 * @param {string} collection - The name of the collection to search
	 * @param {object} query - The criteria to apply to each entry
	 * @returns - The results object.
	 */
	async findFromIndexed(collection, query) {
		this.logger.log(`Starting indexed query of ${collection}`, this.databaseName);
		const start = Date.now();
		var results = structuredClone(query);
		this.prepareResultsObject(results);

		if (Object.getOwnPropertyNames(query).length != 0)
			this.findFromIndexedRouter(collection, query, results);

		const end = Date.now();
		const total = (end - start) / 1000;
		this.logger.log(
			`Indexed query of ${collection} complete in ${total} seconds.`,
			this.databaseName,
		);
		return results;
	}

	/** Given a criteria, route all queries to proper method and construct the results object. This method is
	 * called from and will return to {@link Zani#findIndexed}. This method is recursive and will be called
	 * for every $queryOperator or nested object within the query.
	 *
	 * @see {@link Zani#find}
	 * @see {@link Zani#findIndexed}
	 *
	 * @param {string} collection - The collection to search
	 * @param {any} query - The value of the entry to compare to
	 * @param {object} results - The results storage object, which any matching entries will be added to.
	 * @param {object} depth - The variable tracking the current object depth, and attribute path (unflattened)
	 *
	 * @returns {object[]}
	 */
	findFromIndexedRouter(collection, query, results, depth = { entry: [], query: [] }) {
		for (const key in query) {
			if (key.charAt(0) !== '$') depth.entry.push(key);
			depth.query.push(key);

			let attributeValue = this.getAttributeDataType(query[key]);

			if (attributeValue === 'object') {
				this.findFromIndexedRouter(collection, query[key], results, depth);
			} else if (key.charAt(0) === '$' && !this.queryOperators.logical.hasOwnProperty(key)) {
				this.queryOperators[key].indexed(collection, query[key], results, depth);
			} else if (attributeValue !== null && attributeValue !== undefined) {
				this.findIndexedEqual(collection, query[key], results, depth);
			}

			if (key.charAt(0) !== '$') depth.entry.pop();
			depth.query.pop();
		}
	}

	/** Greater than ($gt) search for indexed attributes/collections.
	 *
	 * Search the entry provided for values greater than the query's value, based on indexed values.
	 * This method should only be called from the indexed router method {@link Zani#findIndexedRouter}.
	 *
	 * See query documentation for usage.
	 *
	 * @example
	 * query: {value: {$gt: 3}}
	 * results: any entry with attribute value greater than, but not including, 3.
	 *
	 * @see {@link Zani#findIndexed}
	 * @see {@link Zani#findIndexedRouter}
	 *
	 * @param {string} collection - The name of the collection to search
	 * @param {any} query - The value of the entry to compare to
	 * @param {object} entry - The entry to check for fitting values
	 * @param {object} results - The results storage object, which any matching entries will be added to.
	 */
	findIndexedGreaterThan(collection, query, results, depth) {
		this.logger.log(`Greater than for indexed at ${depth.entry}, Q: ${query}`);
		const tree = new BPlusTree(this.getIndexPath(collection, depth.entry));
		const max = tree.getMaxValue();

		if (max <= query) return;

		this.pushToAttributeSet(results, depth.query, tree.getRange(query + 1, max));

		return;
	}

	/** Greater than or equal to ($gte) search for indexed attributes/collections.
	 *
	 * Search the entry provided for values greater than or equal to the query's value, based on indexed values.
	 * This method should only be called from the indexed router method {@link Zani#findIndexedRouter}.
	 *
	 * See query documentation for usage.
	 *
	 * @example
	 * query: {value: {$gte: 3}}
	 * results: any entry with attribute value greater than or equal to 3.
	 *
	 * @see {@link Zani#findIndexed}
	 * @see {@link Zani#findIndexedRouter}
	 *
	 * @param {string} collection - The name of the collection to search
	 * @param {any} query - The value of the entry to compare to
	 * @param {object} entry - The entry to check for fitting values
	 * @param {object} results - The results storage object, which any matching entries will be added to.
	 */
	findIndexedGreaterThanEqual(collection, query, results, depth) {
		this.logger.log(`Greater than equal to for indexed at ${depth.entry}, Q: ${query}`);
		const tree = new BPlusTree(this.getIndexPath(collection, depth.entry));
		const max = tree.getMaxValue();

		if (max < query) return;

		this.pushToAttributeSet(results, depth.query, tree.getRange(query, max));

		return;
	}

	/** Less than ($lt) search for indexed attributes/collections.
	 *
	 * Search the entry provided for values less than the query's value, based on indexed values.
	 * This method should only be called from the indexed router method {@link Zani#findIndexedRouter}.
	 *
	 * See query documentation for usage.
	 *
	 * @example
	 * query: {value: {$lt: 3}}
	 * results: any entry with attribute value less than, but not including, 3.
	 *
	 * @see {@link Zani#findIndexed}
	 * @see {@link Zani#findIndexedRouter}
	 *
	 * @param {string} collection - The name of the collection to search
	 * @param {any} query - The value of the entry to compare to
	 * @param {object} entry - The entry to check for fitting values
	 * @param {object} results - The results storage object, which any matching entries will be added to.
	 */
	findIndexedLessThan(collection, query, results, depth) {
		this.logger.log(`Less than for indexed at ${depth.entry}, Q: ${query}`);
		const tree = new BPlusTree(this.getIndexPath(collection, depth.entry));
		const min = tree.getMinValue();

		if (min >= query) return;

		this.pushToAttributeSet(results, depth.query, tree.getRange(min, query - 1));

		return;
	}

	/** Less than equal to ($lte) search for indexed attributes/collections.
	 *
	 * Search the entry provided for values less than or equal to the query's value, based on indexed values.
	 * This method should only be called from the indexed router method {@link Zani#findIndexedRouter}.
	 *
	 * See query documentation for usage.
	 *
	 * @example
	 * query: {value: {$lte: 3}}
	 * results: any entry with attribute value less than, or equal to, 3.
	 *
	 * @see {@link Zani#findIndexed}
	 * @see {@link Zani#findIndexedRouter}
	 *
	 * @param {string} collection - The name of the collection to search
	 * @param {any} query - The value of the entry to compare to
	 * @param {object} entry - The entry to check for fitting values
	 * @param {object} results - The results storage object, which any matching entries will be added to.
	 */
	findIndexedLessThanEqual(collection, query, results, depth) {
		this.logger.log(`Less than equal to for indexed at ${depth.entry}, Q: ${query}`);
		const tree = new BPlusTree(this.getIndexPath(collection, depth.entry));
		const min = tree.getMinValue();

		if (min > query) return;

		this.pushToAttributeSet(results, depth.query, tree.getRange(min, query));

		return;
	}

	/** Equal to ($eq) search for indexed attributes/collections.
	 *
	 * Search the entry provided for values equal to the query's value, based on indexed values.
	 * This method should only be called from the indexed router method {@link Zani#findIndexedRouter}.
	 *
	 * See query documentation for usage.
	 *
	 * @example
	 * query: {value: {$eq: 3}} OR {value: 3}
	 * results: any entry with attribute value equal to 3.
	 *
	 * @see {@link Zani#findIndexed}
	 * @see {@link Zani#findIndexedRouter}
	 *
	 * @param {string} collection - The name of the collection to search
	 * @param {any} query - The value of the entry to compare to
	 * @param {object} entry - The entry to check for fitting values
	 * @param {object} results - The results storage object, which any matching entries will be added to.
	 */
	findIndexedEqual(collection, query, results, depth) {
		this.logger.log(`Equal to for indexed at ${depth.entry}, Q: ${query}`);
		const tree = new BPlusTree(this.getIndexPath(collection, depth.entry));

		this.pushToAttributeSet(results, depth.query, tree.search(query));

		return;
	}

	/** Not Equal to ($ne) search for indexed attributes/collections.
	 *
	 * Search the entry provided for values not equal to the query's value, based on indexed values.
	 * This method should only be called from the indexed router method {@link Zani#findIndexedRouter}.
	 *
	 * See query documentation for usage.
	 *
	 * @example
	 * query: {value: {$ne: 3}}
	 * results: any entry with attribute value not equal to 3.
	 *
	 * @see {@link Zani#findIndexed}
	 * @see {@link Zani#findIndexedRouter}
	 *
	 * @param {string} collection - The name of the collection to search
	 * @param {any} query - The value of the entry to compare to
	 * @param {object} entry - The entry to check for fitting values
	 * @param {object} results - The results storage object, which any matching entries will be added to.
	 */
	findIndexedNotEqual(collection, query, results, depth) {
		this.logger.log(`Not Equal to for indexed at ${depth.entry}, Q: ${query}`);
		const tree = new BPlusTree(this.getIndexPath(collection, depth.entry));

		var validIndexes = new Set(tree.getRange(-Infinity, Infinity));
		var invalidIndexes = new Set(tree.search(query));
		var resultIndexes = this.setDifference(validIndexes, invalidIndexes);

		this.pushToAttributeSet(results, depth.query, [...resultIndexes]);

		return;
	}

	/** In ($in) search for indexed attributes/collections.
	 *
	 * Search the entry provided for values contained within query's array of values, based on indexed values.
	 * This method should only be called from the indexed router method {@link Zani#findIndexedRouter}..
	 *
	 * See query documentation for usage.
	 *
	 * @example
	 * query: {value: {$in: [2, 3, 5]}}
	 * results: any entry with attribute value 2, 3, or 5.
	 *
	 * @see {@link Zani#findIndexed}
	 * @see {@link Zani#findIndexedRouter}
	 *
	 * @param {string} collection - The name of the collection to search
	 * @param {any} query - The value of the entry to compare to
	 * @param {object} entry - The entry to check for fitting values
	 * @param {object} results - The results storage object, which any matching entries will be added to.
	 */
	findIndexedIn(collection, query, results, depth) {
		this.logger.log(`In for indexed at ${depth.entry}, Q: ${query}`);
		const tree = new BPlusTree(this.getIndexPath(collection, depth.entry));

		var resultIndexes = [];
		for (const element of query) {
			resultIndexes.push(...tree.search(element));
		}

		this.pushToAttributeSet(results, depth.query, resultIndexes);

		return;
	}

	/** Not In ($nin) search for indexed attributes/collections.
	 *
	 * Search the entry provided for values not contained within query's array of values, based on indexed values.
	 * This method should only be called from the indexed router method {@link Zani#findIndexedRouter}..
	 *
	 * See query documentation for usage.
	 *
	 * @example
	 * query: {value: {$nin: [2, 3, 5]}}
	 * results: any entry with attribute value not equal to 2, 3, or 5.
	 *
	 * @see {@link Zani#findIndexed}
	 * @see {@link Zani#findIndexedRouter}
	 *
	 * @param {string} collection - The name of the collection to search
	 * @param {any} query - The value of the entry to compare to
	 * @param {object} entry - The entry to check for fitting values
	 * @param {object} results - The results storage object, which any matching entries will be added to.
	 */
	findIndexedNotIn(collection, query, results, depth) {
		this.logger.log(`Not in for indexed at ${depth.entry}, Q: ${query}`);
		const tree = new BPlusTree(this.getIndexPath(collection, depth.entry));

		var validIndexes = new Set(tree.getRange(-Infinity, Infinity));
		var invalidIndexes = [];

		for (const element of query) {
			invalidIndexes.push(...tree.search(element));
		}

		var resultIndexes = this.setDifference(validIndexes, new Set(invalidIndexes));

		this.pushToAttributeSet(results, depth.query, [...resultIndexes]);

		return;
	}

	/** Exists ($exists) search for indexed attributes/collections.
	 *
	 * Search the entry provided for an attributes presence, based on indexed values.
	 * This method should only be called from the indexed router method {@link Zani#findIndexedRouter}.
	 *
	 * See query documentation for usage.
	 *
	 * @example
	 * query: {value: {$exists: true}
	 * results: any entry with attribute value
	 *
	 * @see {@link Zani#findIndexed}
	 * @see {@link Zani#findIndexedRouter}
	 *
	 * @param {string} collection - The name of the collection to search
	 * @param {any} query - The value of the entry to compare to
	 * @param {object} entry - The entry to check for fitting values
	 * @param {object} results - The results storage object, which any matching entries will be added to.
	 */
	findIndexedExists(collection, query, results, depth) {
		this.logger.log(`Exists for indexed at ${depth.entry}, Q: ${query}`);
		const tree = new BPlusTree(this.getIndexPath(collection, depth.entry));

		var resultIndexes = new Set();
		if (query) {
			resultIndexes = new Set(tree.getRange(-Infinity, Infinity));
		} else {
			var validIndexes = new Set(tree.getRange(-Infinity, Infinity));
			var collectionSize = this.getCollectionSize(collection);

			for (let i = 0; i < collectionSize; i++) {
				if (validIndexes.has(i)) continue;
				if (this.meta.collections[collection].availableIDs.includes(i)) continue;

				resultIndexes.add(i);
			}
		}

		this.pushToAttributeSet(results, depth.query, [...resultIndexes]);

		return;
	}

	/* ----------------------- Query (Non-Indexed) Methods ---------------------- */

	/** Search a collection, entry by entry, and apply a query criteria to each. All entries that match
	 * will be added to their respective results object value, which contains attributes tracking where each
	 * entry passed for later processing within {@link Zani#find}.
	 *
	 * This method is for non-indexed queries, which follows a for each entry, apply the entire criteria. For indexed
	 * attributes, use {@link Zani#findIndexed}.
	 *
	 * @param {string} collection - The name of the collection to search
	 * @param {object} query - The criteria to apply to each entry
	 * @returns - The results object.
	 */
	async findFromNonIndexed(collection, query) {
		this.logger.log(`Starting non-indexed query of ${collection}`, this.databaseName);
		const start = Date.now();
		var results = structuredClone(query);
		this.prepareResultsObject(results);

		if (Object.getOwnPropertyNames(query).length != 0) {
			// Cycle through each entry, and compare to the query
			var entryCount = this.getCollectionSize(collection);
			const ids = [];
			for (let i = 0; i < entryCount; i++) {
				ids.push(i);
			}

			const entries = await this.batchReadEntries(collection, ids, this.options.fileLimit);
			for (const entry of entries) {
				if (entry === null) continue;

				this.findFromNonIndexedRouter(query, entry, results);
			}
		}

		const end = Date.now();
		const total = (end - start) / 1000;

		this.logger.log(
			`Non-indexed query of ${collection} complete in ${total} seconds`,
			this.databaseName,
		);
		return results;
	}

	/** Given a criteria, route all queries to proper method and construct the results object. This method is
	 * called from and will return to {@link Zani#findNonIndexed}. This method is recursive and will be called
	 * for every $queryOperator or nested object within the entry. This method also runs once for every entry,
	 * and applies the criteria to each attribute.
	 *
	 * @see {@link Zani#find}
	 * @see {@link Zani#findNonIndexed}
	 *
	 * @param {any} query - The value of the entry to compare to
	 * @param {object} entry - The entry to check for fitting values
	 * @param {object} results - The results storage object, which any matching entries will be added to.
	 * @param {object} depth - The variable tracking the current object depth, and attribute path (unflattened)
	 *
	 * @returns {object[]}
	 */
	findFromNonIndexedRouter(query, entry, results, depth = { entry: [], query: [] }) {
		for (const key in query) {
			if (key === '_id') continue;
			if (key.charAt(0) !== '$') {
				if (!this.objectHasAttribute(entry, [...depth.entry, key])) continue;
				depth.entry.push(key);
			}
			depth.query.push(key);

			let attributeValue = this.getAttributeDataType(query[key]);

			if (attributeValue === 'object') {
				this.findFromNonIndexedRouter(query[key], entry, results, depth);
			} else if (key.charAt(0) === '$' && !this.queryOperators.logical.hasOwnProperty(key)) {
				this.queryOperators[key].nonIndexed(query[key], entry, results, depth);
			} else if (attributeValue !== null && attributeValue !== undefined) {
				this.findNonIndexedEqual(query[key], entry, results, depth);
			}

			if (key.charAt(0) !== '$') depth.entry.pop();
			depth.query.pop();
		}
	}

	/** Greater than ($gt) search for non-indexed attributes/collections.
	 *
	 * Search the entry provided for values greater than the query's value. This method should only be called
	 * from the non-indexed router method {@link Zani#findNonIndexedRouter}.
	 *
	 * See query documentation for usage.
	 *
	 * @example
	 * query: {value: {$gt: 3}}
	 * results: any entry with attribute value greater than, but not including, 3.
	 *
	 * @see {@link Zani#findNonIndexed}
	 * @see {@link Zani#findNonIndexedRouter}
	 *
	 * @param {any} query - The value of the entry to compare to
	 * @param {object} entry - The entry to check for fitting values
	 * @param {object} results - The results storage object, which any matching entries will be added to.
	 */
	findNonIndexedGreaterThan(query, entry, results, depth) {
		// this.logger.log(
		// 	`Greater than for non-indexed at ${depth.entry}, Q:${query} - E._id:${entry._id}`,
		// );

		const value = this.getObjectAttribute(entry, depth.entry);
		if (query < value) {
			this.pushToAttributeSet(results, depth.query, entry._id);
		}
	}

	/** Greater than or equal to ($gte) search for non-indexed attributes/collections.
	 *
	 * Search the entry provided for values greater than or equal to the query's value. This method
	 * should only be called from the non-indexed router method {@link Zani#findNonIndexedRouter}.
	 *
	 * See query documentation for usage.
	 *
	 * @example
	 * query: {value: {$gte: 3}}
	 * results: any entry with attribute value greater than or equal to 3.
	 *
	 * @see {@link Zani#findNonIndexed}
	 * @see {@link Zani#findNonIndexedRouter}
	 *
	 * @param {any} query - The value of the entry to compare to
	 * @param {object} entry - The entry to check for fitting values
	 * @param {object} results - The results storage object, which any matching entries will be added to.
	 */
	findNonIndexedGreaterThanEqual(query, entry, results, depth) {
		this.logger.log(
			`Greater than equal to for non-indexed at ${depth.entry}, Q:${query} - E._id:${entry._id}`,
		);

		const value = this.getObjectAttribute(entry, depth.entry);
		if (query <= value) {
			this.pushToAttributeSet(results, depth.query, entry._id);
		}
	}

	/** Less than ($lt) search for non-indexed attributes/collections.
	 *
	 * Search the entry provided for values less than the query's value. This method should only be called
	 * from the non-indexed router method {@link Zani#findNonIndexedRouter}.
	 *
	 * See query documentation for usage.
	 *
	 * @example
	 * query: {value: {$lt: 3}}
	 * results: any entry with attribute value less than, but not including, 3.
	 *
	 * @see {@link Zani#findNonIndexed}
	 * @see {@link Zani#findNonIndexedRouter}
	 *
	 * @param {any} query - The value of the entry to compare to
	 * @param {object} entry - The entry to check for fitting values
	 * @param {object} results - The results storage object, which any matching entries will be added to.
	 */
	findNonIndexedLessThan(query, entry, results, depth) {
		this.logger.log(`Less than for non-indexed at ${depth.entry}, Q:${query} - E._id:${entry._id}`);

		const value = this.getObjectAttribute(entry, depth.entry);
		if (query > value) {
			this.pushToAttributeSet(results, depth.query, entry._id);
		}
	}

	/** Less than or equal to ($lte) search for non-indexed attributes/collections.
	 *
	 * Search the entry provided for values less than or equal to the query's value. This method
	 * should only be called from the non-indexed router method {@link Zani#findNonIndexedRouter}.
	 *
	 * See query documentation for usage.
	 *
	 * @example
	 * query: {value: {$lte: 3}}
	 * results: any entry with attribute value less than or equal to 3.
	 *
	 * @see {@link Zani#findNonIndexed}
	 * @see {@link Zani#findNonIndexedRouter}
	 *
	 * @param {any} query - The value of the entry to compare to
	 * @param {object} entry - The entry to check for fitting values
	 * @param {object} results - The results storage object, which any matching entries will be added to.
	 */
	findNonIndexedLessThanEqual(query, entry, results, depth) {
		// this.logger.log(
		// 	`Less than equal to for non-indexed at ${depth.entry}, Q:${query} - E._id:${entry._id}`,
		// );

		const value = this.getObjectAttribute(entry, depth.entry);
		if (query >= value) {
			this.pushToAttributeSet(results, depth.query, entry._id);
		}
	}

	/** Equal to ($eq) search for non-indexed attributes/collections.
	 *
	 * Search the entry provided for values equal to the query's value. This method
	 * should only be called from the non-indexed router method {@link Zani#findNonIndexedRouter}.
	 *
	 * See query documentation for usage.
	 *
	 * @example
	 * query: {value: {$eq: 3}} OR {value: 3}
	 * results: any entry with attribute value equal to 3.
	 *
	 * @see {@link Zani#findNonIndexed}
	 * @see {@link Zani#findNonIndexedRouter}
	 *
	 * @param {any} query - The value of the entry to compare to
	 * @param {object} entry - The entry to check for fitting values
	 * @param {object} results - The results storage object, which any matching entries will be added to.
	 */
	findNonIndexedEqual(query, entry, results, depth) {
		this.logger.log(`Equal for non-indexed at ${depth.entry}, Q:${query} - E._id:${entry._id}`);

		const value = this.getObjectAttribute(entry, depth.entry);
		if (query === value) {
			this.pushToAttributeSet(results, depth.query, entry._id);
		}
	}

	/** Not Equal to ($ne) search for non-indexed attributes/collections.
	 *
	 * Search the entry provided for values not equal to the query's value. This method
	 * should only be called from the non-indexed router method {@link Zani#findNonIndexedRouter}.
	 *
	 * See query documentation for usage.
	 *
	 * @example
	 * query: {value: {$ne: 3}}
	 * results: any entry with attribute value not equal to 3.
	 *
	 * @see {@link Zani#findNonIndexed}
	 * @see {@link Zani#findNonIndexedRouter}
	 *
	 * @param {any} query - The value of the entry to compare to
	 * @param {object} entry - The entry to check for fitting values
	 * @param {object} results - The results storage object, which any matching entries will be added to.
	 */
	findNonIndexedNotEqual(query, entry, results, depth) {
		this.logger.log(`Not Equal for non-indexed at ${depth.entry}, Q:${query} - E._id:${entry._id}`);

		const value = this.getObjectAttribute(entry, depth.entry);
		if (query !== value) {
			this.pushToAttributeSet(results, depth.query, entry._id);
		}
	}

	/** In ($in) search for non-indexed attributes/collections.
	 *
	 * Search the entry provided for values contained within query's array of values. This method
	 * should only be called from the non-indexed router method {@link Zani#findNonIndexedRouter}.
	 *
	 * See query documentation for usage.
	 *
	 * @example
	 * query: {value: {$in: [2, 3, 5]}}
	 * results: any entry with attribute value 2, 3, or 5.
	 *
	 * @see {@link Zani#findNonIndexed}
	 * @see {@link Zani#findNonIndexedRouter}
	 *
	 * @param {any} query - The value of the entry to compare to
	 * @param {object} entry - The entry to check for fitting values
	 * @param {object} results - The results storage object, which any matching entries will be added to.
	 */
	findNonIndexedIn(query, entry, results, depth) {
		this.logger.log(`Find in for non-indexed at ${depth.entry}, Q:${query} - E._id:${entry._id}`);

		const value = this.getObjectAttribute(entry, depth.entry);
		if (query.includes(value)) {
			this.pushToAttributeSet(results, depth.query, entry._id);
		}
	}

	/** Not In ($nin) search for non-indexed attributes/collections.
	 *
	 * Search the entry provided for values not contained within query's array of values. This method
	 * should only be called from the non-indexed router method {@link Zani#findNonIndexedRouter}.
	 *
	 * See query documentation for usage.
	 *
	 * @example
	 * query: {value: {$nin: [2, 3, 5]}}
	 * results: any entry with attribute value not equal to 2, 3, or 5.
	 *
	 * @see {@link Zani#findNonIndexed}
	 * @see {@link Zani#findNonIndexedRouter}
	 *
	 * @param {any} query - The value of the entry to compare to
	 * @param {object} entry - The entry to check for fitting values
	 * @param {object} results - The results storage object, which any matching entries will be added to.
	 */
	findNonIndexedNotIn(query, entry, results, depth) {
		this.logger.log(
			`Find not in for non-indexed at ${depth.entry}, Q:${query} - E._id:${entry._id}`,
		);

		const value = this.getObjectAttribute(entry, depth.entry);
		if (!query.includes(value)) {
			this.pushToAttributeSet(results, depth.query, entry._id);
		}
	}

	/** Text ($text) search for non-indexed attributes/collections.
	 *
	 * Search the entry provided for values equal to, or matching the criteria of, the queries value. This method
	 * should only be called from the non-indexed router method {@link Zani#findNonIndexedRouter}.
	 *
	 * See query documentation for usage.
	 *
	 * @example
	 * query: {value: {$text: "%example_query%"}}
	 * results: any entry with attribute value containing the phrase "example" and "query" with a single character
	 * separation between them.
	 *
	 * @see {@link Zani#findNonIndexed}
	 * @see {@link Zani#findNonIndexedRouter}
	 *
	 * @param {any} query - The value of the entry to compare to
	 * @param {object} entry - The entry to check for fitting values
	 * @param {object} results - The results storage object, which any matching entries will be added to.
	 */
	//? This appears to work perfectly, but it cannot consider spaces for some reason
	findNonIndexedText(query, entry, results, depth) {
		this.logger.log(`Find Text for non-indexed at ${depth.entry}, Q:${query} - E:${entry}`);

		// Build search object criteria
		var value = this.getObjectAttribute(entry, depth.entry);
		if (typeof value !== 'string') return;

		let search = [];

		let firstChar = query.charAt(0);
		let lastChar = query.charAt(value.length - 1);

		// In case first character is to be searched for
		if (firstChar !== '_' && firstChar !== '%') search.push(0);

		while (query.length > 0) {
			if (query.charAt(0) === '%') {
				let nextPercent = query.indexOf('%', 1);
				let nextUnderscore = query.indexOf('_', 1);

				// Avoid -1 for non-existent in string
				if (nextPercent < 0) nextPercent = Infinity;
				if (nextUnderscore < 0) nextUnderscore = Infinity;

				if (nextPercent < nextUnderscore) {
					search.push(query.substring(1, nextPercent));
					query = query.substring(nextPercent, query.length);
					continue;
				}

				if (nextUnderscore < nextPercent) {
					search.push(query.substring(1, nextUnderscore));
					query = query.substring(nextUnderscore, query.length);

					let count = 0;
					for (let i = 0; i < query.length; i++) {
						if (query.charAt(i) === '_') count++;
						else break;
					}

					search.push(count);
					query = query.substring(count, query.length);
					continue;
				}

				if (query.length > 1) search.push(query.substring(1, query.length));
				break;
			}
			if (query.charAt(0) === '_') {
				let count = 0;
				for (let i = 0; i < query.length; i++) {
					if (query.charAt(i) === '_') count++;
					else break;
				}
				search.push(count);
				query = query.substring(count, query.length);

				let nextPercent = query.indexOf('%', 1);
				let nextUnderscore = query.indexOf('_', 1);

				// Avoid -1 for non-existent in string
				if (nextPercent < 0) nextPercent = Infinity;
				if (nextUnderscore < 0) nextUnderscore = Infinity;

				if (nextPercent < nextUnderscore) {
					search.push(query.substring(0, nextPercent));
					query = query.substring(nextPercent, query.length);
					continue;
				}

				if (nextUnderscore < nextPercent) {
					search.push(query.substring(0, nextUnderscore));
					query = query.substring(nextUnderscore, query.length);

					let count = 0;
					for (let i = 0; i < query.length; i++) {
						if (query.charAt(i) === '_') count++;
						else break;
					}

					search.push(count);

					query = query.substring(count, query.length);
					continue;
				}

				if (query.length > 1) search.push(query);
				break;
			}

			let nextPercent = query.indexOf('%', 1);
			let nextUnderscore = query.indexOf('_', 1);

			// Avoid -1 for non-existent in string
			if (nextPercent < 0) nextPercent = Infinity;
			if (nextUnderscore < 0) nextUnderscore = Infinity;

			if (nextPercent < nextUnderscore) {
				search.push(query.substring(0, nextPercent));
				query = query.substring(nextPercent + 1, query.length);
				continue;
			}

			if (nextUnderscore < nextPercent) {
				search.push(query.substring(0, nextUnderscore));
				query = query.substring(nextUnderscore, query.length);

				let count = 0;
				for (let i = 0; i < query.length; i++) {
					if (query.charAt(i) === '_') count++;
					else break;
				}

				search.push(count);
				query = query.substring(count, query.length);
				continue;
			}

			if (query.length > 1) search.push(query);
			break;
		}

		// Search
		let indexedSearch = false;
		for (const element of search) {
			if (typeof element === 'number') {
				value = value.substring(element, value.length);
				indexedSearch = true;
				continue;
			}

			if (indexedSearch) {
				if (value.indexOf(element) === 0) {
					value = value.substring(element.length, value.length);
					indexedSearch = false;
					continue;
				}
				return;
			}

			let index = value.indexOf(element);
			if (index >= 0) {
				value = value.substring(index + element.length, value.length);
				continue;
			}
			return;
		}

		// If the method gets to here, that means the text is present in the entry.
		this.pushToAttributeSet(results, depth.query, entry._id);

		return;
	}

	/** Exists ($exists) search for non-indexed attributes/collections.
	 *
	 * Search the entry provided for an attributes presence. This method should only be called from
	 * the non-indexed router method {@link Zani#findNonIndexedRouter}.
	 *
	 * See query documentation for usage.
	 *
	 * @example
	 * query: {value: {$exists: true}
	 * results: any entry with attribute value
	 *
	 * @see {@link Zani#findNonIndexed}
	 * @see {@link Zani#findNonIndexedRouter}
	 *
	 * @param {any} query - The value of the entry to compare to
	 * @param {object} entry - The entry to check for fitting values
	 * @param {object} results - The results storage object, which any matching entries will be added to.
	 */
	findNonIndexedExists(query, entry, results, depth) {
		this.logger.log(`Exists for non-indexed at ${depth.entry}, Q:${query} - E._id:${entry._id}`);

		const value = this.getObjectAttribute(entry, depth.entry);
		if (query) {
			if (value !== null && value !== undefined)
				this.pushToAttributeSet(results, depth.query, entry._id);
		} else {
			if (value === null || value === undefined) {
				this.pushToAttributeSet(results, depth.query, entry._id);
			}
		}
	}

	/** Type ($type) search for non-indexed attributes/collections.
	 *
	 * Search the entry provided for values that share the same datatype as query. This method
	 * should only be called from the non-indexed router method {@link Zani#findNonIndexedRouter}.
	 *
	 * See query documentation for usage.
	 *
	 * @example
	 * query: {value: {$type: 'number'}
	 * results: any entry with attribute value that is of type number, as defined by JS typeof keyword.
	 *
	 * @see {@link Zani#findNonIndexed}
	 * @see {@link Zani#findNonIndexedRouter}
	 *
	 * @param {any} query - The value of the entry to compare to
	 * @param {object} entry - The entry to check for fitting values
	 * @param {object} results - The results storage object, which any matching entries will be added to.
	 */
	findNonIndexedType(query, entry, results, depth) {
		this.logger.log(`Find type for non-indexed at ${depth.entry}, Q:${query} - E._id:${entry._id}`);

		if (this.getAttributeDataType(entry, depth.entry) === query) {
			this.pushToAttributeSet(results, depth.query, entry._id);
		}
	}

	/* ------------------------- Query (Logical) Methods ------------------------ */

	/** Given three result objects (indexed, nonIndexed, results), complete any remaining logical operations
	 * defined by the query object, reduce the three objects into a single object recursively, and return this
	 * object as a final results set, which carries entry IDs that will be used within {@link Zani#find} to
	 * build the query result array of entries.
	 *
	 * This method only works after both queries are completed. These objects can be empty.
	 *
	 * @param {string} collection - The name of the collection to search
	 * @param {object} query - The criteria to apply to each entry
	 * @param {object} indexedResults - The results of the indexed query built by {@link Zani#findIndexed}.
	 * @param {object} nonIndexedResults - The results of the non indexed query built by {@link Zani#findNonIndexed}
	 * @returns {Set} - The results set.
	 */
	findLogical(collection, query, indexedResults, nonIndexedResults) {
		this.logger.log(`Starting Logical operations or results`, this.databaseName);
		const start = Date.now();

		var results = structuredClone(query);
		this.prepareResultsObject(results);

		this.findLogicalRouter(
			query,
			results,
			indexedResults,
			nonIndexedResults,
			undefined,
			collection,
		);
		results = this.findLogicalFinal(results, indexedResults, nonIndexedResults);

		const end = Date.now();
		const totalTime = (end - start) / 1000;

		this.logger.log(`Logical operations completed in ${totalTime} seconds`, this.databaseName);
		return results;
	}

	/** Given a criteria, route all queries to proper method and construct the final results object. This method is
	 * called from and will return to {@link Zani#findLogical}. This method is recursive and will be called
	 * for every $queryOperator or nested object within the entry.
	 *
	 * @see {@link Zani#find}
	 * @see {@link Zani#findLogical}
	 *
	 * @param {any} query - The value of the entry to compare to
	 * @param {object} results - The results storage object, which any matching entries will be added to.
	 * @param {object} indexedResults - The results of the indexed query built by {@link Zani#findIndexed}.
	 * @param {object} nonIndexedResults - The results of the non indexed query built by {@link Zani#findNonIndexed}
	 * @param {object} depth - The variable tracking the current object depth, and attribute path (unflattened)
	 * @param {string} collection - The name of the collection to search
	 */
	findLogicalRouter(
		query,
		results,
		indexedResults,
		nonIndexedResults,
		depth = { entry: [], query: [] },
		collection,
	) {
		for (const key in query) {
			if (key.charAt(0) !== '$') depth.entry.push(key);
			depth.query.push(key);

			let attributeValue = this.getAttributeDataType(query[key]);

			if (attributeValue === 'object') {
				this.findLogicalRouter(
					query[key],
					results,
					indexedResults,
					nonIndexedResults,
					depth,
					collection,
				);
				if (key.charAt(0) === '$' && this.queryOperators.logical.hasOwnProperty(key)) {
					this.queryOperators.logical[key](
						query[key],
						results,
						indexedResults,
						nonIndexedResults,
						depth,
						collection,
					);
				} else {
					this.findLogicalAnd(query[key], results, indexedResults, nonIndexedResults, depth);
				}
			} else {
				this.findLogicalAnd(query[key], results, indexedResults, nonIndexedResults, depth);
			}

			if (key.charAt(0) !== '$') depth.entry.pop();
			depth.query.pop();
		}
	}

	/** Logical AND ($and) operation for result objects/sets.
	 *
	 * Compute a logical and between the three result objects at the attribute defined by depth.query.
	 * This method should only be called from the non-indexed router method {@link Zani#findLogicalRouter}.
	 *
	 * See query documentation for usage.
	 *
	 * @example
	 * query: {
	 * 	$and: {value: 3, foo: "bar"}
	 * }
	 * results: any entry with attribute value equal to 3 and attribute foo equal to "bar"
	 *
	 * @see {@link Zani#findLogical}
	 * @see {@link Zani#findLogicalRouter}
	 *
	 * @param {any} query - The value of the entry to compare to
	 * @param {object} results - The results storage object, which any matching entries will be added to.
	 * @param {object} indexedResults - The results of the indexed query built by {@link Zani#findIndexed}.
	 * @param {object} nonIndexedResults - The results of the non indexed query built by {@link Zani#findNonIndexed}
	 * @param {object} depth - The variable tracking the current object depth, and attribute path (unflattened)
	 */
	findLogicalAnd(query, results, indexedResults, nonIndexedResults, depth) {
		this.logger.log(`Logical and for ${depth.entry}`, this.databaseName);

		var individualResults = this.extractResults(
			query,
			results,
			indexedResults,
			nonIndexedResults,
			depth,
		);

		if (individualResults.length === 0) return;

		var finalResults = individualResults[0];
		for (let i = 1; i < individualResults.length; i++) {
			finalResults = this.setIntersection(finalResults, individualResults[i]);
		}

		this.setObjectAttribute(results, depth.query, finalResults);
		return;
	}

	/** Logical NAND ($nand) operation for result objects/sets.
	 *
	 * Compute a logical nand between the three result objects at the attribute defined by depth.query.
	 * This method should only be called from the non-indexed router method {@link Zani#findLogicalRouter}.
	 *
	 * See query documentation for usage.
	 *
	 * @example
	 * query: {
	 * 	$nand: {value: 3, foo: "bar"}
	 * }
	 * results: any entry with attribute value not equal to 3 or attribute foo not equal to "bar"
	 *
	 * @see {@link Zani#findLogical}
	 * @see {@link Zani#findLogicalRouter}
	 *
	 * @param {any} query - The value of the entry to compare to
	 * @param {object} results - The results storage object, which any matching entries will be added to.
	 * @param {object} indexedResults - The results of the indexed query built by {@link Zani#findIndexed}.
	 * @param {object} nonIndexedResults - The results of the non indexed query built by {@link Zani#findNonIndexed}
	 * @param {object} depth - The variable tracking the current object depth, and attribute path (unflattened)
	 * @param {string} collection - The name of the collection to search
	 */
	findLogicalNand(query, results, indexedResults, nonIndexedResults, depth, collection) {
		this.logger.log(`Logical nand for ${depth.entry}`, this.databaseName);

		var individualResults = this.extractResults(
			query,
			results,
			indexedResults,
			nonIndexedResults,
			depth,
		);

		if (individualResults.length === 0) return;

		// Perform and operation
		var invalidIndexes = individualResults[0];
		for (let i = 1; i < individualResults.length; i++) {
			invalidIndexes = this.setIntersection(invalidIndexes, individualResults[i]);
		}

		// Create set of all possible indexes
		const collectionSize = this.getCollectionSize(collection);
		var validIndexes = new Set();
		for (let i = 0; i < collectionSize; i++) validIndexes.add(i);

		// Remove missing entry ids
		for (const element of this.meta.collections[collection].availableIDs)
			validIndexes.delete(element);

		// Perform not operation
		var finalResults = this.setDifference(validIndexes, invalidIndexes);

		this.setObjectAttribute(results, depth.query, finalResults);
		return;
	}

	/** Logical OR ($or) operation for result objects/sets.
	 *
	 * Compute a logical or between the three result objects at the attribute defined by depth.query.
	 * This method should only be called from the non-indexed router method {@link Zani#findLogicalRouter}.
	 *
	 * See query documentation for usage.
	 *
	 * @example
	 * query: {
	 * 	$or: {value: 3, foo: "bar"}
	 * }
	 * results: any entry with attribute value equal to 3 or attribute foo equal to "bar"
	 *
	 * @see {@link Zani#findLogical}
	 * @see {@link Zani#findLogicalRouter}
	 *
	 * @param {any} query - The value of the entry to compare to
	 * @param {object} results - The results storage object, which any matching entries will be added to.
	 * @param {object} indexedResults - The results of the indexed query built by {@link Zani#findIndexed}.
	 * @param {object} nonIndexedResults - The results of the non indexed query built by {@link Zani#findNonIndexed}
	 * @param {object} depth - The variable tracking the current object depth, and attribute path (unflattened)
	 */
	findLogicalOr(query, results, indexedResults, nonIndexedResults, depth) {
		this.logger.log(`Logical or for ${depth.entry}`, this.databaseName);

		var individualResults = this.extractResults(
			query,
			results,
			indexedResults,
			nonIndexedResults,
			depth,
		);

		if (individualResults.length === 0) return;

		var finalResults = individualResults[0];
		for (let i = 1; i < individualResults.length; i++) {
			finalResults = this.setUnion(finalResults, individualResults[i]);
		}

		this.setObjectAttribute(results, depth.query, finalResults);
		return;
	}

	/** Logical NOR ($nor) operation for result objects/sets.
	 *
	 * Compute a logical nor between the three result objects at the attribute defined by depth.query.
	 * This method should only be called from the non-indexed router method {@link Zani#findLogicalRouter}.
	 *
	 * See query documentation for usage.
	 *
	 * @example
	 * query: {
	 * 	$nor: {value: 3, foo: "bar"}
	 * }
	 * results: any entry with attribute value not equal to 3 and attribute foo not equal to "bar"
	 *
	 * @see {@link Zani#findLogical}
	 * @see {@link Zani#findLogicalRouter}
	 *
	 * @param {any} query - The value of the entry to compare to
	 * @param {object} results - The results storage object, which any matching entries will be added to.
	 * @param {object} indexedResults - The results of the indexed query built by {@link Zani#findIndexed}.
	 * @param {object} nonIndexedResults - The results of the non indexed query built by {@link Zani#findNonIndexed}
	 * @param {object} depth - The variable tracking the current object depth, and attribute path (unflattened)
	 * @param {string} collection - The name of the collection to search
	 */
	findLogicalNor(query, results, indexedResults, nonIndexedResults, depth, collection) {
		this.logger.log(`Logical nor for ${depth.entry}`, this.databaseName);

		var individualResults = this.extractResults(
			query,
			results,
			indexedResults,
			nonIndexedResults,
			depth,
		);

		if (individualResults.length === 0) return;

		// Perform or operation
		var invalidIndexes = individualResults[0];
		for (let i = 1; i < individualResults.length; i++) {
			invalidIndexes = this.setUnion(invalidIndexes, individualResults[i]);
		}

		// Create set of all possible indexes
		const collectionSize = this.getCollectionSize(collection);
		var validIndexes = new Set();
		for (let i = 0; i < collectionSize; i++) validIndexes.add(i);

		// Remove missing entry ids
		for (const element of this.meta.collections[collection].availableIDs)
			validIndexes.delete(element);

		// Perform not operation
		var finalResults = this.setDifference(validIndexes, invalidIndexes);

		this.setObjectAttribute(results, depth.query, finalResults);
		return;
	}

	/** Logical XOR ($xor) operation for result objects/sets.
	 *
	 * Compute a logical xor between the three result objects at the attribute defined by depth.query.
	 * This method should only be called from the non-indexed router method {@link Zani#findLogicalRouter}.
	 *
	 * See query documentation for usage.
	 *
	 * @example
	 * query: {
	 * 	$xor: {value: 3, foo: "bar"}
	 * }
	 * results: any entry with attribute value equal to 3 or attribute foo equal to "bar", but not entries where
	 * value is equal to 3 and foo is equal to 'bar', or entries where value is not equal to 3 and foo is not
	 * equal to 'bar'
	 *
	 * @see {@link Zani#findLogical}
	 * @see {@link Zani#findLogicalRouter}
	 *
	 * @param {any} query - The value of the entry to compare to
	 * @param {object} results - The results storage object, which any matching entries will be added to.
	 * @param {object} indexedResults - The results of the indexed query built by {@link Zani#findIndexed}.
	 * @param {object} nonIndexedResults - The results of the non indexed query built by {@link Zani#findNonIndexed}
	 * @param {object} depth - The variable tracking the current object depth, and attribute path (unflattened)
	 */
	findLogicalXor(query, results, indexedResults, nonIndexedResults, depth) {
		this.logger.log(`Logical Xor for ${depth.entry}`, this.databaseName);

		var individualResults = this.extractResults(
			query,
			results,
			indexedResults,
			nonIndexedResults,
			depth,
		);

		if (individualResults.length === 0) return;

		var finalResults = individualResults[0];
		for (let i = 1; i < individualResults.length; i++) {
			finalResults = this.setSymmetricDifference(finalResults, individualResults[i]);
		}

		this.setObjectAttribute(results, depth.query, finalResults);
		return;
	}

	/** Logical NOT ($not) operation for result objects/sets.
	 *
	 * Compute a logical not between the three result objects at the attribute defined by depth.query.
	 * This method should only be called from the non-indexed router method {@link Zani#findLogicalRouter}.
	 *
	 * Note: If more than one attribute is passed/set between the three objects, a logical NAND is performed.
	 *
	 * See query documentation for usage.
	 *
	 * @example
	 * query: {
	 * 	$not: {value: 3}
	 * }
	 * results: any entry with attribute value not equal to 3
	 *
	 * @see {@link Zani#findLogical}
	 * @see {@link Zani#findLogicalRouter}
	 *
	 * @param {any} query - The value of the entry to compare to
	 * @param {object} results - The results storage object, which any matching entries will be added to.
	 * @param {object} indexedResults - The results of the indexed query built by {@link Zani#findIndexed}.
	 * @param {object} nonIndexedResults - The results of the non indexed query built by {@link Zani#findNonIndexed}
	 * @param {object} depth - The variable tracking the current object depth, and attribute path (unflattened)
	 * @param {string} collection - The name of the collection to search
	 */
	findLogicalNot(query, results, indexedResults, nonIndexedResults, depth, collection) {
		this.logger.log(`Logical not for ${depth.entry}`, this.databaseName);

		var individualResults = this.extractResults(
			query,
			results,
			indexedResults,
			nonIndexedResults,
			depth,
		);

		if (individualResults.length === 0) return;
		if (individualResults.length !== 1) {
			// Perform and operation
			for (let i = 1; i < individualResults.length; i++) {
				individualResults[0] = this.setIntersection(individualResults[0], individualResults[i]);
			}
		}

		// Create set of all possible indexes
		const collectionSize = this.getCollectionSize(collection);
		var validIndexes = new Set();
		for (let i = 0; i < collectionSize; i++) validIndexes.add(i);

		// Remove missing entry ids
		for (const element of this.meta.collections[collection].availableIDs)
			validIndexes.delete(element);

		// Perform not operation
		var finalResults = this.setDifference(validIndexes, individualResults[0]);

		this.setObjectAttribute(results, depth.query, finalResults);
		return;
	}

	/** Perform the final AND operation on the three result objects, and return the final set. This method can only
	 * be called after results is entirely down to a single layer.
	 *
	 * @param {object} results - The results object
	 * @param {object} indexedResults - The indexed results object
	 * @param {object} nonIndexedResults - The non indexed results object
	 * @returns {Set} - The condensed results
	 */
	findLogicalFinal(results, indexedResults, nonIndexedResults) {
		var individualResults = [];
		for (const key in results) {
			if (results[key] instanceof Set && results[key].size !== 0) {
				individualResults.push(results[key]);
				continue;
			}

			if (indexedResults[key] instanceof Set) {
				individualResults.push(indexedResults[key]);
				continue;
			}

			if (nonIndexedResults[key] instanceof Set) {
				individualResults.push(nonIndexedResults[key]);
				continue;
			}
		}

		if (individualResults.length < 1) {
			results = individualResults[0];
			return;
		}

		var results = individualResults[0];
		for (let i = 1; i < individualResults.length; i++) {
			results = this.setIntersection(results, individualResults[i]);
		}
		return results;
	}

	/** Returns all results from an object as an array at a specified depth. All entries in this array
	 * will be set objects of length 0 or greater. This method also truncates any objects if a set is extracted
	 * to remove that attribute to reduce memory footprint.
	 *
	 * @param {object} query - The query object
	 * @param {object} results - The results object
	 * @param {object} indexedResults - The indexed query results
	 * @param {object} nonIndexedResults - The non indexed query results
	 * @param {object} depth - The depth object carrying entry and query attributes
	 * @returns {Set[]} - The gathered results.
	 */
	extractResults(query, results, indexedResults, nonIndexedResults, depth) {
		var individualResults = [];
		for (const key in query) {
			const destination = [...depth.query, key];

			var extractedResults = this.getObjectAttribute(indexedResults, destination);
			if (extractedResults instanceof Set) {
				this.deleteObjectAttribute(indexedResults, destination);
				individualResults.push(extractedResults);

				continue;
			}

			extractedResults = this.getObjectAttribute(nonIndexedResults, destination);
			if (extractedResults instanceof Set) {
				this.deleteObjectAttribute(nonIndexedResults, destination);
				individualResults.push(extractedResults);

				continue;
			}

			extractedResults = this.getObjectAttribute(results, destination);
			if (extractedResults instanceof Set) {
				individualResults.push(extractedResults);

				continue;
			}
		}

		return individualResults;
	}

	findCount() {
		//TODO count methods
		/*
		! must be used as 
		* { $count: {
		* 		project: string (What it will be attributed as)
		* 		query: {...}
		* }
		*/
	}

	/* -------------------------------------------------------------------------- */
	/*                               Helper Methods                               */
	/* -------------------------------------------------------------------------- */

	/** Check if there is an active database to be operated on.
	 *
	 * @returns {boolean}
	 */
	checkForActiveDatabase(operation) {
		if (!this.databaseName) {
			this.handleError(new NoActiveDatabaseError(operation));
			return false;
		}
		return true;
	}

	/** Checks if a collection folder/files exists within the active database. This includes check for
	 * collection, the collection variable, and the active database.
	 *
	 * Note: if it is outside the scope of meta, it will not report true.
	 *
	 * @param {string} collection - The name of the collection
	 * @param {string} method - In case of error, pass calling method
	 * 
	 * @returns {boolean} True if system is set and ready to be operated on, false otherwise
	 */
	checkForCollection(collection, method) {
		// Check if active database
		if (!this.checkForActiveDatabase()) return false;

		// Check if a collection name was passed
		if (!collection) {
			this.handleError(new MissingParametersError('collection', method || "Unknown"));
			return false;
		}

		// Check if the collection is within meta.json collection list
		let found = this.meta.collections.hasOwnProperty(collection);

		if (found) {
			// Check if the collection file exists
			const collectionPath = path.join(this.options.path, this.databaseName, 'collections', collection);
			if (fs.existsSync(collectionPath)) 
				return true;

			// Log an error if it exists in meta but not in file.
			this.handleError(new CollectionFolderNotFound(collection, 
				`${this.databaseName}\\collections\\${collection}`));
		}
		this.handleError(new CollectionFolderNotFound(collection, method));
		return false;
	}

	/** Given a collection name, return the length/number of entries in the collection.
	 *
	 * @param {string} collection - Name of the collection
	 * @returns {number} Collection length
	 */
	getCollectionSize(collection) {
		return this.meta.collections[collection].entries;
	}

	/** Returns the file path, including file name and extension, based on collection name and id.
	 *
	 * @param {string} collection - The collection name
	 * @param {number} id - The entry _id
	 * @returns {string} - The file path to the entry
	 */
	getEntryPath(collection, id) {
		const folder = this.getEntryFolder(id);
		const formattedId = String(id).padStart(6, 0);
		return path.join(this.options.path, this.databaseName, 'collections', collection, folder, `${formattedId}.json`);
	}

	/** Return the folder name of the entry derived from the id.
	 *
	 * @param {number} id - The entry _id
	 * @returns {string}
	 */
	getEntryFolder(id) {
		return String(Math.floor(id / 10000)).padStart(2, 0);
	}

	/** Update the meta.json object for the active database with the current meta object instance.	 *
	 */
	updateMetaFile() {
		const metaPath = path.join(this.options.path, this.databaseName, 'meta.json');
		fs.writeFileSync(metaPath, JSON.stringify(this.meta));
	}

	/** Compare two objects by all parameters, and then return true or false. It will first check by _id, and
	 * if its not present, it will check that all attributes and values are aligned. If any different, it will
	 * be false.
	 *
	 * @param {object} obj1 - The first object to compare
	 * @param {object} obj2 - The second object to compare
	 * @returns {boolean}
	 */
	compareObjects(obj1, obj2) {
		// Check both objects are passed
		if (obj1 === undefined || obj2 === undefined) {
			this.handleError(new MissingParametersError('obj1 OR obj2', 'compareObjects'));
			return false;
		}

		// If both have a _id property, compare.
		if (obj1.hasOwnProperty('_id') && obj1.hasOwnProperty('_id')) {
			if (obj1._id === obj2._id) return true;
			return false;
		}

		// Compare by all known values
		var obj1Keys = Object.getOwnPropertyNames(obj1).sort();
		var obj2Keys = Object.getOwnPropertyNames(obj2).sort();

		// Ensure attributes are the same before checking values
		if (obj1Keys.length != obj2Keys.length) return false;

		var keyLength = obj1Keys.length;
		for (let i = 0; i < keyLength; i++) {
			if (obj1Keys[i] != obj2Keys[i]) return false;
		}

		// Check attribute values
		for (let i = 0; i < keyLength; i++) {
			if (obj1[obj1Keys[i]] != obj2[obj2Keys[i]]) return false;
		}

		// If all passed, they are the same.
		return true;
	}

	/** Search through a given array, or set, for a object using {@link zani#compareObjects}. If it is
	 * found, return true. Else, return false.
	 *
	 * @param {any[]} array - The array or similar object to check
	 * @param {object} obj - The object to search for
	 * @returns {boolean}
	 */
	isInArray(array, obj) {
		for (const element of array) {
			if (this.compareObjects(element, obj)) return true;
		}

		return false;
	}

	/** Flatten an array into dot notation in order of elements
	 *
	 * @param {string[]} attribute - The unflattened attribute
	 * @return {string} The flattened attribute
	 */
	flattenAttribute(attribute) {
		return attribute.join('.');
	}

	/** Unflattens an array from dot notation in order of elements to an array
	 *
	 * @param {string[]} attribute - The flattened attribute
	 * @return {string} The unflattened attribute
	 */
	unflattenAttribute(attribute) {
		return attribute.split('.').map((element) => element);
	}

	/** Set a value of a attribute in an object without recursively reducing the object.
	 *
	 *  This only works with non-array attributes, but can set arrays as an attribute value.
	 *
	 * @param {object} obj - The object to traverse
	 * @param {string} attribute - The unflattened attribute to set
	 * @param {any} value - The value to set
	 */
	setObjectAttribute(obj, attribute, value) {
		let curr = obj;
		for (let i = 0; i < attribute.length - 1; i++) {
			if (!(attribute[i] in curr)) curr[attribute[i]] = {};
			curr = curr[attribute[i]];
		}
		curr[attribute[attribute.length - 1]] = value;
	}

	/** Get a nested value from an object without modifying the object.
	 *
	 * @param {object} obj - The object to traverse.
	 * @param {string[]} attribute - The path to the nested attribute as an array.
	 * @returns {any} - The value found at the path, or undefined if any part of the path is missing.
	 */
	getObjectAttribute(obj, attribute) {
		let curr = obj;

		for (let i = 0; i < attribute.length; i++) {
			if (!(attribute[i] in curr)) {
				return undefined;
			}

			curr = curr[attribute[i]];
		}

		return curr;
	}

	/** Delete a nested value/property from an object
	 *
	 * @param {object} obj - The object to traverse.
	 * @param {string[]} attribute - The path to the nested attribute as an array.
	 * @returns {any} - undefined if any part of the path is missing.
	 */
	deleteObjectAttribute(obj, attribute) {
		let curr = obj;

		for (let i = 0; i < attribute.length - 1; i++) {
			if (!(attribute[i] in curr)) {
				return undefined;
			}

			curr = curr[attribute[i]];
		}

		delete curr[attribute[attribute.length - 1]];
	}

	/** Get a nested property from an object without modifying the object, adn return true if its present, or false
	 * if not.
	 *
	 * @param {object} obj - The object to traverse.
	 * @param {string[]} attribute - The path to the nested attribute as an array.
	 * @returns {boolean} - True if property is present, false otherwise
	 */
	objectHasAttribute(obj, attribute) {
		let curr = obj;

		for (let i = 0; i < attribute.length; i++) {
			if (!(attribute[i] in curr)) {
				return false;
			}

			curr = curr[attribute[i]];
		}

		return true;
	}

	/** Push a value to a attribute set in an object without recursively reducing the object.
	 *
	 * This only works with attributes that are already sets, and cannot add arrays into the set.
	 *
	 * If value is an array, each individual value within the array will be added to the set.
	 *
	 * @param {object} obj - The object to traverse
	 * @param {string[]} attribute - The unflattened attribute to set
	 * @param {any} value - The value to set
	 */
	pushToAttributeSet(obj, attribute, value) {
		let curr = obj;

		for (let i = 0; i < attribute.length - 1; i++) {
			if (!(attribute[i] in curr)) curr[attribute[i]] = {};

			curr = curr[attribute[i]];
		}

		const key = attribute[attribute.length - 1];
		if (!Array.isArray(value)) {
			curr[key].add(value);
			return;
		}

		for (let i = 0; i < value.length; i++) curr[key].add(value[i]);
	}

	/** Returns the data type of a object attribute. If attribute is omitted, the passed obj value
	 * will be assessed. Otherwise, it will retrieve the value at the attribute from the object passed.
	 *
	 * Can be:
	 * - 'undefined'
	 * - 'null'
	 * - 'array'
	 * - any result of typeof keyword
	 *
	 * @param {any} obj - The object holding the desired attribute
	 * @param {string?} attribute - The unflattened path of the attribute
	 * @returns The object type in string form
	 */
	getAttributeDataType(obj, attribute) {
		let value = obj;
		if (attribute) value = this.getObjectAttribute(obj, attribute);

		if (value === undefined) return 'undefined';
		if (Array.isArray(value)) return 'array';
		if (value === null) return 'null';
		return typeof value;
	}

	/** Returns the index path for a attribute and collection. The attribute can be passed in either flattened
	 * or unflattened form.
	 *
	 * @param {string} collection - The collection name
	 * @param {string | string[]} attribute - The attribute
	 */
	getIndexPath(collection, attribute) {
		if (Array.isArray(attribute)) attribute = this.flattenAttribute(attribute);

		return path.join(this.options.path, this.databaseName, `indexes`, collection, attribute);
	}

	/** Calculate a time from MS into Seconds.
	 * 
	 * @param {number} start - The start time, in MS
	 * @param {number} end - The end time, in MS
	 * @returns {string} - The time elapsed in seconds
	 */
	calculateTime(start, end) {
		return (end-start) / 1000;
	}

	
	/* -------------------------------------------------------------------------- */
	/*                               Set Operations                               */
	/* -------------------------------------------------------------------------- */

	/** Returns the difference between setA and setB. This is equivalent to setA/setB.
	 *
	 * @param {Set} setA - The set to divide
	 * @param {Set} setB - The set to divide by
	 */
	setDifference(setA, setB) {
		return new Set([...setA].filter((x) => !setB.has(x)));
	}

	/** Returns the intersection between setA and setB. This is equivalent to setA ∩ setB.
	 *
	 * @param {Set} setA - The first set
	 * @param {Set} setB - The second set
	 * @returns {Set} A new set containing elements present in both setA and setB
	 */
	setIntersection(setA, setB) {
		return new Set([...setA].filter((x) => setB.has(x)));
	}

	/** Returns the union between setA and setB. This is equivalent to setA ∪ setB.
	 *
	 * @param {Set} setA - The first set
	 * @param {Set} setB - The second set
	 * @returns {Set} A new set containing all elements from setA and setB
	 */
	setUnion(setA, setB) {
		return new Set([...setA, ...setB]);
	}

	/** Returns the symmetric difference between setA and setB. This is equivalent to (setA ∪ setB) \ (setA ∩ setB).
	 *
	 * @param {Set} setA - The first set
	 * @param {Set} setB - The second set
	 * @returns {Set} A new set containing elements present in either setA or setB, but not both
	 */
	setSymmetricDifference(setA, setB) {
		const union = this.setUnion(setA, setB);
		const intersection = this.setIntersection(setA, setB);
		return this.setDifference(union, intersection);
	}

	/* -------------------------------------------------------------------------- */
	/*                                  Utilities                                 */
	/* -------------------------------------------------------------------------- */

	/** If crash detection is enabled and the program were to crash, a log will be created.
	 * The log will also be printed to console, if that flag is enabled.
	 *
	 * This method is for errors.
	 */
	crashDetectorError(reason) {
		this.logger.error(
			'Uncaught exception - The program crashed',
			'Fatal',
			`${reason} \n\n${reason.stack}`,
		);

		// Create crash folder if not exists
		const errorPath = path.join(this.options.path, 'crashReports');
		if (!fs.existsSync(errorPath)) fs.mkdirSync(errorPath);

		// Create crash report
		fs.writeFileSync(
			path.join(errorPath, `crash-${Date.now()}.log`),
			`[${new Date().toISOString()}]\n${reason.stack}\n`,
		);
	}

	/** If crash detection is enabled and the program were to crash, a log will be created.
	 * The log will also be printed to console, if that flag is enabled.
	 *
	 * This method is for rejections.
	 */
	crashDetectorRejection(reason) {
		this.logger.error(
			'Uncaught rejection - The program crashed',
			'Fatal',
			`${reason} \n\n${reason.stack}`,
		);

		// Create crash folder if not exists
		const errorPath = path.join(this.options.path, 'crashReports');
		if (!fs.existsSync(errorPath)) fs.mkdirSync(errorPath);

		process.off('uncaughtException', this.errorBound);

		// Create crash report
		fs.writeFileSync(
			path.join(errorPath, `crash-${Date.now()}.log`),
			`[${new Date().toISOString()}]\n${err.stack}\n`,
		);
	}

	/** Cleans up any open files Zani may be using, updates the meta, and closes
	 * the database system.
	 *
	 * Note: This method should only be run once no more operations will be performed with this
	 * instance of Zani. Doing so may cause data loss.
	 */
	#cleanup() {
		this.logger.warn(`Shutting down`);
		this.logger.insertBreak();

		// Close the active database
		this.closeDatabase();

		// Ensure no memory leaks, remove listeners
		process.off('exit', this.cleanupBound);
		process.off('SIGINT', this.cleanupBound);
		process.off('SIGTERM', this.cleanupBound);
		process.off('uncaughtException', this.cleanupBound);
		
		this.emitter.removeAllListeners();

		if (this.options.crashDetector) {
			process.off('uncaughtException', this.errorBound);
			process.off('unhandledRejection', this.rejectionBound);
		}

		this.logger.log(`Process Terminated`);
	}

	handleError(error) {
		if(this.options.throwErrors) throw error;
		else this.logger.error(error.message, this.databaseName || undefined);
	}
}

module.exports = Zani;
