import ZaniError from './zaniError.js';

/** An error thrown when an operation to open a database is unable to locate the provided
 * database.
 * 
 * @extends ZaniError
 *
 * @author Brock Kitterman <brock.kitterman@gmail.com>
 */
export default class DatabaseNotFoundError extends ZaniError {
	/** Create a new instance of the DatabaseNotFoundError class.
	 *
	 * @example
	 * throw new DatabaseNotFoundError('users', 'get');
	 *
	 * @param {string} database - The name of the database
	 * @param {string} operation - The operation attempted
	 */
	constructor(database, operation) {
		super(`Database "${database}" cannot be found.`, {
			code: 'ZANI_E_DATABASE_NOT_FOUND',
			statusCode: 404,
			context: { operation: operation, database: database },
		});
		this.database = database;
	}
}
