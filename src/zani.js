// Node Imports
const fs = require('fs');
const fsPromises = require('fs/promises');

// Custom Imports
const ZaniLog = require('./zaniLog');
const BPlusTree = require('./bPlusTree');
const ZaniSemaphore = require('./zaniSemaphore');

//TODO list in order of precedence
/*
	- Add indexing
		- Smart index creation via QueryStats in meta/collections
		- Create system to allow for constraints to be placed on the attributes/collections
			- Primary key, ranges, value types, etc.
			- Stored in meta.collections as an array of objects (array[0] is primary key) with format
				{
					attribute: {
						name: string
						domain: {upper: num, lower: num}
						primary: boolean
						unique: boolean
					}
				}
				--------------OR-------------
				{
					attribute: string (Name, for just the required fields)
				}
			- Consider adding foreign keys later?
			- If it is within the meta.collections.attributes array, it is a required field. Constraints must always
			  be upheld, no exceptions.
	- Add event emitters to allow for user-definition of activities, publish-subscribe system. 
		- Consider this for logging
	- Change query system to be entry based rather than condition based (What it is now)
		- This comes first. It may change next steps (IE with nested objects)
	- Fix nested objects problem (See below).
	- Finish query functions
	- Create a MD documentation of query to follow
	- implement .trash folder later for safer deletion of items
	- Clean up code
	- Optimize where needed
	- Test everything
		- Create mass data files, test all cases and edges
	- Add function that creates a txt file of the attributes within each collection, like a meta.pdf
		- To build on a method that returns a json of values (IE {value: number, obj: {n: string}})
	- Create options for collections, such as deduplication, unique, constraints, domains
	- Add a repair meta method in case of entries becoming out of sync with files
	- Add a repair collection file in case of formatting error (IE formatted file, breaking line/entry)
	- Add a function that exports an entire database into a single file
		- Requires a export() function to build file from data
		- Requires a import() function to build project from data file
	- Consider a terminal-listener for real time data modification and access
*/

//! Zani only works at single level objects and cannot consider nested objects. IE, in the bellow example,
//! 	foo cannot be checked, as it is out of reach.
//* entry: {foo: "bar"},

/*
? This issue could be fixed via a implementation of a stack object (build custom) that has two functions.
?		The first is to peek/push/pop, which will be called before traversal, on arrival, and after traversal
?			This can be added in as the 'attribute' parameter in find
?		The second is to check if the address (length of stack) is greater than 1. If it is, it is a nested
?		object and must be handled differently. if it is not, it can be treated as code is now. 
*/

/*
! NOTE: Currently, using a for each condition -> for each entry -> test condition approach which is slow
todo	Change this to a for each entry -> for each condition -> Test condition
?		Benefits: Faster, can short circuit (IE range, AND condition), might be deduplicated by nature?
?		How to do it:
?			Similar logic as is now, change to passing entry around and globalized query. 
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

	/** Instance of ZaniSemaphore to ensure file overhead is not exceeded */
	semaphore;

	/** The options object used for settings of this class and its behavior. Can be set with {@link Zani#configureOptions} */
	options = {
		fileLimit: 100,
		treeOrder: 100,
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
	 * @param {number} [options.fileLimit=100] - Defines how many files can be opened by the program at any given time.
	 * @param {boolean} [options.crashDetector=true] - Enable crash detecting method to handle unexpected events, and log errors.
	 * @param {number} [options.treeOrder] - Define the max number of entries in any node of any index tree.
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
		}

		this.semaphore = new ZaniSemaphore(this.options.fileLimit);

		// Set current database
		if (databaseName) {
			this.useDatabase(databaseName);

			// Ensure integrity value is unexpected crash-ready
			this.meta.integrity.dirty = true;
			this.updateMetaFile();

			this.logger.log(`Ready - ${this.databaseName}`);
			return;
		}

		this.logger.log('Ready - No database selected');
	}

	/** Configure the options variable to match the passed arguments. If consoleOptions is present, it will configure
	 * the logger options, ZaniLog, as well through {@link ZaniLog#configureOptions}.
	 *
	 * @param {object} options - The new options to be used by Zani.
	 *
	 * @param {number} [options.fileLimit=100] - Defines how many files can be opened by the program at any given time.
	 * @param {boolean} [options.crashDetector=true] - Enable crash detecting method to handle unexpected events, and log errors.
	 * @param {number} [options.treeOrder] - Define the max number of entries in any node of any index tree.
	 * @param {object} options.consoleOptions - Define the console options to be used by the logging object.
	 */
	configureOptions(options) {
		if (options.hasOwnProperty('fileLimit')) this.options.fileLimit = options.fileLimit;
		if (options.hasOwnProperty('crashDetector')) this.options.crashDetector = options.crashDetector;
		if (options.hasOwnProperty('treeOrder')) this.options.treeOrder = options.treeOrder;

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
	 * This action is not reversible, and will delete the entire database folder.
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

	/** Adds a collection to the database. This includes creating the folder and updating the metadata of
	 * this database.
	 *
	 * @param {string} collection - The name of the collection to add
	 */
	addCollection(collection) {
		// TODO add collection options, like required parameter?
		// Check if system is ready
		if (!this.checkForCollection(collection)) return;

		// Create collection folder
		fs.mkdirSync(`${this.databaseName}\\collections\\${collection}`);

		// Create Collection Index Folder
		fs.mkdirSync(`${this.databaseName}\\indexes\\${collection}`);

		// Update metadata, add collection
		Object.defineProperty(this.meta.collections, collection, {
			value: { entries: 0, queryStats: {}, indexed: [], availableIDs: [] },
			writable: true,
			enumerable: true,
		});
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
		// Check if system is ready
		if (!this.checkForCollection(collection)) return;

		// Update metadata, remove collection
		if (this.meta.collections[collection]) {
			delete this.meta.collections[collection];
			this.updateMetaFile();
		}

		// Delete the collection folder
		if (fs.existsSync(`${this.databaseName}\\collections\\${collection}`))
			fs.rmSync(`${this.databaseName}\\collections\\${collection}`, {
				recursive: true,
				force: true,
			});

		// Delete index files
		if (fs.existsSync(`${this.databaseName}\\indexes\\${collection}`))
			fs.rmSync(`${this.databaseName}\\indexes\\${collection}`, { recursive: true, force: true });

		this.logger.log(`Deleted collection ${collection}`, this.databaseName);
	}

	/** Renames the supplied collection with the provided name. This includes metadata and file name updates.
	 *
	 * @param {string} - The collection to rename
	 * @param {string} - The new name for the collection
	 */
	updateCollection(collection, newName) {
		// Check if system is ready
		if (!this.checkForCollection(collection)) return;

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
			`${this.databaseName}\\collections\\${collection}`,
			`${this.databaseName}\\collections\\${newName}`,
		);

		// Rename Index Folder
		fs.renameSync(
			`${this.databaseName}\\indexes\\${collection}`,
			`${this.databaseName}\\indexes\\${newName}`,
		);

		// Update metadata file, rename object associated
		Object.defineProperty(this.meta.collections, newName, {
			value: this.meta.collections[collection],
			writable: true,
			enumerable: true,
		});
		delete this.meta.collections[collection];
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
		// Check if system is ready
		if (!this.checkForCollection(collection)) return;

		// TODO add buffer here later
		const collectionSize = this.getCollectionSize(collection);
		var results = [];

		for (let i = 0; i < collectionSize; i++) {
			var entry = this.getEntry(collection, i);
			if (entry !== null) results.push(entry);
		}

		return results;
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
		if (!this.checkForCollection(collection)) return;

		// Check if attribute was passed
		if (!attribute) {
			this.logger.error('No attribute name provided', this.databaseName);
			return;
		}

		const indexPath = `${this.databaseName}\\indexes\\${collection}\\${attribute}`;

		// Check if attribute is already indexed
		if (fs.existsSync(indexPath)) {
			this.logger.error(
				`The attribute ${attribute} of ${collection} has already been indexed.`,
				this.databaseName,
			);
			return;
		}

		// Check if attribute exceeds permissible indexing depth
		const unflattenedAttribute = this.unflattenAttribute(attribute);
		if (unflattenedAttribute.length > 2) {
			this.logger.error(
				`Object indexing depth exceeded`,
				this.databaseName,
				`The depth for attribute ${attribute} exceeds the limit of depth 2 with depth ` +
					`${unflattenedAttribute.length}. No index can or will be created.`,
			);
			return;
		}

		// Create Index Files
		fs.mkdirSync(indexPath);

		// Create the BPlusTree structure
		//TODO update when the index files are included in BPlusTree.
		var indexTree = new BPlusTree(indexPath, 100);
		var collectionSize = this.getCollectionSize(collection);
		this.meta.collections[collection].indexed.push(attribute);

		// Check each entry for the attribute. If it exists, add to the tree.
		for (let i = 0; i < collectionSize; i++) {
			var hasProperty = true;
			await this.semaphore.acquire();
			let entry = this.getEntryAsync(collection, i);
			this.semaphore.release();

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

		this.logger.log(`Created index files for ${attribute}`, this.databaseName);
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
		if (!this.checkForCollection(collection)) return;

		// Check if entry value was passed
		if (!entry) {
			this.logger.error(`No entry value was passed.`, this.databaseName);
			return;
		}

		// Check the entry is not empty
		if (Object.keys(entry).length === 0) {
			this.logger.error(`The entry value passed has no attributes.`, this.databaseName);
			return;
		}

		// Check that there are no empty values in entry
		for (const key in entry) {
			if (entry[key] === undefined) {
				this.logger.error(
					`Entry value passed contains empty value(s).`,
					this.databaseName,
					`The value ${key} in entry is undefined. Please ensure all attributes in the entry contain one of the following:` +
						`an array, object, number, boolean, or string.`,
				);
				return;
			}
		}

		// Get metadata index, _id for entry
		let id = 0;
		if (this.meta.collections[collection].availableIDs.length > 0) {
			id = this.meta.collections[collection].availableIDs.pop();
		} else id = this.meta.collections[collection].entries++;

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

		// Rearrange entry such that _id is first
		const { _id, ...rest } = entry;
		entry = { _id, ...rest };

		// Add to collection
		const path = `${this.databaseName}\\collections\\${collection}\\${this.getEntryFolder(id)}`;
		const pathFile = this.getEntryPath(collection, id);
		if (!fs.existsSync(path)) {
			fs.mkdirSync(path);
		}

		fs.writeFileSync(pathFile, JSON.stringify(entry));
		this.updateMetaFile();

		// Add any values into their respective index
		for (const key in entry) {
			if (this.meta.collections[collection].indexed.includes(key)) {
				const tree = new BPlusTree(`${this.databaseName}\\indexes\\${collection}\\${key}`);
				tree.insert(entry[key], entry._id);
				this.logger.log(`Updated index of ${collection}\\${key} with value ${entry[key]}`);
			}
		}

		this.logger.log(`Added entry: ${id} to ${collection}`, this.databaseName);
	}

	/** Delete an entry from the provided collection via its entry id, which is denoted as the attribute '_id".
	 *
	 * @param {string} collection - The name of the collection to operate on
	 * @param {number} entryId - The entry id
	 * @returns {boolean} - True if successful, false otherwise.
	 */
	deleteEntry(collection, entryId) {
		// Check if system is ready
		if (!this.checkForCollection(collection)) return;

		// Check if entry value was passed
		if (!entryId) {
			this.logger.error(`No entry value was passed.`, this.databaseName);
			return false;
		}

		// Delete from collection file
		const path = this.getEntryPath(collection, entryId);
		const entryObject = JSON.parse(fs.readFileSync(path));
		fs.unlinkSync(path);

		// Add removed id to metadata
		this.meta.collections[collection].availableIDs.push(entryId);
		this.updateMetaFile();

		// Delete from index files
		for (const key in entryObject) {
			if (this.meta.collections[collection].indexed.includes(key)) {
				const tree = new BPlusTree(`${this.databaseName}\\indexes\\${collection}\\${key}`);
				tree.delete(entryObject[key], entryId);
				this.logger.log(
					`Deleted ${entryId} of ${entryObject[key]} in index file for ${key}`,
					this.databaseName,
				);
			}
		}

		this.logger.log(`Deleted ${entryId} from ${collection}`, this.databaseName);

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
		if (!this.checkForCollection(collection)) return;

		// Check if a line number was passed
		if (id === undefined) {
			this.logger.error(`No entry id provided.`, this.databaseName);
			return;
		}

		// Read file contents
		const path = this.getEntryPath(collection, id);
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
		if (!this.checkForCollection(collection)) return;

		// Check for updatesToMake
		if (!updatesToMake) {
			this.logger.error(`No update request provided. No changes made.`, this.databaseName);
			return;
		}

		// Check the entry is not empty
		if (Object.keys(updatesToMake).length === 0) {
			this.logger.error(`The updatesToMake value passed has no attributes.`, this.databaseName);
			return;
		}

		// Check updatesToMake has _id
		if (updatesToMake._id === undefined) {
			this.logger.error(
				`The updatesToMake value passed has no '_id' attribute.`,
				this.databaseName,
			);
			return;
		}

		// Check if file exists
		var entry = this.getEntry(collection, updatesToMake._id);
		if (entry === null) {
			this.logger.error(
				`The entry ${updatesToMake._id} does not exist within the collection ${collection}`,
				this.databaseName,
			);
			return;
		}

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
			const tree = new BPlusTree(`${this.databaseName}\\indexes\\${collection}\\${key}`);
			if (originalValues[key] !== null) tree.delete(originalValues[key], entry._id);
			if (entry.hasOwnProperty(key) && entry[key] !== null) tree.insert(entry[key], entry._id);
		}

		this.logger.log(`Updated entry ${entry._id} in collection ${collection}`, this.databaseName);
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

	/* -------------------------------------------------------------------------- */
	/*                            Query Related Methods                           */
	/* -------------------------------------------------------------------------- */

	//TODO create a single object variant
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
		this.logger.log('Smart search method. Not built at this time.');

		// Check if system is ready
		if (!this.checkForCollection(collection)) return;

		var results = [];
		var queries = { indexed: {}, notIndexed: {}, depth: [] };

		// Testing Code (Before breakdown)
		console.group('------------------- Query Building Test -------------------');
		console.log('Criteria: ');
		console.log(query);

		// Build 2 query objects, one for the indexed values and one for the non-indexed values
		if (!collection) {
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

		// Testing Code (results)
		console.log('\nQuery - Indexed');
		console.log(queries.indexed);
		console.log('\nQuery - Not Indexed');
		console.log(queries.notIndexed);
		console.groupEnd();

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

		//? What to do if attribute is indexed but not included in the indexed files?
		//* Assume does not exist.

		// Dispatch queries
		const [indexedResults, nonIndexedResults] = await Promise.all([
			this.findFromIndexed(collection, queries.indexed),
			this.findFromNonIndexed(collection, queries.notIndexed),
		]);

		// Go through results here.
		console.group('----------------------- Results -----------------------');
		console.log(query);
		console.log(indexedResults);
		console.log(nonIndexedResults);

		return;

		// Still need to figure out how to do group-by and aggregation.
		// Handle projection, sorting here.

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

		// if smart indexing is enabled, check through here.

		this.logger.log('Query Complete', this.databaseName);
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
				Object.defineProperty(queries.indexed, key, {
					value: query[key],
					writable: false,
					enumerable: true,
				});
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

	prepareResultsObject(results) {
		for (const key in results) {
			if (typeof results[key] !== 'object' || Array.isArray(results[key])) {
				results[key] = [];
			} else if (results[key] !== null || results[key] !== undefined) {
				this.prepareResultsObject(results[key]);
			}
		}
	}

	queryLogicalOperators = {
		$and: this.findAnd.bind(this),
		$or: this.findOr.bind(this),
		$not: this.findNot.bind(this),
		$nand: this.findNand.bind(this),
		$nor: this.findNor.bind(this),
		$xor: this.findXor.bind(this),
		$count: this.findCount.bind(this),
	};

	/* ------------------------- Query (Indexed) Methods ------------------------ */

	queryOperatorsIndexed = {
		$gt: this.findIndexedGreaterThan.bind(this),
		$gte: this.findIndexedGreaterThanEqual.bind(this),
		$lt: this.findIndexedLessThan.bind(this),
		$lte: this.findIndexedLessThanEqual.bind(this),
		$eq: this.findIndexedEqual.bind(this),
		$ne: this.findIndexedNotEqual.bind(this),

		$in: this.findIndexedIn.bind(this),
		$nin: this.findIndexedNotIn.bind(this),
		$text: this.findIndexedText.bind(this),

		$exists: this.findIndexedExists.bind(this),
		$type: this.findIndexedType.bind(this),
		$count: this.findIndexedCount.bind(this),
	};

	findFromIndexed(collection, query) {
		this.logger.log(`Starting indexed query of ${collection}`, this.databaseName);
		var results = query;

		return results;
	}

	findIndexedGreaterThan(query, entry, results, depth) {
		this.logger.log(`Greater than for indexed at ${depth}`);

		return;
	}

	findIndexedGreaterThanEqual(query, entry, results, depth) {
		this.logger.log(`Greater than equal for indexed at ${depth}`);

		return;
	}

	findIndexedLessThan(query, entry, results, depth) {
		this.logger.log(`Less than for indexed at ${depth}`);

		return;
	}

	findIndexedLessThanEqual(query, entry, results, depth) {
		this.logger.log(`Less than equal for indexed at ${depth}`);

		return;
	}

	findIndexedEqual(query, entry, results, depth) {
		this.logger.log(`Equal for indexed at ${depth}`);

		return;
	}

	findIndexedNotEqual(query, entry, results, depth) {
		this.logger.log(`Not Equal for indexed at ${depth}`);

		return;
	}

	findIndexedIn(query, entry, results, depth) {
		this.logger.log(`Find in for indexed at ${depth}`);

		return;
	}

	findIndexedNotIn(query, entry, results, depth) {
		this.logger.log(`Find not in for indexed at ${depth}`);

		return;
	}

	findIndexedText(query, entry, results, depth) {
		this.logger.log(`Find Text for indexed at ${depth}`);

		return;
	}

	findIndexedExists(query, entry, results, depth) {
		this.logger.log(`Exists for indexed at ${depth}`);

		return;
	}

	findIndexedType(query, entry, results, depth) {
		this.logger.log(`Find type for indexed at ${depth}`);

		return;
	}

	findIndexedCount(query, entry, results, depth) {
		this.logger.log(`Count for indexed at ${depth}`);

		return;
	}

	/* ---------------------- Query (Non-Indexed) Methods) ---------------------- */

	queryOperatorsNonIndexed = {
		$gt: this.findNonIndexedGreaterThan.bind(this),
		$gte: this.findNonIndexedGreaterThanEqual.bind(this),
		$lt: this.findNonIndexedLessThan.bind(this),
		$lte: this.findNonIndexedLessThanEqual.bind(this),
		$eq: this.findNonIndexedEqual.bind(this),
		$ne: this.findNonIndexedNotEqual.bind(this),
		// TODO add range later for more memory efficient methods?

		$in: this.findNonIndexedIn.bind(this),
		$nin: this.findNonIndexedNotIn.bind(this),
		$text: this.findNonIndexedText.bind(this),

		$exists: this.findNonIndexedExists.bind(this),
		$type: this.findNonIndexedType.bind(this),
	};

	async findFromNonIndexed(collection, query) {
		this.logger.log(`Starting non-indexed query of ${collection}`, this.databaseName);
		var results = structuredClone(query);
		this.prepareResultsObject(results);

		// Cycle through each entry, and compare to the query
		var entryCount = this.getCollectionSize(collection);

		for (let i = 0; i < entryCount; i++) {
			await this.semaphore.acquire();
			const entry = await this.getEntryAsync(collection, i);
			this.semaphore.release();

			if (entry === null) continue;

			this.findFromNonIndexedRouter(query, entry, results);
		}

		return results;
	}

	findFromNonIndexedRouter(query, entry, results, depth = { entry: [], query: [] }) {
		for (const key in query) {
			if (key === '_id') continue;
			if (key.charAt(0) !== '$') {
				if (!this.objectHasAttribute(entry, [... depth.entry, key])) continue;
				depth.entry.push(key);
			}
			depth.query.push(key);

			let attributeValue = this.getAttributeDataType(query[key]);
			
			if (attributeValue === 'object') {
				this.findFromNonIndexedRouter(query[key], entry, results, depth);
			} else if (key.charAt(0) === '$' && !this.queryLogicalOperators.hasOwnProperty(key)) {
				this.queryOperatorsNonIndexed[key](query[key], entry, results, depth);
			} else if (attributeValue !== null && attributeValue !== undefined) {
				this.findNonIndexedEqual(query[key], entry, results, depth);
			}

			if (!key.charAt(0) === '$') depth.entry.pop();
			depth.query.pop();
		}
	}

	findNonIndexedGreaterThan(query, entry, results, depth) {
		this.logger.log(
			`Greater than for non-indexed at ${depth.entry}, Q:${query} - E._id:${entry._id}`,
		);

		console.log(depth);
		const value = this.getObjectAttribute(entry, depth.entry);
		if (query < value) {
			this.pushToAttributeArray(results, depth.query, entry);
		}
	}

	findNonIndexedGreaterThanEqual(query, entry, results, depth) {
		this.logger.log(
			`Greater than equal to for non-indexed at ${depth.entry}, Q:${query} - E._id:${entry._id}`,
		);

		const value = this.getObjectAttribute(entry, depth.entry);
		if (query <= value) {
			this.pushToAttributeArray(results, depth.query, entry);
		}
	}

	findNonIndexedLessThan(query, entry, results, depth) {
		this.logger.log(`Less than for non-indexed at ${depth.entry}, Q:${query} - E._id:${entry._id}`);

		const value = this.getObjectAttribute(entry, depth.entry);
		if (query > value) {
			this.pushToAttributeArray(results, depth.query, entry);
		}
	}

	findNonIndexedLessThanEqual(query, entry, results, depth) {
		this.logger.log(
			`Less than equal to for non-indexed at ${depth.entry}, Q:${query} - E._id:${entry._id}`,
		);

		const value = this.getObjectAttribute(entry, depth.entry);
		if (query >= value) {
			this.pushToAttributeArray(results, depth.query, entry);
		}
	}

	findNonIndexedEqual(query, entry, results, depth) {
		this.logger.log(`Equal for non-indexed at ${depth.entry}, Q:${query} - E._id:${entry._id}`);

		const value = this.getObjectAttribute(entry, depth.entry);
		if (query === value) {
			this.pushToAttributeArray(results, depth.query, entry);
		}
	}

	findNonIndexedNotEqual(query, entry, results, depth) {
		this.logger.log(`Not Equal for non-indexed at ${depth.entry}, Q:${query} - E._id:${entry._id}`);

		const value = this.getObjectAttribute(entry, depth.entry);
		if (query !== value) {
			this.pushToAttributeArray(results, depth.query, entry);
		}
	}

	findNonIndexedIn(query, entry, results, depth) {
		this.logger.log(`Find in for non-indexed at ${depth.entry}, Q:${query} - E._id:${entry._id}`);

		const value = this.getObjectAttribute(entry, depth.entry);
		if (query.includes(value)) {
			this.pushToAttributeArray(results, depth.query, entry);
		}
	}

	findNonIndexedNotIn(query, entry, results, depth) {
		this.logger.log(
			`Find not in for non-indexed at ${depth.entry}, Q:${query} - E._id:${entry._id}`,
		);

		const value = this.getObjectAttribute(entry, depth.entry);
		if (!query.includes(value)) {
			this.pushToAttributeArray(results, depth.query, entry);
		}
	}

	//? This appears to work perfectly, but it cannot consider spaces for some reason
	findNonIndexedText(query, entry, results, depth) {
		this.logger.log(`Find Text for non-indexed at ${depth.entry}, Q:${query} - E:${entry}`);

		// Build search object criteria
		var value = this.getObjectAttribute(entry, depth.entry);
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

		this.logger.debug("Search object built", this.databaseName);
		console.log(search);

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
		this.pushToAttributeArray(results, depth.query, entry);

		return;
	}

	findNonIndexedExists(query, entry, results, depth) {
		this.logger.log(`Exists for non-indexed at ${depth.entry}, Q:${query} - E._id:${entry._id}`);

		const value = this.getObjectAttribute(entry, depth.entry);
		if (query)
			if (value !== null && value !== undefined) {
				this.pushToAttributeArray(results, depth.query, entry);
			} else {
				if (value === null || value === undefined) {
					this.pushToAttributeArray(results, depth.query, entry);
				}
			}
	}

	findNonIndexedType(query, entry, results, depth) {
		this.logger.log(`Find type for non-indexed at ${depth.entry}, Q:${query} - E._id:${entry._id}`);

		if (this.getAttributeDataType(entry, depth.entry) === query) {
			this.pushToAttributeArray(results, depth.query, entry);
		}
	}

	/* ------------------------------- deprecated ------------------------------- */
	queryOperators = {
		$gt: this.findGreaterThan.bind(this),
		$gte: this.findGreaterThanEqual.bind(this),
		$lt: this.findLessThan.bind(this),
		$lte: this.findLessThanEqual.bind(this),
		$eq: this.findEqual.bind(this),
		$ne: this.findNotEqual.bind(this),

		$in: this.findIn.bind(this),
		$nin: this.findNotIn.bind(this),
		$text: this.findText.bind(this),

		$exists: this.findExists.bind(this),
		$type: this.findType.bind(this),
		$count: this.findCount.bind(this),
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
	findRouter(collection, attribute, criteria) {
		var results = [];
		const searchParameters = Object.getOwnPropertyNames(criteria);

		for (const element of searchParameters) {
			if (element.charAt(0) === '$') {
				results.push(...this.queryOperators[element](collection, attribute, criteria[element]));
			} else if (typeof criteria[element] === 'object' && !Array.isArray(criteria[element])) {
				results.push(...this.findAnd(collection, element, criteria[element]));
			} else {
				// TODO make this more efficient, right now it passes over everything n times where n = criteria props.
				// 		Combine all non $ params and have it iterate 1 time over everything and compare each to all
				results.push(...this.findEqual(collection, element, criteria[element]));
			}
		}

		return results;
	}

	/* ---------------------------- Value comparison ---------------------------- */
	/** Search the collection provided for greater than via the attribute, compared to the value. and
	 * returned to {@link Zani#find} for projection, grouping, and sorting as needed. If it was part of a compound search
	 * using a JSON object, such as $or or $and, it will be returned to {@link Zani#findRouter} instead.
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
	findGreaterThan(collection, attribute, value) {
		this.logger.log(`Greater than ${value} for ${attribute}`, this.databaseName);

		var results = [];
		const collectionSize = this.getCollectionSize(collection);

		// Read through entire collection, search for results
		for (var i = 1; i <= collectionSize; i++) {
			var entry = this.getEntry(collection, i);
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
	 * @see {@link Zani#find}
	 * @see {@link Zani#findRouter}
	 *
	 * @param {string} collection - The name of the collection
	 * @param {string} attribute The attribute name to have the comparison performed on
	 * @param {*} value - The comparison value, which may be a JSON object for more advanced queries
	 *
	 * @returns {object[]}
	 */
	findGreaterThanEqual(collection, attribute, value) {
		this.logger.log(`Greater than equal to ${value} for ${attribute}`, this.databaseName);

		var results = [];
		const collectionSize = this.getCollectionSize(collection);

		// Read through entire collection, search for results
		for (var i = 1; i <= collectionSize; i++) {
			var entry = this.getEntry(collection, i);
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
	 * @see {@link Zani#find}
	 * @see {@link Zani#findRouter}
	 *
	 * @param {string} collection - The name of the collection
	 * @param {string} attribute The attribute name to have the comparison performed on
	 * @param {*} value - The comparison value, which may be a JSON object for more advanced queries
	 *
	 * @returns {object[]}
	 */
	findLessThan(collection, attribute, value) {
		this.logger.log(`Less than ${value} for ${attribute}`, this.databaseName);

		var results = [];
		const collectionSize = this.getCollectionSize(collection);

		// Read through entire collection, search for results
		for (var i = 1; i <= collectionSize; i++) {
			var entry = this.getEntry(collection, i);
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
	 * @see {@link Zani#find}
	 * @see {@link Zani#findRouter}
	 *
	 * @param {string} collection - The name of the collection
	 * @param {string} attribute The attribute name to have the comparison performed on
	 * @param {*} value - The comparison value, which may be a JSON object for more advanced queries
	 *
	 * @returns {object[]}
	 */
	findLessThanEqual(collection, attribute, value) {
		this.logger.log(`Less than equal to ${value} for ${attribute}`, this.databaseName);

		var results = [];
		const collectionSize = this.getCollectionSize(collection);

		// Read through entire collection, search for results
		for (var i = 1; i <= collectionSize; i++) {
			var entry = this.getEntry(collection, i);
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
	 * @see {@link Zani#find}
	 * @see {@link Zani#findRouter}
	 *
	 * @param {string} collection - The name of the collection
	 * @param {string} attribute The attribute name to have the comparison performed on
	 * @param {*} value - The comparison value, which may be a JSON object for more advanced queries
	 *
	 * @returns {object[]}
	 */
	findEqual(collection, attribute, value) {
		this.logger.log(`Equal to ${value} for ${attribute}`, this.databaseName);

		var results = [];
		var isArray = Array.isArray(value);
		const collectionSize = this.getCollectionSize(collection);

		// Read through entire collection, search for results
		for (var i = 1; i <= collectionSize; i++) {
			var entry = this.getEntry(collection, i);
			entry = JSON.parse(entry);

			// If entry has attribute, compare. If conditions met, add to results array.
			if (entry.hasOwnProperty(attribute)) {
				// If multiple values, compare all
				if (isArray) {
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
	 * @see {@link Zani#find}
	 * @see {@link Zani#findRouter}
	 *
	 * @param {string} collection - The name of the collection
	 * @param {string} attribute The attribute name to have the comparison performed on
	 * @param {*} value - The comparison value, which may be a JSON object for more advanced queries
	 *
	 * @returns {object[]}
	 */
	findNotEqual(collection, attribute, value) {
		this.logger.log(`Not equal to ${value} for ${attribute}`, this.databaseName);

		var results = [];
		var isArray = Array.isArray(value);
		const collectionSize = this.getCollectionSize(collection);

		// Read through entire collection, search for results
		for (var i = 1; i <= collectionSize; i++) {
			var entry = this.getEntry(collection, i);
			entry = JSON.parse(entry);

			// If entry has attribute, compare. If conditions met, add to results array.
			if (entry.hasOwnProperty(attribute)) {
				// If multiple values, compare all
				if (isArray) {
					if (!value.includes(entry[attribute])) results.push(entry);
					// If one value, compare
				} else {
					if (entry[attribute] != value) results.push(entry);
				}
			}
		}

		return results;
	}

	/* ---------------------------- Logical Operators --------------------------- */
	/** Dispatch queries with a logical and intersection of the results. Each part of the query will be sent to
	 * its corresponding method via {@link Zani#findRouter}, and return here. The results will then be
	 * checked to ensure all values are within all results before returning just those values.
	 *  If it was part of a compound search using a JSON object, such as $or or $and, it will be returned
	 * to {@link Zani#findRouter} instead.
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
	findAnd(collection, attribute, value) {
		this.logger.log(`Logical and ${value} for ${attribute}`, this.databaseName);

		var results = [];
		var searchParameters = Object.getOwnPropertyNames(value);
		var searchCount = searchParameters.length;
		var queryCount = 0;

		// Compile results from query, each query is individual row of 2d array
		for (const element of searchParameters) {
			if (element.charAt(0) === '$') {
				results[queryCount] = this.queryOperators[element](collection, attribute, value[element]);
			} else if (typeof value[element] === 'object' && !Array.isArray(value[element])) {
				results[queryCount] = this.findAnd(collection, element, value[element]);
			} else {
				// TODO make this more efficient, right now it passes over everything n times where n = criteria props.
				// 		Combine all non $ params and have it iterate 1 time over everything and compare each to all
				results[queryCount] = this.findEqual(collection, element, value[element]);
			}
			queryCount++;
		}

		// if no results found, or only one row (one query), skip rest of method
		if (results.length <= 1) return results[0];

		// If attribute is provided, compare with that
		if (attribute) {
			// Start with elements from the first row
			let commonValues = new Set(results[0].map((item) => item[attribute]));

			// Check set for intersections
			for (let i = 1; i < searchCount; i++) {
				let currentRow = new Set(results[i].map((item) => item[attribute]));

				// Keep only elements that are in both sets
				commonValues = new Set([...commonValues].filter((val) => currentRow.has(val)));

				// Early exit if there's nothing in common
				if (commonValues.size === 0) break;
			}

			return results[0].filter((item) => commonValues.has(item[attribute]));
		}

		// If there is no attribute provided, check via object itself.
		// Start with elements from the first row
		let commonValues = new Set(results[0].map((item) => item));

		// Check set for intersections
		for (let i = 1; i < searchCount; i++) {
			let currentRow = new Set(results[i].map((item) => item));

			// Keep only elements that are in both sets
			commonValues = new Set([...commonValues].filter((item) => this.isInArray(currentRow, item)));

			// Early exit if there's nothing in common
			if (commonValues.size === 0) break;
		}
		return results[0].filter((item) => this.isInArray(commonValues, item));
	}

	/** Dispatch queries with a logical or union of the results. Each part of the query will be sent to
	 * its corresponding method via {@link Zani#findRouter}, and return here. The results will then be
	 * checked for deduplication of all values and returned without removing any unique values. If it was part
	 * of a compound search using a JSON object, such as $or or $and, it will be returned to {@link Zani#findRouter} instead.
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
	findOr(collection, attribute, value) {
		this.logger.log(`Logical or ${value} for ${attribute}`, this.databaseName);

		var results = [];

		// Can just append results all to single array. Then, de-duplicate.
		results.push(...this.findRouter(collection, attribute, value));

		// De-duplicate results
		results = this.deduplicateResults(results);

		return results;
	}

	/** Dispatch queries with a logical not union of the results. Each part of the query will be sent to
	 * its corresponding method via {@link Zani#findRouter}, and return here. The results will then be deduplicated
	 * before checking the entire collection and returning just those not appearing in the query. If it was part of a
	 * compound search using a JSON object, such as $or or $and, it will be returned to {@link Zani#findRouter} instead.
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
	findNot(collection, attribute, value) {
		this.logger.log(`Logical not ${value} for ${attribute}`, this.databaseName);

		var results = [];
		var notOperationResults = [];
		const collectionSize = this.getCollectionSize(collection);

		// Can just append results all to single array. Then, de-duplicate.
		results.push(...this.findRouter(collection, attribute, value));

		// De-duplicate results
		results = this.deduplicateResults(results);

		var resultCount = results.length;

		// Check with collection and collection all non-results form query
		for (let i = 1; i <= collectionSize; i++) {
			let found = false;
			let element = JSON.parse(this.getEntry(collection, i));

			// Compare each entry in collection to results
			for (let j = 0; j < resultCount; j++) {
				if (this.compareObjects(results[j], element)) {
					found = true;
					break;
				}
			}

			// If entry not in results, append to return array
			if (!found) {
				notOperationResults.push(element);
			}
		}

		return notOperationResults;
	}

	findNand(collection, attribute, value) {
		this.logger.log(`Logical Nand ${value} for ${attribute}`, this.databaseName);

		var results = [];
		return results;
	}

	findNor(collection, attribute, value) {
		this.logger.log(`Logical Nor ${value} for ${attribute}`, this.databaseName);

		var results = [];
		return results;
	}

	findXor(collection, attribute, value) {
		this.logger.log(`Logical Xor ${value} for ${attribute}`, this.databaseName);

		var results = [];
		return results;
	}

	/* ----------------------- Arrays and Text Comparison ----------------------- */
	findIn(collection, attribute, value) {
		this.logger.log(`Array In ${value} for ${attribute}`, this.databaseName);

		var results = [];
		return results;
	}

	findNotIn(collection, attribute, value) {
		this.logger.log(`Array Not In ${value} for ${attribute}`, this.databaseName);

		var results = [];
		return results;
	}

	findText(collection, attribute, value) {
		this.logger.log(`Array Text ${value} for ${attribute}`, this.databaseName);

		var results = [];
		return results;
	}

	/* ---------------------------- Misc. Comparison ---------------------------- */
	/** Search a collection for a all values that exist. To exist, a attribute must be present
	 * in the entry and not be undefined, an array of length 0, or a empty object.
	 *
	 * @param {string} collection - The name of the collection
	 * @param {string=} attribute - The calling attribute. It is unused as of now.
	 * @param {string} value - The name of the attribute to check
	 * @returns {object[]}
	 */
	findExists(collection, attribute, value) {
		this.logger.log(`Exists ${value} for ${attribute}`, this.databaseName);

		// Check if has attribute
		// If string/bool/number, ensure not undefined
		// Check if array, ensure not empty
		// Check if object, ensure not empty
		// Return all that match the above values

		var results = [];
		const collectionSize = this.getCollectionSize(collection);

		// Read through entire collection, search for results
		for (var i = 1; i <= collectionSize; i++) {
			var entry = this.getEntry(collection, i);
			entry = JSON.parse(entry);

			// If entry has attribute, ensure not empty or undefined
			if (entry.hasOwnProperty(value)) {
				var checkValue = entry[value];

				if (Array.isArray(checkValue)) {
					if (checkValue.length !== 0) results.push(entry);
					// If object, ensure not empty
				} else if (typeof checkValue == 'object') {
					if (Object.keys(checkValue).length !== 0) results.push(entry);
					// If neither, ensure its not defined
				} else {
					if (checkValue) results.push(entry);
				}
			}
		}

		return results;
	}

	findType(collection, attribute, value) {
		this.logger.log(`Comp Type ${value} for ${attribute}`, this.databaseName);

		var results = [];
		return results;
	}

	findCount(collection, attribute, value) {
		this.logger.log(`Count ${value} for ${attribute}`, this.databaseName);

		/*
		! must be used as 
		* { $count: {
		* 		project: string (What it will be attributed as)
		* 		query: {...}
		* }
		*/

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
		for (var i = 0; i < resultCount; i++) {
			let element = results[i];
			let found = false;
			let params = Object.getOwnPropertyNames(element); // Just in case

			// Check that element is not in deduplicated results array
			for (var j = 0; j < deduplicatedResults.length; j++) {
				if (this.compareObjects(deduplicatedResults[j], element)) {
					found = true;
					break;
				}
			}

			// If result was not in array, add
			if (!found) deduplicatedResults.push(element);
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

	/** Checks if a collection folder/files exists within the active database. This includes check for
	 * collection, the collection variable, and the active database.
	 *
	 * Note: if it is outside the scope of meta, it will not report true.
	 *
	 * @param {string} collection - The name of the collection
	 * @returns {boolean} True if system is set and ready to be operated on, false otherwise
	 */
	checkForCollection(collection) {
		// Check if active database
		if (!this.checkForActiveDatabase()) return false;

		// Check if a collection name was passed
		if (!collection) {
			this.logger.error('No collection name provided', this.databaseName);
			return false;
		}

		// Check if the collection is within meta.json collection list
		let found = this.meta.collections.hasOwnProperty(collection);

		if (found) {
			// Check if the collection file exists
			if (fs.existsSync(`${this.databaseName}\\collections\\${collection}`)) return true;

			// Log an error if it exists in meta but not in file.
			this.logger.error(
				`${collection} folder does not exist`,
				'CollectionCheck',
				`The collection exists in the meta.json file, but the collection storage folder, and thus, subsequent` +
					`data files, cannot be located. \n\tError locating collection jsonl at ${path.join(
						__dirname,
						`${this.databaseName}\\collections\\${collection}.jsonl`,
					)}`,
			);
		}
		this.logger.error(`The collection ${collection} does not exist`, this.databaseName);
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
		return `${this.databaseName}\\collections\\${collection}\\${folder}\\${formattedId}.json`;
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
		if (obj1 === undefined || obj2 === undefined) {
			this.logger.error(
				`Either one or both objects are undefined, and cannot be compared`,
				this.databaseName,
			);
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

	/** Push a value to a attribute array in an object without recursively reducing the object.
	 *
	 * This only works with attributes that are already arrays.
	 *
	 * @param {object} obj - The object to traverse
	 * @param {string} attribute - The unflattened attribute to set
	 * @param {any} value - The value to set
	 */
	pushToAttributeArray(obj, attribute, value) {
		let curr = obj;
		for (let i = 0; i < attribute.length - 1; i++) {
			if (!(attribute[i] in curr)) curr[attribute[i]] = {};
			curr = curr[attribute[i]];
		}
		curr[attribute[attribute.length - 1]].push(value);
	}

	/** Returns the data type of a object attribute. Can be:
	 * - 'undefined'
	 * - 'null'
	 * - 'array'
	 * - any result of typeof keyword
	 *
	 * @param {object} obj - The object holding the desired attribute
	 * @param {string} attribute - The unflattened path of the attribute
	 * @returns The object type in string form
	 */
	getAttributeDataType(obj, attribute) {
		let value = obj;
		if(attribute)
			value = this.getObjectAttribute(obj, attribute);

		if (value === undefined) return 'undefined';
		if (Array.isArray(value)) return 'array';
		if (value === null) return 'null';
		return typeof value;
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
		this.logger.error(
			'Uncaught rejection - The program crashed',
			'Fatal',
			`${reason} \n\n${reason.stack}`,
		);

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

		if (this.options.crashDetector) {
			process.off('uncaughtException', this.errorBound);
			process.off('unhandledRejection', this.rejectionBound);
		}

		this.logger.log(`Process Terminated`);
	}
}

module.exports = Zani;
