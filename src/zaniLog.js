// Node Imports
const fs = require('fs');

/**
 * The in-built logging system for ZaniJS for both console and file logging.
 *
 * @author Brock Kitterman <brock.kitterman@gmail.com>
 */
class ZaniLog {
	/* -------------------------------------------------------------------------- */
	/*                                Global States                               */
	/* -------------------------------------------------------------------------- */
	/** Contains all code colors in string form for console output. */
	color = {
		reset: '\x1b[30m',
		black: '\x1b[30m',
		red: '\x1b[31m',
		green: '\x1b[32m',
		yellow: '\x1b[33m',
		blue: '\x1b[34m',
		magenta: '\x1b[35m',
		cyan: '\x1b[36m',
		white: '\x1b[37m',
	};

	/* -------------------------------- Variables ------------------------------- */
	/** The file used for logging the system when systemLog flag is enabled */
	logFile = undefined;
	/** Used for logging to denote message origins */
	source = undefined;

	/** Keeps track of current time. Reinstantiated every call. */
	date = new Date();

	/** The options object used for settings of this class and its behavior. Can be set with {@link ZaniLog#configureOptions} */
	options = {
		systemLog: true,
		consoleLog: false,
		colorful: false,
	};

	/* --------------------------------- Aliases -------------------------------- */
	out = this.log;
	print = this.log;
	warn = this.warning;
	err = this.error;

	/** Create a new ZaniLog object. If a fileName is passed, it will use it as the desired log output file folder.
	 *
	 * Note: This class does not create any folders, and requests that the desired output is created before
	 * selecting output file destination.
	 *
	 * @example
	 * './fileName/logs/audit.log
	 *
	 * @param {string=} fileName - The log folder parent
	 * @param {object=} options - The options object
	 *
	 * @param {boolean} [options.consoleLog=true] - Enable console logging
	 * @param {boolean} [options.systemLog=true] - Enable system logging to the specified file when available
	 * @param {boolean} [options.colorful=true] - Enable colorful console output
	 */
	constructor(fileName, options) {
		// Configure Options
		if (options) this.configureOptions(options);

		// If a file is passed, set the log file
		if (fileName) this.setLogFile(fileName);
	}

	/** Configure the options variable to match the passed arguments.
	 *
	 * @param {object} options - The new options to be used by ZaniLog.
	 *
	 * @param {boolean} [options.consoleLog=true] - Enable console logging
	 * @param {boolean} [options.systemLog=true] - Enable system logging to the specified file when available
	 * @param {boolean} [options.colorful=true] - Enable colorful console output
	 */
	configureOptions(options) {
		if (options.hasOwnProperty('colorful')) this.options.colorful = options.colorful;
		if (options.hasOwnProperty('consoleLog')) this.options.consoleLog = options.consoleLog;
		if (options.hasOwnProperty('systemLog')) this.options.systemLog = options.systemLog;
	}

	/** Set the desired log output folder.
	 *
	 * Note: This class does not create any folders, and requests that the desired output is created before
	 * selecting output file destination.
	 *
	 * @example './fileName/logs/audit.log'
	 *
	 * @param {string} fileName - The desired output folder
	 */
	setLogFile(fileName) {
		if (!fileName) this.logFile = undefined;
		else this.logFile = fileName + '\\logs\\audit.log';
	}

	/** Set the source of the message for output. If source is not provided, it will default to 'Zani.'
	 * Severity will only be used if it is included, in which it will appear as a '/severity'
	 *
	 * @example
	 * severity = 'WARNING';
	 * Result: '[Zani/WARNING]:'
	 *
	 * @param {string=} source - The source of the message.
	 * @param {string=} severity - The severity or tag of the message.
	 */
	setSource(source, severity = '') {
		if (source) this.source = `[${source}${severity ? '/' + severity : ''}]:`;
		else this.source = `[Zani${severity ? '/' + severity : ''}]:`;
	}

	/** Outputs a message based on the options object. If consoleLog is true, it will output to the console. If systemLog
	 * is true, it will output to a desired file determined by {@link ZaniLog#setLogFile}. If colorful is true, the message
	 * source will be green in console, if supported.
	 *
	 * @example '[Zani]: Hello world.'
	 *
	 * @param {string} message - The message to output.
	 * @param {string=} source - The message source. If omitted, source is 'Zani'
	 */
	log(message, source) {
		// Set the source and build message
		this.setSource(source);
		this.message = `${this.source} ${message}.`;

		// Print to the console, if consoleLog is flagged
		if (this.options.consoleLog) {
			if (this.options.colorful)
				console.log(`${this.color.green + this.source + this.color.reset} ${message}.`);
			else console.log(this.message);
		}

		// Print to the log file, if defined, and systemLog is flagged
		if (this.options.systemLog && this.logFile) {
			fs.appendFile(this.logFile, this.message + '\n', (err) => {
				if (err) console.log('[ZaniJS]: error appending log file - ' + err.stack);
			});
		}
	}

	/** Outputs a warning message based on the options object. If consoleLog is true, it will output to the console. If systemLog
	 * is true, it will output to a desired file determined by {@link ZaniLog#setLogFile}. If colorful is true, the message
	 * source will be yellow in console, if supported.
	 *
	 * If details is passed, a second line below the original message will be printed. Otherwise, the message/output will
	 * be a single line.
	 *
	 * @example
	 * `[Zani/WARNING]: Hello world.
	 *
	 *      this is a warning message that will only print if details is included.`
	 *
	 * @param {string} message - The warning to output.
	 * @param {string=} source - The message source. If omitted, source is 'Zani'
	 * @param {string=} details - A longer message to be printed on a separate line.
	 */
	warning(message, source, details) {
		// Set the source and build message
		this.setSource(source, 'WARNING');
		this.message = `${this.source} ${message}.`;
		if (details) this.message += `\n\n\t${details}.\n`;

		// Print to the console, if consoleLog is flagged
		if (this.options.consoleLog) {
			if (this.options.colorful) {
				console.log(`${this.color.yellow + this.source + this.color.reset} ${message}.`);
				if (details) console.log(`\n\t${details}.\n`);
			} else console.log(this.message);
		}

		// Print to the log file, if defined, and systemLog is flagged
		if (this.options.systemLog && this.logFile) {
			fs.appendFileSync(this.logFile, '\n' + this.message + '\n', (err) => {
				if (err) console.log('[ZaniJS]: error appending log file - ');
			});
		}
	}

	/** Outputs a error message based on the options object. If consoleLog is true, it will output to the console. If systemLog
	 * is true, it will output to a desired file determined by {@link ZaniLog#setLogFile}. If colorful is true, the message
	 * source will be red in console, if supported.
	 *
	 * If details is passed, a second line below the original message will be printed. Otherwise, the message/output will
	 * be a single line.
	 *
	 * @example
	 * `[Zani/ERROR]: Hello world.
	 *
	 *      this is a error message that will only print if details is included.`
	 *
	 * @param {string} message - The error to output.
	 * @param {string=} source - The message source. If omitted, source is 'Zani'
	 * @param {string=} details - A longer message to be printed on a separate line.
	 */
	error(message, source, details) {
		// Set the source and build message
		this.setSource(source, 'ERROR');
		this.message = `${this.source} ${message}.`;
		if (details) this.message += `\n\n\t${details}.\n`;

		// Print to the console, if consoleLog is flagged
		if (this.options.consoleLog) {
			if (this.options.colorful) {
				console.log(`${this.color.red + this.source + this.color.reset} ${message}`);
				if (details) console.log(`\n\t${details}.\n`);
			} else console.log(this.message);
		}

		// Print to the log file, if defined, and systemLog is flagged
		if (this.options.systemLog && this.logFile) {
			fs.appendFileSync(this.logFile, '\n' + this.message + '\n', (err) => {
				if (err) console.log('[ZaniJS]: error appending log file' + err.stack);
			});
		}
	}

	/* -------------------------------------------------------------------------- */
	/*                                  Utilities                                 */
	/* -------------------------------------------------------------------------- */

	/** Returns the current date in string form. Time will be local 24hr standard.
	 *
	 * @example 'MM/DD/YYYY HH:MM:SS'
	 *
	 * @returns {string} The current date
	 */
	getCurrentDate() {
        // Ensure the date is current
		this.date = new Date();
		return (
			`${this.date.getMonth() + 1}/${this.date.getDate()}/${this.date.getFullYear()} ` +
			`${this.date.getHours()}:${this.date.getMinutes()}:${this.date.getSeconds()}`
		);
	}
}

module.exports = ZaniLog;
