// Node Imports
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Custom Imports
const ZaniLog = require('./zaniLog');

//TODO list
/*
	- Add function that creates a txt file of the attributes within each collection, like a meta.pdf
		- To build on a method that returns a json of values (IE {value: number, obj: {n: string}})
	- Create a MD documentation of query to follow
	- Create options for collections, such as deduplication, unique, constraints, domains
	- Add a repair meta method in case of entries becoming out of sync with files
	- Add a repair collection file in case of formatting error (IE formatted file, breaking line/entry)
*/

/** A lightweight, out-of-memory NoSQL Document Store database system.
 *
 * @author Brock Kitterman <brock.kitterman@gmail.com>
 */
class Zani {
	/* -------------------------------------------------------------------------- */
	/*                                Global States                               */
	/* -------------------------------------------------------------------------- */
	/** Hard coded version of the code */
	version = 1.0;
	/** Hard coded, default metadata */
	meta = {
		version: 1.0,
		createdOn: Date.now(),
		lastUpdatedOn: Date.now(),
		collections: [
			//Keep list of collection as {name: string, entries: 0}
			// Entries are used as primary key index counter for _id
		],
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
		databaseName: 'ZaniDatabase',
	};
	/** Cleanup method used on process termination */
	cleanupBound = this.#cleanup.bind(this);
	/** Used for error handling */
	errorBound = this.crashDetectorError.bind(this);
	/** Used for rejection handling */
	rejectionBound = this.crashDetectorRejection.bind(this);

	/* --------------------------------- Aliases -------------------------------- */
	setDatabase = this.useDatabase;
	createDatabase = this.useDatabase;

	createCollection = this.addCollection;
	deleteCollection = this.removeCollection;

	search = this.find;
	query = this.find;

	/* -------------------------------- Variables ------------------------------- */
	/** The active database name. If undefined, no database is active. @*/
	databaseName;
	/** The desired parent path for the database folder */
	path; //TODO add true path later
	/** Instance of ZaniLog used for console and system logging. */
	logger;

	/** The options object used for settings of this class and its behavior. Can be set with {@link Zani#configureOptions} */
	options = {
		bufferSize: 256,
		crashDetector: true,
		consoleOptions: {
			systemLog: true,
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
	 * @param {number} [options.bufferSize=256] - Defines how many characters/bytes are to be read from a file at a time. 0 will be interpreted as file size.
	 * @param {boolean} [options.crashDetector=true] - Enable crash detecting method to handle unexpected events, and log errors.
	 * @param {object} options.consoleOptions - Define the console options to be used by the logging object.
	 *
	 * @param {boolean} [options.consoleOptions.consoleLog=true] - Enable console logging
	 * @param {boolean} [options.consoleOptions.systemLog=true] - Enable system logging to the specified file when available
	 * @param {boolean} [options.consoleOptions.colorful=true] - Enable colorful console output
	 */
	constructor(databaseName, options) {
		// Create logger object
		this.logger = new ZaniLog(databaseName, this.options.consoleOptions);
		this.logger.log(`Loading`);

		// Initial startup
		if (options) this.configureOptions(options);

		// Register a cleanup on process exit
		process.on('exit', this.cleanupBound);
		process.on('SIGINT', this.cleanupBound);
		process.on('SIGTERM', this.cleanupBound);
		process.on('uncaughtException', this.cleanupBound);

		// Set up any optional features
		if (this.options.crashDetector) {
			process.on('uncaughtException', this.errorBound);
			process.on('unhandledRejection', this.rejectionBound);
		};

		// Set current database
		if (databaseName) {
			this.useDatabase(databaseName);

			// Ensure integrity value is unexpected crash-ready
			this.meta.integrity.dirty = true;
			this.updateMetaFile();

			this.logger.log(`Ready - ${this.databaseName}`);
			return;
		}

		this.logger.log('Ready');
		this.logger.warn('No database selected');
	}

	/** Configure the options variable to match the passed arguments. If consoleOptions is present, it will configure
	 * the logger options, ZaniLog, as well through {@link ZaniLog#configureOptions}.
	 *
	 * @param {object} options - The new options to be used by Zani.
	 *
	 * @param {number} [options.bufferSize=256] - Defines how many characters/bytes are to be read from a file at a time. 0 will be interpreted as file size.
	 * @param {boolean} [options.crashDetector=true] - Enable crash detecting method to handle unexpected events, and log errors.
	 * @param {object} options.consoleOptions - Define the console options to be used by the logging object.
	 */
	configureOptions(options) {
		if (options.hasOwnProperty('bufferSize')) this.options.bufferSize = options.bufferSize;
		if (options.hasOwnProperty('crashDetector')) this.options.crashDetector = options.crashDetector;

		if (options.hasOwnProperty('consoleOptions'))
			this.logger.configureOptions(options.consoleOptions);
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
	}

	/** Delete the provided database via its name. This will not close the active database, regardless of passed
	 * or implied.
	 *
	 * This action is not undoable, and will delete the entire database folder.
	 *
	 * @param {string} databaseName - The name of the desired database to delete
	 */
	deleteDatabase(databaseName) {
		// Ensure a value was passed.
		if (!databaseName) {
			this.logger.error(
				`Cannot delete active database while it is open.`,
				'DeleteDatabase',
				`Attempted to close ${this.databaseName}, but is is currently the active database. Please close the database` +
					`before attempting to delete it again using 'closeDatabase()' function`,
			);
			return;
		}
		// Ensure the database is not the active one.
		if (databaseName === this.databaseName) {
			this.logger.error(
				`Cannot delete active database while it is open.`,
				'DeleteDatabase',
				`Attempted to close ${databaseName}, but is is currently the active database. Please close the database` +
					`before attempting to delete it again using 'closeDatabase()' function`,
			);
			return;
		}
		// Ensure the desired directory/database exists
		if (!fs.existsSync(databaseName)) {
			this.logger.error(`Database ${databaseName} does not exist.`, 'DeleteDatabase');
			return;
		}

		// Delete the database
		this.logger.warn('Deleting database ' + databaseName);
		fs.rmSync(databaseName, { recursive: true });
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
		if (!fs.existsSync(this.databaseName)) fs.mkdirSync(this.databaseName);
		// Check if database contains a collection folder
		if (!fs.existsSync(this.databaseName + '\\collections'))
			fs.mkdirSync(this.databaseName + '\\collections');
		// Check if database contains a index folder
		if (!fs.existsSync(this.databaseName + '\\indexes'))
			fs.mkdirSync(this.databaseName + '\\indexes');
		// Check if database contains a log folder
		if (!fs.existsSync(this.databaseName + '\\logs')) fs.mkdirSync(this.databaseName + '\\logs');

		// Check if database contains a meta.json file
		if (!fs.existsSync(this.databaseName + '\\meta.json')) {
			this.meta.databaseName = this.databaseName;
			fs.writeFileSync(this.databaseName + '\\meta.json', JSON.stringify(this.meta));
		}

		// If the systemLog flag is true, create a log file.
		if (this.options.consoleOptions.systemLog)
			if (!fs.existsSync(this.databaseName + '\\logs\\audit.log'))
				fs.writeFileSync(this.databaseName + '\\logs\\audit.log', '');

		// Load meta.json into the meta object for quick use
		this.meta = JSON.parse(fs.readFileSync(this.databaseName + '\\meta.json'));

		this.logger.log(`Connected to ${this.databaseName} at ${this.logger.getCurrentDate()}`);
	}

	/* -------------------------------------------------------------------------- */
	/*                            Collection Operations                           */
	/* -------------------------------------------------------------------------- */

	/** Adds a collection to the database. This includes creating the file and updating the metadata of
	 * this database.
	 *
	 * @param {string} collection - The name of the collection to add
	 */
	addCollection(collection) {
		// TODO add collection options, like required parameter?
		// Check if there is an active database
		if (!this.checkForActiveDatabase()) return;

		// Check if a collection name was passed
		if (!collection) {
			this.logger.error('No collection name provided', this.databaseName);
			return;
		}

		// Check if the collection already exists
		if (this.checkForCollection(collection)) {
			this.logger.error(`The collection ${collection} already exists`, this.databaseName);
			return;
		}

		// Create collection file
		fs.writeFileSync(`${this.databaseName}\\collections\\${collection}.jsonl`, '');

		// Update metadata, add collection
		this.meta.collections.push({ name: collection, entries: 0 });
		this.updateMetaFile();

		this.logger.log(`Added collection ${collection} to ${this.databaseName}`);
	}

	/** Removes a collection from the database. This includes deleting the file and updating the metadata of
	 * this database.
	 *
	 * Note: this action cannot be undone
	 *
	 * @param {string} collection - The name of the collection to delete
	 */
	removeCollection(collection) {
		// Check if there is an active database
		if (!this.checkForActiveDatabase()) return;

		// Check if a collection name was passed
		if (!collection) {
			this.logger.error('No collection name provided', this.databaseName);
			return;
		}

		// Check if the collection exists
		if (!this.checkForCollection(collection)) {
			this.logger.error(`The collection ${collection} does not exist.`, this.databaseName);
			return;
		}

		// Delete the file
		fs.rmSync(`${this.databaseName}\\collections\\${collection}.jsonl`);

		// Update metadata, remove collection
		this.meta.collections = this.meta.collections.filter((item) => item.name !== collection);
		this.updateMetaFile();

		this.logger.log(`Deleted collection ${collection}`, this.databaseName);
	}

	/** Renames the supplied collection with the provided name. This includes metadata and file name updates.
	 *
	 * @param {string} - The collection to rename
	 * @param {string} - The new name for the collection
	 */
	updateCollection(collection, newName) {
		// Check if there is an active database
		if (!this.checkForActiveDatabase()) return;

		// Check if a collection name was passed
		if (!collection) {
			this.logger.error('No collection name provided', this.databaseName);
			return;
		}

		// Check if the collection exists
		if (!this.checkForCollection(collection)) {
			this.logger.error(`The collection ${collection} does not exist.`, this.databaseName);
			return;
		}

		// Check if a new name for the collection was provided
		if (!newName) {
			this.logger.error(
				`No new collection name was provided to rename ${this.databaseName} to`,
				this.databaseName,
			);
			return;
		}

		// Rename collection file
		fs.renameSync(
			`${this.databaseName}\\collections\\${collection}.jsonl`,
			`${this.databaseName}\\collections\\${newName}.jsonl`,
		);

		// Update metadata file, rename object associated
		this.meta.collections.forEach((element) => {
			if (element.name === collection) {
				element.name = newName;
				return;
			}
		});
		this.updateMetaFile();

		this.logger.log(`Renamed collection ${collection} to ${newName}`, this.databaseName);
	}

	/** Returns the entire collection as object[].
	 *
	 * Note: This method will load the entire collection file into memory. It is advised not to use this on
	 * larger data sets, as it is space and time intensive.
	 *
	 * @param {string} collection - The collection to retrieve
	 * @returns The collection array of objects
	 */
	getCollection(collection) {
		// Check if there is an active database
		if (!this.checkForActiveDatabase()) return;

		// Check if a collection name was passed
		if (!collection) {
			this.logger.error('No collection name provided', this.databaseName);
			return;
		}

		// Check if the collection already exists
		if (!this.checkForCollection(collection)) {
			this.logger.error(`The collection ${collection} does not exist`, this.databaseName);
			return;
		}

		// TODO add buffer here later
		// Read file and split lines to create json objects
		const fileContents = fs.readFileSync(
			`${this.databaseName}\\collections\\${collection}.jsonl`,
			'utf-8',
		);
		return fileContents
			.split('\n')
			.filter(Boolean)
			.map((line) => JSON.parse(line));
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
		// Check if there is an active database
		if (!this.checkForActiveDatabase()) return;

		// Check if a collection name was passed
		if (!collection) {
			this.logger.error('No collection name provided', this.databaseName);
			return;
		}

		// Check if the collection already exists
		if (!this.checkForCollection(collection)) {
			this.logger.error(`The collection ${collection} does not exist`, this.databaseName);
			return;
		}

		// Check if entry value was passed
		if (!entry) {
			this.logger.error(`No entry value was passed.`, this.databaseName);
			return;
		}

		// Get metadata index, _id for entry
		const index = this.getCollectionIndexFromMeta(collection);
		const id = this.meta.collections[index].entries++;

		// Add property for _id
		entry = Object.defineProperty(entry, '_id', {
			value: id,
			enumerable: true,
			writable: false,
		});

		// Rearrange entry such that _id is first
		const { _id, ...rest } = entry;
		entry = { _id, ...rest };

		// Add to collection
		fs.appendFileSync(
			`${this.databaseName}\\collections\\${collection}.jsonl`,
			JSON.stringify(entry) + '\n',
		);
		this.updateMetaFile();

		this.logger.log(`Added entry: ${id} to ${collection}`, this.databaseName);
	}

	/* -------------------------------------------------------------------------- */
	/*                            Query Related Methods                           */
	/* -------------------------------------------------------------------------- */

	//TODO create a single object variant
	async find(collection, criteria, project, sort) {
		// Check if active database
		if (!this.checkForActiveDatabase()) return;

		// Check if a collection name was passed
		if (!collection) {
			this.logger.error('No collection name provided', this.databaseName);
			return;
		}

		// Check if the collection exists
		if (!this.checkForCollection(collection)) {
			this.logger.error(`The collection ${collection} does not exist`, this.databaseName);
			return;
		}
		
		this.logger.log(`Starting query of ${collection}`);
		var results = [];

		// If no criteria is passed, get all collection
		if (!criteria) {
			results = this.getCollection(collection);
		} else {
			results.push(... await this.findRouter(collection, undefined, criteria));
		}

		// TODO group by clause here
		//create 2d array for the groupings

		// If a projection value was passed, align results to match
		if (project) {
			var projections = [];

			// Extract projection keys, and add to array if desired to keep
			Object.getOwnPropertyNames(project).forEach((element) => {
				if (project[element] === 1) {
					projections.push(element);
				}
			});

			// Default return of _id
			if (!project.hasOwnProperty('_id')) projections.push('_id');

			// Match results to desired projection
			results.forEach((element) => {
				for (const key in element) {
					if (!projections.includes(key)) {
						delete element[key];

						// If it was the last key in element, remove
						if (Object.keys(element).length === 0)
							results = results.filter((arrElement) => arrElement !== element);
					}
				}
			});
		}

		// Deduplication
		//results = this.deduplicateResults(results);

		if (sort) {
			const sortParam = Object.getOwnPropertyNames(sort);
			// Rearrange results to match
		}

		this.logger.log('Query Complete', this.databaseName);
		return results;
	}

	queryOperators = {
		$gt: this.findGreaterThan.bind(this),
		$gte: this.findGreaterThanEqual.bind(this),
		$lt: this.findLessThan.bind(this),
		$lte: this.findLessThanEqual.bind(this),
		$eq: this.findEqual.bind(this),
		$ne: this.findNotEqual.bind(this),

		$and: this.findAnd.bind(this),
		$or: this.findOr.bind(this),
		$not: this.findNot.bind(this),
		$nand: this.findNand.bind(this),
		$nor: this.findNor.bind(this),
		$xor: this.findXor.bind(this),

		$in: this.findIn.bind(this),
		$nin: this.findNotIn.bind(this),
		$text: this.findText.bind(this),

		$exists: this.findExists.bind(this),
		$type: this.findType.bind(this),
	};

	/** Given a criteria, route all queries to proper method and construct the results array. This method is called from
	 * and will return to {@link Zani#find}. This method is recursive and will be called for every $queryOperator.
	 *
	 * @see {@link Zani#queryOperators}
	 * @see {@link Zani#find}
	 *
	 * @param {string} collection - The collection to search
	 * @param {object} criteria - The search query
	 * @param {string=} attribute - The calling attribute, if present.
	 *
	 * @returns {object[]}
	 */
	async findRouter(collection, attribute, criteria) {
		var results = [];
		const searchParameters = Object.getOwnPropertyNames(criteria);

		for (const element of searchParameters) {
			if (element.charAt(0) === '$') {
				results.push(
					... await this.queryOperators[element](collection, attribute, criteria[element]),
				);
			} else if (typeof criteria[element] === 'object' && !Array.isArray(criteria[element])) {
				results.push(... await this.findAnd(collection, element, criteria[element]));
			} else {
				// TODO make this more efficient, right now it passes over everything n times where n = criteria props.
				// 		Combine all non $ params and have it iterate 1 time over everything and compare each to all
				results.push(... await this.findEqual(collection, element, criteria[element]));
			}
		}

		return results;
	}

	/* ---------------------------- Value comparison ---------------------------- */
	/** Search the collection provided for greater than via the attribute, compared to the value. and
	 * returned to {@link Zani#find} for projection, grouping, and sorting as needed. If it was part of a compound search
	 * using a JSON object, such as $or or $and, it will be returned to {@link Zani#findRouter} instead.
	 *
	 * @async
	 *
	 * @see {@link Zani#find}
	 * @see {@link Zani#findRouter}
	 *
	 * @param {string} collection - The name of the collection
	 * @param {string} attribute The attribute name to have the comparison performed on
	 * @param {*} value - The comparison value, which may be a JSON object for more advanced queries
	 *
	 * @returns {object[]}
	 */
	async findGreaterThan(collection, attribute, value) {
		this.logger.log(`Greater than ${value} for ${attribute}`, this.databaseName);

		var results = [];
		const collectionSize =
			this.meta.collections[this.getCollectionIndexFromMeta(collection)].entries;

		// Read through entire collection, search for results
		for (var i = 1; i <= collectionSize; i++) {
			var entry = await this.getCollectionEntry(collection, i);
			entry = JSON.parse(entry);

			// If entry has attribute, compare. If conditions met, add to results array.
			if (entry.hasOwnProperty(attribute)) {
				if (entry[attribute] > value) results.push(entry);
			}
		}

		return results;
	}

	/** Search the collection provided for greater than equal to via the attribute, compared to the value. and
	 * returned to {@link Zani#find} for projection, grouping, and sorting as needed. If it was part of a compound search
	 * using a JSON object, such as $or or $and, it will be returned to {@link Zani#findRouter} instead.
	 *
	 * @async
	 *
	 * @see {@link Zani#find}
	 * @see {@link Zani#findRouter}
	 *
	 * @param {string} collection - The name of the collection
	 * @param {string} attribute The attribute name to have the comparison performed on
	 * @param {*} value - The comparison value, which may be a JSON object for more advanced queries
	 *
	 * @returns {object[]}
	 */
	async findGreaterThanEqual(collection, attribute, value) {
		this.logger.log(`Greater than equal to ${value} for ${attribute}`, this.databaseName);

		var results = [];
		const collectionSize =
			this.meta.collections[this.getCollectionIndexFromMeta(collection)].entries;

		// Read through entire collection, search for results
		for (var i = 1; i <= collectionSize; i++) {
			var entry = await this.getCollectionEntry(collection, i);
			entry = JSON.parse(entry);

			// If entry has attribute, compare. If conditions met, add to results array.
			if (entry.hasOwnProperty(attribute)) {
				if (entry[attribute] >= value) results.push(entry);
			}
		}

		return results;
	}

	/** Search the collection provided for less than via the attribute, compared to the value. and
	 * returned to {@link Zani#find} for projection, grouping, and sorting as needed. If it was part of a compound search
	 * using a JSON object, such as $or or $and, it will be returned to {@link Zani#findRouter} instead.
	 *
	 * @async
	 *
	 * @see {@link Zani#find}
	 * @see {@link Zani#findRouter}
	 *
	 * @param {string} collection - The name of the collection
	 * @param {string} attribute The attribute name to have the comparison performed on
	 * @param {*} value - The comparison value, which may be a JSON object for more advanced queries
	 *
	 * @returns {object[]}
	 */
	async findLessThan(collection, attribute, value) {
		this.logger.log(`Less than ${value} for ${attribute}`, this.databaseName);

		var results = [];
		const collectionSize =
			this.meta.collections[this.getCollectionIndexFromMeta(collection)].entries;

		// Read through entire collection, search for results
		for (var i = 1; i <= collectionSize; i++) {
			var entry = await this.getCollectionEntry(collection, i);
			entry = JSON.parse(entry);

			// If entry has attribute, compare. If conditions met, add to results array.
			if (entry.hasOwnProperty(attribute)) {
				if (entry[attribute] < value) results.push(entry);
			}
		}

		return results;
	}

	/** Search the collection provided for less than equal to via the attribute, compared to the value. and
	 * returned to {@link Zani#find} for projection, grouping, and sorting as needed. If it was part of a compound search
	 * using a JSON object, such as $or or $and, it will be returned to {@link Zani#findRouter} instead.
	 *
	 * @async
	 *
	 * @see {@link Zani#find}
	 * @see {@link Zani#findRouter}
	 *
	 * @param {string} collection - The name of the collection
	 * @param {string} attribute The attribute name to have the comparison performed on
	 * @param {*} value - The comparison value, which may be a JSON object for more advanced queries
	 *
	 * @returns {object[]}
	 */
	async findLessThanEqual(collection, attribute, value) {
		this.logger.log(`Less than equal to ${value} for ${attribute}`, this.databaseName);

		var results = [];
		const collectionSize =
			this.meta.collections[this.getCollectionIndexFromMeta(collection)].entries;

		// Read through entire collection, search for results
		for (var i = 1; i <= collectionSize; i++) {
			var entry = await this.getCollectionEntry(collection, i);
			entry = JSON.parse(entry);

			// If entry has attribute, compare. If conditions met, add to results array.
			if (entry.hasOwnProperty(attribute)) {
				if (entry[attribute] <= value) results.push(entry);
			}
		}

		return results;
	}

	/** Search the collection provided for equality via the attribute, compared to the value. and
	 * returned to {@link Zani#find} for projection, grouping, and sorting as needed. If it was part of a compound search
	 * using a JSON object, such as $or or $and, it will be returned to {@link Zani#findRouter} instead.
	 *
	 * @async
	 *
	 * @see {@link Zani#find}
	 * @see {@link Zani#findRouter}
	 *
	 * @param {string} collection - The name of the collection
	 * @param {string} attribute The attribute name to have the comparison performed on
	 * @param {*} value - The comparison value, which may be a JSON object for more advanced queries
	 *
	 * @returns {object[]}
	 */
	async findEqual(collection, attribute, value) {
		this.logger.log(`Equal to ${value} for ${attribute}`, this.databaseName);

		var results = [];
		var isArray = Array.isArray(value);
		const collectionSize =
			this.meta.collections[this.getCollectionIndexFromMeta(collection)].entries;

		// Read through entire collection, search for results
		for (var i = 1; i <=collectionSize; i++) {
			var entry = await this.getCollectionEntry(collection, i);
			entry = JSON.parse(entry);

			// If entry has attribute, compare. If conditions met, add to results array.
			if (entry.hasOwnProperty(attribute)) {
				// If multiple values, compare all
				if(isArray) {
					if (value.includes(entry[attribute])) results.push(entry);
				// If one value, compare
				} else {
					if (entry[attribute] === value) results.push(entry);
				}
			}
		}

		return results;
	}

	/** Search the collection provided for inequality via the attribute, compared to the value. and
	 * returned to {@link Zani#find} for projection, grouping, and sorting as needed. If it was part of a compound search
	 * using a JSON object, such as $or or $and, it will be returned to {@link Zani#findRouter} instead.
	 *
	 * @async
	 *
	 * @see {@link Zani#find}
	 * @see {@link Zani#findRouter}
	 *
	 * @param {string} collection - The name of the collection
	 * @param {string} attribute The attribute name to have the comparison performed on
	 * @param {*} value - The comparison value, which may be a JSON object for more advanced queries
	 *
	 * @returns {object[]}
	 */
	async findNotEqual(collection, attribute, value) {
		this.logger.log(`Not equal to ${value} for ${attribute}`, this.databaseName);

		var results = [];
		var isArray = Array.isArray(value);
		const collectionSize =
			this.meta.collections[this.getCollectionIndexFromMeta(collection)].entries;

		// Read through entire collection, search for results
		for (var i = 1; i <= collectionSize; i++) {
			var entry = await this.getCollectionEntry(collection, i);
			entry = JSON.parse(entry);

			// If entry has attribute, compare. If conditions met, add to results array.
			if (entry.hasOwnProperty(attribute)) {
				console.log(entry[attribute] + " vs " + value);
				// If multiple values, compare all
				if(isArray) {
					if (!value.includes(entry[attribute])) results.push(entry);
				// If one value, compare
				} else {
					if (entry[attribute] != value) results.push(entry);
				}
			}
		}

		console.log(results);

		return results;
	}

	/* ---------------------------- Logical Operators --------------------------- */
	/** Dispatch queries with a logical and intersection of the results. Each part of the query will be sent to 
	 * its corresponding method via {@link Zani#findRouter}, and return here. The results will then be
	 * checked to ensure all values are within all results before returning just those values. 
	 *  If it was part of a compound search using a JSON object, such as $or or $and, it will be returned 
	 * to {@link Zani#findRouter} instead.
	 *
	 * @async
	 *
	 * @see {@link Zani#find}
	 * @see {@link Zani#findRouter}
	 *
	 * @param {string} collection - The name of the collection
	 * @param {string} attribute The attribute name to have the comparison performed on
	 * @param {*} value - The comparison value, which may be a JSON object for more advanced queries
	 *
	 * @returns {object[]}
	 */
	//TODO And is broken. it cannot consider if it is the primary value, and is only used as a passway. This is not okay.
	async findAnd(collection, attribute, value) {
		this.logger.log(`Logical and ${value} for ${attribute}`, this.databaseName);
		
		var results = [];
		var searchParameters = Object.getOwnPropertyNames(value);
		var searchCount = searchParameters.length;
		var queryCount = 0;

		// Compile results from query, each query is individual row of 2d array
		for (const element of searchParameters) {
			if (element.charAt(0) === '$') {
				results[queryCount] = await this.queryOperators[element](collection, attribute, value[element]);
			} else if (typeof value[element] === 'object' && !Array.isArray(value[element])) {
				results[queryCount] = await this.findAnd(collection, element, value[element]);
			} else {
				// TODO make this more efficient, right now it passes over everything n times where n = criteria props.
				// 		Combine all non $ params and have it iterate 1 time over everything and compare each to all
				results[queryCount] = await this.findEqual(collection, element, value[element]);
			}
			queryCount++;
		}

		// if no results found, or only one row (one query), skip rest of method
		if (results.length <= 1) return results[0];

		// If attribute is provided, compare with that
		if(attribute) {
			// Start with elements from the first row
			let commonValues = new Set(results[0].map(item => item[attribute]));

			// Check set for intersections
			for (let i = 1; i < searchCount; i++) {
				let currentRow = new Set(results[i].map(item => item[attribute]));
	
				// Keep only elements that are in both sets
				commonValues = new Set([...commonValues].filter(val => currentRow.has(val)));
	
				// Early exit if there's nothing in common
				if (commonValues.size === 0) break;
			}
	
			return results[0].filter(item => commonValues.has(item[attribute]));	
		}

		// If there is no attribute provided, check via object itself.
		// Start with elements from the first row
		let commonValues = new Set(results[0].map(item => item));

		// Check set for intersections
		for (let i = 1; i < searchCount; i++) {
			let currentRow = new Set(results[i].map(item => item));

			// Keep only elements that are in both sets
			commonValues = new Set([...commonValues].filter(item => this.isInArray(currentRow, item)));

			// Early exit if there's nothing in common
			if (commonValues.size === 0) break;
		}
		return results[0].filter(item => this.isInArray(commonValues, item));
	}

	/** Dispatch queries with a logical or union of the results. Each part of the query will be sent to 
	 * its corresponding method via {@link Zani#findRouter}, and return here. The results will then be
	 * checked for deduplication of all values and returned without removing any unique values. If it was part 
	 * of a compound search using a JSON object, such as $or or $and, it will be returned to {@link Zani#findRouter} instead.
	 *
	 * @async
	 *
	 * @see {@link Zani#find}
	 * @see {@link Zani#findRouter}
	 *
	 * @param {string} collection - The name of the collection
	 * @param {string} attribute The attribute name to have the comparison performed on
	 * @param {*} value - The comparison value, which may be a JSON object for more advanced queries
	 *
	 * @returns {object[]}
	 */
	async findOr(collection, attribute, value) {
		this.logger.log(`Logical or ${value} for ${attribute}`, this.databaseName);

		var results = [];

		// Can just append results all to single array. Then, de-duplicate.
		results.push(... await this.findRouter(collection, attribute, value));

		// De-duplicate results
		results = this.deduplicateResults(results);

		return results;
	}

	/** Dispatch queries with a logical not union of the results. Each part of the query will be sent to 
	 * its corresponding method via {@link Zani#findRouter}, and return here. The results will then be deduplicated
	 * before checking the entire collection and returning just those not appearing in the query. If it was part of a 
	 * compound search using a JSON object, such as $or or $and, it will be returned to {@link Zani#findRouter} instead.
	 *
	 * @async
	 *
	 * @see {@link Zani#find}
	 * @see {@link Zani#findRouter}
	 *
	 * @param {string} collection - The name of the collection
	 * @param {string} attribute The attribute name to have the comparison performed on
	 * @param {*} value - The comparison value, which may be a JSON object for more advanced queries
	 *
	 * @returns {object[]}
	 */
	async findNot(collection, attribute, value) {
		this.logger.log(`Logical not ${value} for ${attribute}`, this.databaseName);

		var results = [];
		var notOperationResults = [];
		const collectionSize =
			this.meta.collections[this.getCollectionIndexFromMeta(collection)].entries;

		// Can just append results all to single array. Then, de-duplicate.
		results.push(... await this.findRouter(collection, attribute, value));

		// De-duplicate results
		results = this.deduplicateResults(results);

		var resultCount = results.length;

		// Check with collection and collection all non-results form query
		for(let i = 1; i<=collectionSize; i++) {
			let found = false;
			let element = JSON.parse(await this.getCollectionEntry(collection, i));
			
			// Compare each entry in collection to results
			for(let j = 0; j<resultCount; j++) {
				if(this.compareObjects(results[j], element)) {
					found = true;
					break;
				}
			}

			// If entry not in results, append to return array
			if(!found) {
				notOperationResults.push(element);
			}
		}

		return notOperationResults;
	}

	async findNand(collection, attribute, value) {
		this.logger.log(`Logical Nand ${value} for ${attribute}`, this.databaseName);

		var results = [];
		return results;
	}

	async findNor(collection, attribute, value) {
		this.logger.log(`Logical Nor ${value} for ${attribute}`, this.databaseName);

		var results = [];
		return results;
	}

	async findXor(collection, attribute, value) {
		this.logger.log(`Logical Xor ${value} for ${attribute}`, this.databaseName);

		var results = [];
		return results;
	}

	/* ----------------------- Arrays and Text Comparison ----------------------- */
	async findIn(collection, attribute, value) {
		this.logger.log(`Array In ${value} for ${attribute}`, this.databaseName);

		var results = [];
		return results;
	}

	async findNotIn(collection, attribute, value) {
		this.logger.log(`Array Not In ${value} for ${attribute}`, this.databaseName);

		var results = [];
		return results;
	}

	async findText(collection, attribute, value) {
		this.logger.log(`Array Text ${value} for ${attribute}`, this.databaseName);

		var results = [];
		return results;
	}

	/* ---------------------------- Misc. Comparison ---------------------------- */
	async findExists(collection, attribute, value) {
		this.logger.log(`Comp Exists ${value} for ${attribute}`, this.databaseName);

		var results = [];
		return results;
	}

	async findType(collection, attribute, value) {
		this.logger.log(`Comp Type ${value} for ${attribute}`, this.databaseName);

		var results = [];
		return results;
	}

	/* ------------------------- Query Result operations ------------------------ */
	/** Provided an array of entries, remove all duplicate entries and return an array with only unique elements.
	 * 
	 * @param {object[]} results - An array of entries for deduplication
	 * @returns {object[]}
	 */
	deduplicateResults(results) {
		let deduplicatedResults = [];
		let resultCount = results.length;

		// Cycle through each result provided
		for(var i = 0; i<resultCount; i++) {
			let element = results[i];
			let found = false;
			let params = Object.getOwnPropertyNames(element);// Just in case

			// Check that element is not in deduplicated results array
			for(var j = 0; j<deduplicatedResults.length; j++) {
				if(this.compareObjects(deduplicatedResults[j], element)) {
					found = true;
					break;
				}
			}

			// If result was not in array, add
			if(!found) deduplicatedResults.push(element);
		}

		return deduplicatedResults;
	}
	
	project(results, value) {
		this.logger.log(`Projection ${value}`, this.databaseName);
	}

	sort(results, value) {
		this.logger.log(`Sort ${value}`, this.databaseName);
	}

	//TODO count methods
	//TODO group method

	/* -------------------------------------------------------------------------- */
	/*                               Helper Methods                               */
	/* -------------------------------------------------------------------------- */

	/** Check if there is an active database to be operated on.
	 *
	 * @returns {boolean}
	 */
	checkForActiveDatabase() {
		if (!this.databaseName) {
			this.logger.error(
				'No active database.',
				undefined,
				'Please set an active database or create one using setDatabase()/useDatabase()',
			);
			return false;
		}
		return true;
	}

	/** Checks if a collection file exists within the active database.
	 *
	 * Note: if it is outside the scope of meta, it will not report true.
	 *
	 * @param {string} collection - The name of the collection
	 * @returns {boolean}
	 */
	checkForCollection(collection) {
		if (!this.checkForActiveDatabase()) return;

		// Check if the collection is within meta.json collection list
		let found = false;
		this.meta.collections.forEach((element) => {
			if (element.name === collection) {
				found = true;
				return;
			}
		});

		if (found) {
			// Check if the collection file exists
			if (fs.existsSync(`${this.databaseName}\\collections\\${collection}.jsonl`)) return true;

			// Log an error if it exists in meta but not in file.
			this.logger.error(
				`${collection}.jsonl does not exist`,
				'CollectionCheck',
				`The collection exists in the meta.json file, but the collection storage file cannot be located. ` +
					`\nError locating collection jsonl at ${path.join(
						__dirname,
						`${this.databaseName}\\collections\\${collection}.jsonl`,
					)}`,
			);
		}
		return false;
	}

	/** Retrieves the index of the collection in the metadata file collections array.
	 *
	 * @param {string} collection - The name of the collection
	 * @returns {number}
	 */
	getCollectionIndexFromMeta(collection) {
		// Check if a collection value was passed
		if (!collection) {
			this.logger.error(`No collection provided, cannot determine index`, this.databaseName);
			return;
		}

		// Locate the collection in the metadata array.
		let index = 0;
		this.meta.collections.forEach((element) => {
			if (element.name === collection) return index;
			index++;
		});

		return index;
	}

	/** Given a entry (line) number of a collection (file), return that entry.
	 *
	 * Note: line number is NOT 0 indexed. Line 1 is 1.
	 *
	 * @param {string} collection - The collection to retrieve from
	 * @param {number} lineNumber - The desired line number
	 *
	 * @return {string}
	 */
	//? useful for indexing?
	getCollectionEntry(collection, lineNumber) {
		// Check if there is an active database
		if (!this.checkForActiveDatabase()) return;

		// Check if a collection name was passed
		if (!collection) {
			this.logger.error('No collection name provided', this.databaseName);
			return;
		}

		// Check if the collection already exists
		if (!this.checkForCollection(collection)) {
			this.logger.error(`The collection ${collection} does not exist`, this.databaseName);
			return;
		}

		// Check if a line number was passed
		if (!lineNumber) {
			this.logger.error(`No line number provided.`, this.databaseName);
			return;
		}

		// Read file contents
		return new Promise((resolve, reject) => {
			const stream = fs.createReadStream(`${this.databaseName}\\collections\\${collection}.jsonl`, {
				encoding: 'utf-8',
				highWaterMark: this.options.bufferSize < 1 ? this.options.bufferSize : undefined,
			});

			let currentLine = 0;
			let content = '';

			// Read file in search for line.
			stream.on('data', (chunk) => {
				content += chunk;

				let lines = content.split('\n');
				// Remove partial line (This may remove the last line if it is bellow buffer size)
				content = lines.pop();

				// If line number will not be in lines array, skip loop
				if (lineNumber <= currentLine + lines.length) {
					// Check lines for desired line
					for (const line of lines) {
						currentLine++;
						if (currentLine === lineNumber) {
							stream.close();
							return resolve(line);
						}
					}
					// Update current Line is loop is skipped
				} else currentLine += lines.length;
			});

			// If the line is failed above, return the rest of file, which likely contains a last line removed by
			// last line removed by content.pop();
			stream.on('end', () => {
				return resolve(content);
			});

			// In case of unknown error
			stream.on('error', (err) => {
				reject(err);
			});
		});
	}

	/** Update the meta.json object for the active database with the current meta object instance.	 *
	 */
	updateMetaFile() {
		fs.writeFileSync(this.databaseName + '\\meta.json', JSON.stringify(this.meta));
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
		if(obj1 === undefined || obj2 === undefined) {
			this.logger.error(`Either one or both objects are undefined, and cannot be compared`, this.databaseName);
			return false;
		}

		// If both have a _id property, compare.
		if(obj1.hasOwnProperty('_id') && obj1.hasOwnProperty('_id')) {
			if(obj1._id === obj2._id) 
				return true;
			return false;
		}

		// Compare by all known values
		var obj1Keys = Object.getOwnPropertyNames(obj1).sort();
		var obj2Keys = Object.getOwnPropertyNames(obj2).sort();

		
		// Ensure attributes are the same before checking values
		if(obj1Keys.length != obj2Keys.length) return false;

		var keyLength = obj1Keys.length;
		for(let i = 0; i<keyLength; i++) {
			if(obj1Keys[i]!=obj2Keys[i])
				return false;
		}

		// Check attribute values
		for(let i = 0; i<keyLength; i++) {
			if(obj1[obj1Keys[i]]!=obj2[obj2Keys[i]])
				return false;
		}

		// If all passed, they are the same.
		return true;
	}

	/** Search through a given array, or set, for a object using {@link zani#compareObjects}. If it is
	 * found, return true. Else, return faalse.
	 * 
	 * @param {any[]} array - The array or similar object to check 
	 * @param {object} obj - The object to search for
	 * @returns {boolean}
	 */
	isInArray(array, obj) {
		for(const element of array) {
			if(this.compareObjects(element, obj)) return true;
		}

		return false;
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
		this.logger.error('Uncaught exception - The program crashed', 'Fatal',  `${reason} \n\n${reason.stack}`);

		// Create crash folder if not eixsts
		if (!fs.existsSync('crashReports')) fs.mkdirSync('crashReports');

		// Create crash report
		fs.writeFileSync(
			`crashReports\\crash-${Date.now()}.log`,
			`[${new Date().toISOString()}]\n${reason.stack}\n`,
		);
	}

	/** If crash detection is enabled and the program were to crash, a log will be created.
	 * The log will also be printed to console, if that flag is enabled.
	 * 
	 * This method is for rejections.
	 */
	crashDetectorRejection(reason) {
		this.logger.error('Uncaught rejection - The program crashed', 'Fatal',  `${reason} \n\n${reason.stack}`);

		// Create crash folder if not exists
		if (!fs.existsSync('crashReports')) fs.mkdirSync('crashReports');

		process.off('uncaughtException', this.errorBound);

		// Create crash report
		fs.writeFileSync(
			`crashReports\\crash-${Date.now()}.log`,
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

		if(this.options.crashDetector) {
			process.off('uncaughtException', this.errorBound);
			process.off('unhandledRejection', this.rejectionBound);
		}

		this.logger.log(`Process Terminated`);
	}
}

module.exports = Zani;
